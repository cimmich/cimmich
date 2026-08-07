#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  statfsSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(root, "compose.yaml");
const version = readFileSync(path.join(root, "CIMMICH_VERSION"), "utf8").trim();
const project = process.env.CIMMICH_COMPANION_PROJECT || "cimmich-companion";
const stateRoot = process.env.CIMMICH_COMPANION_STATE_ROOT || "";
const environmentFile = stateRoot ? path.join(stateRoot, "runtime.env") : "";
const dockerCommand = process.env.CIMMICH_DOCTOR_DOCKER_COMMAND || "docker";

const errorCodes = new Set();
const addError = (code) => errorCodes.add(code);
const command = (args) =>
  spawnSync(dockerCommand, args, {
    encoding: "utf8",
    maxBuffer: 1_048_576,
    timeout: 20_000,
  });

const parseEnvironment = (text) => {
  const values = new Map();
  const duplicates = new Set();
  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      addError("CONFIG_INVALID_LINE");
      continue;
    }
    const key = line.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      addError("CONFIG_INVALID_KEY");
      continue;
    }
    if (values.has(key)) duplicates.add(key);
    values.set(key, line.slice(separator + 1));
  }
  if (duplicates.size > 0) addError("CONFIG_DUPLICATE_KEY");
  return values;
};

const requiredKeys = [
  "CIMMICH_COMPANION_API_PORT",
  "CIMMICH_COMPANION_UI_PORT",
  "CIMMICH_DB_PASSWORD",
  "CIMMICH_IMMICH_API_URL",
  "CIMMICH_IMMICH_WEB_ORIGIN",
];

let configuration = {
  configured: false,
  permissions: "absent",
  requiredKeys: "unknown",
};
let values = new Map();
if (!stateRoot || !environmentFile || !existsSync(environmentFile)) {
  addError("CONFIG_NOT_FOUND");
} else {
  let descriptor;
  try {
    descriptor = openSync(
      environmentFile,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const mode = fstatSync(descriptor).mode & 0o777;
    if ((mode & 0o077) !== 0) addError("CONFIG_PERMISSIONS_TOO_OPEN");
    values = parseEnvironment(readFileSync(descriptor, "utf8"));
    const complete = requiredKeys.every((key) => values.get(key));
    if (!complete) addError("CONFIG_REQUIRED_VALUE_MISSING");
    configuration = {
      configured: true,
      permissions: (mode & 0o077) === 0 ? "private" : "too-open",
      requiredKeys: complete ? "present" : "incomplete",
    };
  } catch {
    addError("CONFIG_UNREADABLE");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

let disk = { availableBytes: null, status: "unknown" };
if (stateRoot && existsSync(stateRoot)) {
  try {
    const stats = statfsSync(stateRoot);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    disk = {
      availableBytes,
      status: availableBytes >= 1_073_741_824 ? "ok" : "low",
    };
    if (disk.status === "low") addError("DISK_SPACE_LOW");
  } catch {
    addError("DISK_CHECK_FAILED");
  }
}

const dockerVersionResult = command([
  "version",
  "--format",
  "{{.Server.Version}}",
]);
const dockerAvailable = dockerVersionResult.status === 0;
if (!dockerAvailable) addError("DOCKER_UNAVAILABLE");

let composeVersion = null;
if (dockerAvailable) {
  const result = command(["compose", "version", "--short"]);
  if (result.status === 0) composeVersion = result.stdout.trim() || null;
  else addError("COMPOSE_UNAVAILABLE");
}

const composePrefix = environmentFile
  ? [
      "compose",
      "--project-name",
      project,
      "--env-file",
      environmentFile,
      "--file",
      composeFile,
    ]
  : [];

const normalizeServices = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let entries;
  try {
    const parsed = JSON.parse(trimmed);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    entries = trimmed
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return entries
    .map((entry) => ({
      health: String(entry.Health || "none").toLowerCase(),
      service: String(entry.Service || "unknown"),
      state: String(entry.State || "unknown").toLowerCase(),
    }))
    .sort((left, right) => left.service.localeCompare(right.service));
};

let services = [];
if (dockerAvailable && configuration.configured) {
  const result = command([...composePrefix, "ps", "--all", "--format", "json"]);
  if (result.status === 0) {
    try {
      services = normalizeServices(result.stdout);
      const required = [
        "cimmich-api",
        "cimmich-database",
        "cimmich-gateway",
        "cimmich-ui",
      ];
      for (const service of required) {
        const item = services.find(
          (candidate) => candidate.service === service,
        );
        if (!item || item.state !== "running") addError("SERVICE_NOT_RUNNING");
        else if (!["healthy", "none"].includes(item.health)) {
          addError("SERVICE_UNHEALTHY");
        }
      }
    } catch {
      addError("COMPOSE_STATUS_UNREADABLE");
    }
  } else {
    addError("COMPOSE_STATUS_FAILED");
  }
}

const containerProbe = (source) => {
  if (!dockerAvailable || !configuration.configured) return null;
  const result = command([
    ...composePrefix,
    "exec",
    "-T",
    "cimmich-api",
    "node",
    "-e",
    source,
  ]);
  return result.status === 0 ? result.stdout.trim() : null;
};

let api = {
  schemaPatchCount: null,
  schemaVersion: null,
  status: "unavailable",
};
const healthText = containerProbe(
  "fetch('http://127.0.0.1:3101/health').then(r=>r.json()).then(v=>process.stdout.write(JSON.stringify(v)))",
);
if (healthText) {
  try {
    const health = JSON.parse(healthText);
    api = {
      schemaPatchCount: Number.isSafeInteger(health.schemaPatchCount)
        ? health.schemaPatchCount
        : null,
      schemaVersion: Number.isSafeInteger(health.schemaVersion)
        ? health.schemaVersion
        : null,
      status: health.status === "ok" ? "ok" : "unhealthy",
    };
    if (api.status !== "ok") addError("API_UNHEALTHY");
  } catch {
    addError("API_HEALTH_UNREADABLE");
  }
} else if (configuration.configured) {
  addError("API_UNREACHABLE");
}

let immich = { supported: "3.1.0", version: null };
const immichVersionText = containerProbe(
  "fetch(process.env.IMMICH_API_URL + '/server/version').then(r=>r.json()).then(v=>process.stdout.write([v.major,v.minor,v.patch].join('.')))",
);
if (immichVersionText && /^\d+\.\d+\.\d+$/u.test(immichVersionText)) {
  immich = { supported: "3.1.0", version: immichVersionText };
  if (immichVersionText !== immich.supported)
    addError("IMMICH_VERSION_UNSUPPORTED");
} else if (configuration.configured) {
  addError("IMMICH_UNREACHABLE");
}

const errors = [...errorCodes].sort();
const report = {
  api,
  configuration,
  containers: {
    composeVersion,
    dockerAvailable,
    services,
  },
  disk,
  immich,
  ok: errors.length === 0,
  product: { name: "Cimmich", version },
  reportSchema: "cimmich.doctor.v1",
  errors,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
