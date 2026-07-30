import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  bodyPoseResultSchemaVersion,
  validateBodyPoseManifest,
} from "./body-pose-provider-contract.mjs";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";
import { closeResidentProcess } from "./resident-process-shutdown.mjs";

export const ultralyticsYoloPoseDetectorVersion =
  "cimmich.ultralytics-yolo-pose-detector.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const runIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const poseError = (code, message) =>
  Object.assign(new Error(message), { code });
const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw poseError(
      "LOCAL_BODY_POSE_CONFIG_INVALID",
      `YOLO pose detector requires ${label}`,
    );
  }
  return normalized;
};
const requiredDigest = (value, label) => {
  const normalized = requiredText(value, label);
  if (!digestPattern.test(normalized)) {
    throw poseError(
      "LOCAL_BODY_POSE_INPUT_INVALID",
      `YOLO pose detector ${label} is invalid`,
    );
  }
  return normalized;
};

export const createUltralyticsYoloPoseDetector = ({
  manifest: manifestInput,
  manifestPath,
  maxInputBytes = 128 * 1024 * 1024,
  maxOutputBytes = 4 * 1024 * 1024,
  modelPath,
  pythonPath,
  scriptPath,
  shutdownTimeoutMs = 5_000,
  timeoutMs = 120_000,
} = {}) => {
  const manifest = validateBodyPoseManifest(manifestInput);
  const config = {
    manifestPath: requiredText(manifestPath, "manifestPath"),
    modelPath: requiredText(modelPath, "modelPath"),
    pythonPath: requiredText(pythonPath, "pythonPath"),
    scriptPath: requiredText(scriptPath, "scriptPath"),
  };
  for (const [value, label, minimum, maximum] of [
    [maxInputBytes, "input limit", 1024, 256 * 1024 * 1024],
    [maxOutputBytes, "output limit", 1024, 16 * 1024 * 1024],
    [shutdownTimeoutMs, "shutdown timeout", 50, 30_000],
    [timeoutMs, "timeout", 1_000, manifest.resources.maxRuntimeMs],
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw poseError(
        "LOCAL_BODY_POSE_CONFIG_INVALID",
        `YOLO pose detector ${label} is invalid`,
      );
    }
  }

  let child = null;
  let queue = Promise.resolve();

  const stop = () => {
    const current = child;
    child = null;
    if (current && !current.killed) current.kill("SIGKILL");
  };
  const rejectPending = (current) => {
    const pending = current.pendingResponse;
    current.pendingResponse = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(
        poseError(
          "LOCAL_BODY_POSE_PROCESS_FAILED",
          "YOLO resident pose detector stopped",
        ),
      );
    }
    if (child === current) child = null;
  };
  const start = () => {
    if (child && !child.killed) return child;
    const current = spawn(
      config.pythonPath,
      [
        config.scriptPath,
        "--serve",
        "--manifest",
        config.manifestPath,
        "--model",
        config.modelPath,
      ],
      {
        env: providerSubprocessEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    current.responseBuffer = Buffer.alloc(0);
    current.pendingResponse = null;
    current.stderr.on("data", () => {});
    current.stdout.on("data", (chunk) => {
      current.responseBuffer = Buffer.concat([current.responseBuffer, chunk]);
      const pending = current.pendingResponse;
      if (!pending) {
        stop();
        return;
      }
      if (current.responseBuffer.length > maxOutputBytes + 8) {
        current.pendingResponse = null;
        clearTimeout(pending.timer);
        pending.reject(
          poseError(
            "LOCAL_BODY_POSE_OUTPUT_INVALID",
            "YOLO pose detector output exceeded its bound",
          ),
        );
        stop();
        return;
      }
      if (current.responseBuffer.length < 8) return;
      const length = Number(current.responseBuffer.readBigUInt64BE(0));
      if (
        !Number.isSafeInteger(length) ||
        length < 2 ||
        length > maxOutputBytes
      ) {
        current.pendingResponse = null;
        clearTimeout(pending.timer);
        pending.reject(
          poseError(
            "LOCAL_BODY_POSE_OUTPUT_INVALID",
            "YOLO pose detector response frame is invalid",
          ),
        );
        stop();
        return;
      }
      if (current.responseBuffer.length < length + 8) return;
      const payload = current.responseBuffer.subarray(8, length + 8);
      current.responseBuffer = current.responseBuffer.subarray(length + 8);
      current.pendingResponse = null;
      clearTimeout(pending.timer);
      try {
        const result = JSON.parse(payload.toString("utf8"));
        if (result?.error) {
          throw poseError(
            "LOCAL_BODY_POSE_PROCESS_FAILED",
            `YOLO pose detector rejected the source: ${result.error.code}`,
          );
        }
        if (result?.schemaVersion !== bodyPoseResultSchemaVersion) {
          throw poseError(
            "LOCAL_BODY_POSE_OUTPUT_INVALID",
            "YOLO pose detector returned an invalid schema",
          );
        }
        pending.resolve({ result, runId: pending.runId });
      } catch (error) {
        pending.reject(
          error?.code
            ? error
            : poseError(
                "LOCAL_BODY_POSE_OUTPUT_INVALID",
                "YOLO pose detector returned invalid JSON",
              ),
        );
        stop();
      }
    });
    current.on("error", () => rejectPending(current));
    current.on("close", () => rejectPending(current));
    current.stdin.on("error", () => {});
    child = current;
    return current;
  };
  const validateCurrentManifest = async () => {
    let current;
    try {
      current = validateBodyPoseManifest(
        JSON.parse(await readFile(config.manifestPath, "utf8")),
      );
    } catch {
      throw poseError(
        "LOCAL_BODY_POSE_CONFIG_INVALID",
        "YOLO pose manifest is unavailable",
      );
    }
    if (current.poseConfigDigest !== manifest.poseConfigDigest) {
      throw poseError(
        "LOCAL_BODY_POSE_CONFIG_INVALID",
        "YOLO pose manifest changed after configuration",
      );
    }
  };
  const detectOne = async ({
    assetToken,
    bytes,
    inputRevision,
    runId,
    sourceContentDigest,
    timeoutMs: budget,
  }) => {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 1 ||
      bytes.length > maxInputBytes
    ) {
      throw poseError(
        "LOCAL_BODY_POSE_INPUT_INVALID",
        "YOLO pose detector source media is empty or oversized",
      );
    }
    const normalizedRunId = requiredText(runId, "runId");
    if (!runIdPattern.test(normalizedRunId)) {
      throw poseError(
        "LOCAL_BODY_POSE_INPUT_INVALID",
        "YOLO pose detector runId is invalid",
      );
    }
    const request = {
      assetToken: requiredDigest(assetToken, "assetToken"),
      inputRevision: requiredDigest(inputRevision, "inputRevision"),
      schemaVersion: "cimmich.ultralytics-yolo-pose-resident-request.v1",
      sourceContentDigest: requiredDigest(
        sourceContentDigest,
        "sourceContentDigest",
      ),
    };
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      request.sourceContentDigest
    ) {
      throw poseError(
        "LOCAL_BODY_POSE_INPUT_INVALID",
        "YOLO pose detector source digest does not match its bytes",
      );
    }
    const effectiveTimeoutMs =
      budget == null ? timeoutMs : Math.min(timeoutMs, Math.floor(Number(budget)));
    if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1_000) {
      throw poseError(
        "LOCAL_BODY_POSE_CONFIG_INVALID",
        "YOLO pose detector command budget is invalid",
      );
    }
    await validateCurrentManifest();
    const current = start();
    if (current.pendingResponse) {
      throw poseError(
        "LOCAL_BODY_POSE_PROCESS_FAILED",
        "YOLO pose detector received overlapping work",
      );
    }
    const metadata = Buffer.from(JSON.stringify(request));
    const header = Buffer.alloc(16);
    header.writeBigUInt64BE(BigInt(metadata.length), 0);
    header.writeBigUInt64BE(BigInt(bytes.length), 8);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pendingResponse = null;
        reject(
          poseError(
            "LOCAL_BODY_POSE_TIMEOUT",
            "YOLO pose detector timed out",
          ),
        );
        stop();
      }, effectiveTimeoutMs);
      current.pendingResponse = {
        reject,
        resolve,
        runId: normalizedRunId,
        timer,
      };
      current.stdin.write(
        Buffer.concat([header, metadata, bytes]),
        (error) => {
          if (!error) return;
          if (current.pendingResponse) {
            current.pendingResponse = null;
            clearTimeout(timer);
            reject(
              poseError(
                "LOCAL_BODY_POSE_PROCESS_FAILED",
                "YOLO pose detector write failed",
              ),
            );
          }
          stop();
        },
      );
    });
  };

  return Object.freeze({
    manifest,
    schemaVersion: ultralyticsYoloPoseDetectorVersion,
    async close() {
      const current = child;
      child = null;
      if (!current || current.killed) return;
      await closeResidentProcess(current, {
        timeoutMs: shutdownTimeoutMs,
      });
    },
    async detect(request) {
      const run = queue.then(() => detectOne(request));
      queue = run.catch(() => {});
      return run;
    },
  });
};
