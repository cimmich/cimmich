import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const doctor = path.join(root, "tools/doctor.mjs");
let fixtureRoot;
let dockerStub;

before(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cimmich-doctor-test-"));
  dockerStub = path.join(fixtureRoot, "docker-stub.sh");
  await writeFile(
    dockerStub,
    `#!/bin/sh
case "$*" in
  "version --format {{.Server.Version}}") printf '28.3.0\\n' ;;
  "compose version --short") printf '2.39.1\\n' ;;
  *" ps --all --format json") printf '%s\\n' '[{"Service":"cimmich-api","State":"running","Health":"healthy"},{"Service":"cimmich-database","State":"running","Health":"healthy"},{"Service":"cimmich-gateway","State":"running","Health":"healthy"},{"Service":"cimmich-ui","State":"running","Health":"healthy"}]' ;;
  *"fetch('http://127.0.0.1:3101/health')"*) printf '%s' '{"schemaPatchCount":1,"schemaVersion":120,"status":"ok"}' ;;
  *"process.env.IMMICH_API_URL"*) printf '3.1.0' ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o700 },
  );
});

after(async () => {
  await rm(fixtureRoot, { force: true, recursive: true });
});

test("doctor reports useful healthy facts without exposing configuration", async () => {
  const stateRoot = path.join(fixtureRoot, "state-with-private-name");
  await mkdir(stateRoot);
  const environmentFile = path.join(stateRoot, "runtime.env");
  const secret = "never-print-this-database-password";
  await writeFile(
    environmentFile,
    [
      "CIMMICH_COMPANION_API_PORT=3411",
      "CIMMICH_COMPANION_UI_PORT=3413",
      `CIMMICH_DB_PASSWORD=${secret}`,
      "CIMMICH_IMMICH_API_URL=http://private-immich-host:2283/api",
      "CIMMICH_IMMICH_WEB_ORIGIN=http://private-immich-host:2283",
      "",
    ].join("\n"),
  );
  await chmod(environmentFile, 0o600);

  const result = spawnSync(process.execPath, [doctor], {
    encoding: "utf8",
    env: {
      ...process.env,
      CIMMICH_COMPANION_STATE_ROOT: stateRoot,
      CIMMICH_DOCTOR_DOCKER_COMMAND: dockerStub,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.api.schemaVersion, 120);
  assert.equal(report.immich.version, "3.1.0");
  assert.equal(report.containers.services.length, 4);
  assert.doesNotMatch(
    result.stdout,
    /never-print|private-immich-host|state-with-private-name/u,
  );
});

test("doctor emits stable error codes when Cimmich is not configured", () => {
  const missingRoot = path.join(fixtureRoot, "missing-private-path");
  const result = spawnSync(process.execPath, [doctor], {
    encoding: "utf8",
    env: {
      ...process.env,
      CIMMICH_COMPANION_STATE_ROOT: missingRoot,
      CIMMICH_DOCTOR_DOCKER_COMMAND: dockerStub,
    },
  });

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.configuration.configured, false);
  assert.ok(report.errors.includes("CONFIG_NOT_FOUND"));
  assert.doesNotMatch(result.stdout, /missing-private-path/u);
});
