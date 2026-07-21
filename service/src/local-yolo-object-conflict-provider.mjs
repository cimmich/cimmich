import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  bodyObjectConflictResultSchemaVersion,
  validateBodyObjectConflictManifest,
} from "./body-object-conflict-contract.mjs";

export const localYoloObjectConflictProviderVersion =
  "cimmich.local-yolo-object-conflict-provider.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const providerError = (code, message) =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const requiredPath = (value, label) => {
  const path = String(value || "").trim();
  if (!path || path.includes("\0"))
    throw providerError(
      "LOCAL_BODY_OBJECT_CONFIG_INVALID",
      `Local Body-object provider requires ${label}`,
    );
  return path;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value))
    throw providerError(
      "LOCAL_BODY_OBJECT_INPUT_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  return value;
};

const requiredRunId = (value) => {
  if (typeof value !== "string" || !publicIdPattern.test(value))
    throw providerError(
      "LOCAL_BODY_OBJECT_INPUT_INVALID",
      "runId must be a bounded lowercase identifier",
    );
  return value;
};

const fileDigest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export const createLocalYoloObjectConflictProvider = ({
  manifest: manifestInput,
  manifestPath,
  maxInputBytes = 128 * 1024 * 1024,
  maxOutputBytes = 1024 * 1024,
  modelPath,
  pythonPath,
  scriptPath,
  timeoutMs = 120_000,
} = {}) => {
  const manifest = validateBodyObjectConflictManifest(manifestInput);
  const config = {
    manifestPath: requiredPath(manifestPath, "manifestPath"),
    modelPath: requiredPath(modelPath, "modelPath"),
    pythonPath: requiredPath(pythonPath, "pythonPath"),
    scriptPath: requiredPath(scriptPath, "scriptPath"),
  };
  if (
    !Number.isInteger(maxInputBytes) ||
    maxInputBytes < 1024 ||
    maxInputBytes > 512 * 1024 * 1024 ||
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1024 ||
    maxOutputBytes > 4 * 1024 * 1024 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > manifest.resources.maxRuntimeMs
  )
    throw providerError(
      "LOCAL_BODY_OBJECT_CONFIG_INVALID",
      "Local Body-object resource bounds are invalid",
    );

  return Object.freeze({
    manifest,
    schemaVersion: localYoloObjectConflictProviderVersion,
    async detect({
      assetToken,
      bytes,
      inputRevision,
      runId,
      sourceContentDigest,
    }) {
      if (
        !Buffer.isBuffer(bytes) ||
        !bytes.length ||
        bytes.length > maxInputBytes
      )
        throw providerError(
          "LOCAL_BODY_OBJECT_INPUT_INVALID",
          "Local Body-object provider requires one bounded encoded image",
        );
      const header = {
        assetToken: requiredDigest(assetToken, "assetToken"),
        inputRevision: requiredDigest(inputRevision, "inputRevision"),
        schemaVersion: "cimmich.ultralytics-yolo-object-conflict-request.v1",
        sourceContentDigest: requiredDigest(
          sourceContentDigest,
          "sourceContentDigest",
        ),
      };
      const normalizedRunId = requiredRunId(runId);
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        header.sourceContentDigest
      )
        throw providerError(
          "LOCAL_BODY_OBJECT_INPUT_INVALID",
          "Encoded image digest does not match its source binding",
        );
      let diskManifest;
      try {
        diskManifest = validateBodyObjectConflictManifest(
          JSON.parse(await readFile(config.manifestPath, "utf8")),
        );
      } catch {
        throw providerError(
          "LOCAL_BODY_OBJECT_CONFIG_INVALID",
          "Local Body-object manifest is unavailable",
        );
      }
      if (
        diskManifest.objectConfigDigest !== manifest.objectConfigDigest ||
        (await fileDigest(config.modelPath)) !==
          manifest.detector.artifactDigest
      )
        throw providerError(
          "LOCAL_BODY_OBJECT_CONFIG_INVALID",
          "Local Body-object configuration changed after startup",
        );
      const headerBytes = Buffer.from(JSON.stringify(header));
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(headerBytes.length);
      const result = await new Promise((resolve, reject) => {
        const child = spawn(
          config.pythonPath,
          [
            config.scriptPath,
            "--manifest",
            config.manifestPath,
            "--model",
            config.modelPath,
            "--max-input-bytes",
            String(maxInputBytes),
          ],
          {
            env: {
              HOME: "/tmp/cimmich-object-conflict-home",
              MPLCONFIGDIR: "/tmp/cimmich-object-conflict-matplotlib",
              PATH: process.env.PATH || "",
              PYTHONNOUSERSITE: "1",
              XDG_CACHE_HOME: "/tmp/cimmich-object-conflict-cache",
              YOLO_AUTOINSTALL: "false",
              YOLO_CONFIG_DIR: "/tmp/cimmich-ultralytics-object-conflict",
              YOLO_OFFLINE: "true",
            },
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let settled = false;
        let outputBytes = 0;
        const output = [];
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback();
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() =>
            reject(
              providerError(
                "LOCAL_BODY_OBJECT_TIMEOUT",
                "Local Body-object provider timed out",
              ),
            ),
          );
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > maxOutputBytes) {
            child.kill("SIGKILL");
            finish(() =>
              reject(
                providerError(
                  "LOCAL_BODY_OBJECT_OUTPUT_INVALID",
                  "Local Body-object output exceeded its bound",
                ),
              ),
            );
            return;
          }
          output.push(Buffer.from(chunk));
        });
        child.stderr.on("data", () => {});
        child.on("error", () =>
          finish(() =>
            reject(
              providerError(
                "LOCAL_BODY_OBJECT_PROCESS_FAILED",
                "Local Body-object provider could not start",
              ),
            ),
          ),
        );
        child.on("close", (code) => {
          if (settled) return;
          if (code !== 0)
            return finish(() =>
              reject(
                providerError(
                  "LOCAL_BODY_OBJECT_PROCESS_FAILED",
                  "Local Body-object provider failed",
                ),
              ),
            );
          try {
            const parsed = JSON.parse(
              Buffer.concat(output, outputBytes).toString("utf8"),
            );
            if (parsed?.schemaVersion !== bodyObjectConflictResultSchemaVersion)
              throw new Error();
            finish(() => resolve(parsed));
          } catch {
            finish(() =>
              reject(
                providerError(
                  "LOCAL_BODY_OBJECT_OUTPUT_INVALID",
                  "Local Body-object provider returned invalid output",
                ),
              ),
            );
          }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(Buffer.concat([prefix, headerBytes, bytes]));
      });
      return Object.freeze({ result, runId: normalizedRunId });
    },
  });
};
