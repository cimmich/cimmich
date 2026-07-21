import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  bodyMaskResultSchemaVersion,
  validateBodyMaskManifest,
} from "./body-mask-provider-contract.mjs";

export const localSam2BodyMaskProviderSchemaVersion =
  "cimmich.local-sam2-body-mask-provider.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,95})$/;
const providerError = (code, message) =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const requiredPath = (value, label) => {
  const path = String(value || "").trim();
  if (!path || path.includes("\0"))
    throw providerError(
      "LOCAL_BODY_MASK_CONFIG_INVALID",
      `Local Body-mask provider requires ${label}`,
    );
  return path;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value))
    throw providerError(
      "LOCAL_BODY_MASK_INPUT_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  return value;
};

const requiredRunId = (value) => {
  if (typeof value !== "string" || !publicIdPattern.test(value))
    throw providerError(
      "LOCAL_BODY_MASK_INPUT_INVALID",
      "runId must be a bounded lowercase identifier",
    );
  return value;
};

const requiredPrompts = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000)
    throw providerError(
      "LOCAL_BODY_MASK_INPUT_INVALID",
      "Body-mask prompts are invalid",
    );
  return value;
};

const fileDigest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export const createLocalSam2BodyMaskProvider = ({
  checkpointPath,
  manifest: manifestInput,
  manifestPath,
  maxInputBytes,
  maxOutputBytes,
  pythonPath,
  sam2DepsPath,
  sam2SourcePath,
  scriptPath,
  timeoutMs,
} = {}) => {
  const manifest = validateBodyMaskManifest(manifestInput);
  const config = {
    checkpointPath: requiredPath(checkpointPath, "checkpointPath"),
    manifestPath: requiredPath(manifestPath, "manifestPath"),
    pythonPath: requiredPath(pythonPath, "pythonPath"),
    sam2DepsPath: requiredPath(sam2DepsPath, "sam2DepsPath"),
    sam2SourcePath: requiredPath(sam2SourcePath, "sam2SourcePath"),
    scriptPath: requiredPath(scriptPath, "scriptPath"),
  };
  const inputLimit = maxInputBytes ?? manifest.resources.maxInputBytes;
  const outputLimit = maxOutputBytes ?? manifest.resources.maxOutputBytes;
  const runtimeLimit = timeoutMs ?? manifest.resources.maxRuntimeMs;
  if (
    !Number.isInteger(inputLimit) ||
    inputLimit < 1024 ||
    inputLimit > manifest.resources.maxInputBytes ||
    !Number.isInteger(outputLimit) ||
    outputLimit < 1024 ||
    outputLimit > manifest.resources.maxOutputBytes ||
    !Number.isInteger(runtimeLimit) ||
    runtimeLimit < 1000 ||
    runtimeLimit > manifest.resources.maxRuntimeMs
  )
    throw providerError(
      "LOCAL_BODY_MASK_CONFIG_INVALID",
      "Local Body-mask resource bounds are invalid",
    );

  return Object.freeze({
    manifest,
    schemaVersion: localSam2BodyMaskProviderSchemaVersion,
    async detect({
      assetToken,
      bodyResultDigest,
      bytes,
      inputRevision,
      prompts,
      runId,
      sourceContentDigest,
    }) {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > inputLimit)
        throw providerError(
          "LOCAL_BODY_MASK_INPUT_INVALID",
          "Local Body-mask provider requires one bounded encoded image",
        );
      const header = {
        assetToken: requiredDigest(assetToken, "assetToken"),
        bodyResultDigest: requiredDigest(bodyResultDigest, "bodyResultDigest"),
        inputRevision: requiredDigest(inputRevision, "inputRevision"),
        prompts: requiredPrompts(prompts),
        schemaVersion: "cimmich.sam2-body-mask-request.v1",
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
          "LOCAL_BODY_MASK_INPUT_INVALID",
          "Encoded image digest does not match its source binding",
        );
      let diskManifest;
      try {
        diskManifest = validateBodyMaskManifest(
          JSON.parse(await readFile(config.manifestPath, "utf8")),
        );
      } catch {
        throw providerError(
          "LOCAL_BODY_MASK_CONFIG_INVALID",
          "Local Body-mask manifest is unavailable",
        );
      }
      if (
        diskManifest.maskConfigDigest !== manifest.maskConfigDigest ||
        (await fileDigest(config.checkpointPath)) !==
          manifest.mask.artifactDigest
      )
        throw providerError(
          "LOCAL_BODY_MASK_CONFIG_INVALID",
          "Local Body-mask configuration changed after startup",
        );
      const headerBytes = Buffer.from(JSON.stringify(header));
      if (headerBytes.length > 1024 * 1024)
        throw providerError(
          "LOCAL_BODY_MASK_INPUT_INVALID",
          "Body-mask prompt packet exceeds its bound",
        );
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(headerBytes.length);
      const result = await new Promise((resolve, reject) => {
        const child = spawn(
          config.pythonPath,
          [
            config.scriptPath,
            "--checkpoint",
            config.checkpointPath,
            "--manifest",
            config.manifestPath,
            "--max-input-bytes",
            String(inputLimit),
            "--sam2-deps",
            config.sam2DepsPath,
            "--sam2-source",
            config.sam2SourcePath,
          ],
          {
            env: {
              HOME: "/tmp/cimmich-sam2-home",
              PATH: process.env.PATH || "",
              PYTHONNOUSERSITE: "1",
              XDG_CACHE_HOME: "/tmp/cimmich-sam2-cache",
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
                "LOCAL_BODY_MASK_TIMEOUT",
                "Local Body-mask provider timed out",
              ),
            ),
          );
        }, runtimeLimit);
        child.stdout.on("data", (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > outputLimit) {
            child.kill("SIGKILL");
            finish(() =>
              reject(
                providerError(
                  "LOCAL_BODY_MASK_OUTPUT_INVALID",
                  "Local Body-mask output exceeded its bound",
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
                "LOCAL_BODY_MASK_PROCESS_FAILED",
                "Local Body-mask provider could not start",
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
                  "LOCAL_BODY_MASK_PROCESS_FAILED",
                  "Local Body-mask provider failed",
                ),
              ),
            );
          try {
            const parsed = JSON.parse(
              Buffer.concat(output, outputBytes).toString("utf8"),
            );
            if (parsed?.schemaVersion !== bodyMaskResultSchemaVersion)
              throw new Error();
            finish(() => resolve(parsed));
          } catch {
            finish(() =>
              reject(
                providerError(
                  "LOCAL_BODY_MASK_OUTPUT_INVALID",
                  "Local Body-mask provider returned invalid output",
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
