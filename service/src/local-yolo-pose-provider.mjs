import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  bodyPoseResultSchemaVersion,
  validateBodyPoseManifest,
} from "./body-pose-provider-contract.mjs";

export const localYoloPoseProviderVersion =
  "cimmich.local-yolo-pose-provider.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const providerError = (code, message) =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const requiredPath = (value, label) => {
  const path = String(value || "").trim();
  if (!path || path.includes("\0"))
    throw providerError(
      "LOCAL_BODY_POSE_CONFIG_INVALID",
      `Local Body-pose provider requires ${label}`,
    );
  return path;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value))
    throw providerError(
      "LOCAL_BODY_POSE_INPUT_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  return value;
};

const requiredRunId = (value) => {
  if (typeof value !== "string" || !publicIdPattern.test(value))
    throw providerError(
      "LOCAL_BODY_POSE_INPUT_INVALID",
      "runId must be a bounded lowercase identifier",
    );
  return value;
};

const fileDigest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export const createLocalYoloPoseProvider = ({
  manifest: manifestInput,
  manifestPath,
  maxInputBytes = 128 * 1024 * 1024,
  maxOutputBytes = 4 * 1024 * 1024,
  modelPath,
  pythonPath,
  scriptPath,
  timeoutMs = 120_000,
} = {}) => {
  const manifest = validateBodyPoseManifest(manifestInput);
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
    maxOutputBytes > 16 * 1024 * 1024 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > manifest.resources.maxRuntimeMs
  )
    throw providerError(
      "LOCAL_BODY_POSE_CONFIG_INVALID",
      "Local Body-pose resource bounds are invalid",
    );

  return Object.freeze({
    manifest,
    schemaVersion: localYoloPoseProviderVersion,
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
          "LOCAL_BODY_POSE_INPUT_INVALID",
          "Local Body-pose provider requires one bounded encoded image",
        );
      const header = {
        assetToken: requiredDigest(assetToken, "assetToken"),
        inputRevision: requiredDigest(inputRevision, "inputRevision"),
        schemaVersion: "cimmich.ultralytics-yolo-pose-request.v1",
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
          "LOCAL_BODY_POSE_INPUT_INVALID",
          "Encoded image digest does not match its source binding",
        );
      let diskManifest;
      try {
        diskManifest = validateBodyPoseManifest(
          JSON.parse(await readFile(config.manifestPath, "utf8")),
        );
      } catch {
        throw providerError(
          "LOCAL_BODY_POSE_CONFIG_INVALID",
          "Local Body-pose manifest is unavailable",
        );
      }
      if (
        diskManifest.poseConfigDigest !== manifest.poseConfigDigest ||
        (await fileDigest(config.modelPath)) !== manifest.pose.artifactDigest
      )
        throw providerError(
          "LOCAL_BODY_POSE_CONFIG_INVALID",
          "Local Body-pose configuration changed after startup",
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
              HOME: "/tmp/cimmich-pose-home",
              MPLCONFIGDIR: "/tmp/cimmich-pose-matplotlib",
              PATH: process.env.PATH || "",
              PYTHONNOUSERSITE: "1",
              XDG_CACHE_HOME: "/tmp/cimmich-pose-cache",
              YOLO_AUTOINSTALL: "false",
              YOLO_CONFIG_DIR: "/tmp/cimmich-ultralytics-pose",
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
                "LOCAL_BODY_POSE_TIMEOUT",
                "Local Body-pose provider timed out",
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
                  "LOCAL_BODY_POSE_OUTPUT_INVALID",
                  "Local Body-pose output exceeded its bound",
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
                "LOCAL_BODY_POSE_PROCESS_FAILED",
                "Local Body-pose provider could not start",
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
                  "LOCAL_BODY_POSE_PROCESS_FAILED",
                  "Local Body-pose provider failed",
                ),
              ),
            );
          try {
            const parsed = JSON.parse(
              Buffer.concat(output, outputBytes).toString("utf8"),
            );
            if (parsed?.schemaVersion !== bodyPoseResultSchemaVersion)
              throw new Error();
            finish(() => resolve(parsed));
          } catch {
            finish(() =>
              reject(
                providerError(
                  "LOCAL_BODY_POSE_OUTPUT_INVALID",
                  "Local Body-pose provider returned invalid output",
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
