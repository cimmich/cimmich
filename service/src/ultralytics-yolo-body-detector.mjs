import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  validateBodyDetectorManifest,
} from "./body-detector-contract.mjs";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";

export const ultralyticsYoloBodyDetectorVersion =
  "cimmich.ultralytics-yolo-body-detector.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const detectorError = (code, message) =>
  Object.assign(new Error(message), { code });
const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw detectorError(
      "LOCAL_BODY_DETECTOR_CONFIG_INVALID",
      `YOLO body detector requires ${label}`,
    );
  }
  return normalized;
};
const requiredDigest = (value, label) => {
  const normalized = requiredText(value, label);
  if (!digestPattern.test(normalized)) {
    throw detectorError(
      "LOCAL_BODY_DETECTOR_INPUT_INVALID",
      `YOLO body detector ${label} is invalid`,
    );
  }
  return normalized;
};

export const createUltralyticsYoloBodyDetector = ({
  manifest: manifestInput,
  manifestPath,
  maxInputBytes = 128 * 1024 * 1024,
  maxOutputBytes = 4 * 1024 * 1024,
  modelPath,
  pythonPath,
  scriptPath,
  timeoutMs = 120_000,
} = {}) => {
  const manifest = validateBodyDetectorManifest(manifestInput);
  const config = {
    manifestPath: requiredText(manifestPath, "manifestPath"),
    modelPath: requiredText(modelPath, "modelPath"),
    pythonPath: requiredText(pythonPath, "pythonPath"),
    scriptPath: requiredText(scriptPath, "scriptPath"),
  };
  for (const [value, label, minimum, maximum] of [
    [maxInputBytes, "input limit", 1024, 256 * 1024 * 1024],
    [maxOutputBytes, "output limit", 1024, 16 * 1024 * 1024],
    [timeoutMs, "timeout", 1_000, 600_000],
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw detectorError(
        "LOCAL_BODY_DETECTOR_CONFIG_INVALID",
        `YOLO body detector ${label} is invalid`,
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
        detectorError(
          "LOCAL_BODY_DETECTOR_PROCESS_FAILED",
          "YOLO resident body detector stopped",
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
      current.responseBuffer = Buffer.concat([
        current.responseBuffer,
        chunk,
      ]);
      const pending = current.pendingResponse;
      if (!pending) {
        stop();
        return;
      }
      if (current.responseBuffer.length > maxOutputBytes + 8) {
        current.pendingResponse = null;
        clearTimeout(pending.timer);
        pending.reject(
          detectorError(
            "LOCAL_BODY_DETECTOR_OUTPUT_INVALID",
            "YOLO body detector output exceeded its bound",
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
          detectorError(
            "LOCAL_BODY_DETECTOR_OUTPUT_INVALID",
            "YOLO body detector response frame is invalid",
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
          if (
            result.error.code === "ULTRALYTICS_BODY_SOURCE_UNREADABLE"
          ) {
            pending.resolve({
              assetToken: pending.request.assetToken,
              bodies: [],
              detectorConfigDigest: manifest.detectorConfigDigest,
              inputRevision: pending.request.inputRevision,
              schemaVersion: "cimmich.body-detection-result.v1",
              sourceContentDigest: pending.request.sourceContentDigest,
              state: "source_unreadable",
            });
            return;
          }
          throw detectorError(
            "LOCAL_BODY_DETECTOR_PROCESS_FAILED",
            "YOLO body detector rejected the source media",
          );
        }
        pending.resolve(result);
      } catch (error) {
        pending.reject(
          error?.code
            ? error
            : detectorError(
                "LOCAL_BODY_DETECTOR_OUTPUT_INVALID",
                "YOLO body detector returned invalid JSON",
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
      current = validateBodyDetectorManifest(
        JSON.parse(await readFile(config.manifestPath, "utf8")),
      );
    } catch {
      throw detectorError(
        "LOCAL_BODY_DETECTOR_CONFIG_INVALID",
        "YOLO body detector manifest is unavailable",
      );
    }
    if (current.detectorConfigDigest !== manifest.detectorConfigDigest) {
      throw detectorError(
        "LOCAL_BODY_DETECTOR_CONFIG_INVALID",
        "YOLO body detector manifest changed after configuration",
      );
    }
  };

  const detectOne = async ({
    assetToken,
    bytes,
    inputRevision,
    sourceContentDigest,
    timeoutMs: budget,
  }) => {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maxInputBytes) {
      throw detectorError(
        "LOCAL_BODY_DETECTOR_INPUT_INVALID",
        "YOLO body detector source media is empty or oversized",
      );
    }
    const request = {
      assetToken: requiredDigest(assetToken, "assetToken"),
      inputRevision: requiredDigest(inputRevision, "inputRevision"),
      schemaVersion: "cimmich.ultralytics-yolo-body-resident-request.v1",
      sourceContentDigest: requiredDigest(
        sourceContentDigest,
        "sourceContentDigest",
      ),
    };
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      request.sourceContentDigest
    ) {
      throw detectorError(
        "LOCAL_BODY_DETECTOR_INPUT_INVALID",
        "YOLO body detector source digest does not match its bytes",
      );
    }
    const effectiveTimeoutMs =
      budget == null ? timeoutMs : Math.min(timeoutMs, Math.floor(Number(budget)));
    if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1_000) {
      throw detectorError(
        "LOCAL_BODY_DETECTOR_CONFIG_INVALID",
        "YOLO body detector command budget is invalid",
      );
    }
    await validateCurrentManifest();
    const current = start();
    if (current.pendingResponse) {
      throw detectorError(
        "LOCAL_BODY_DETECTOR_PROCESS_FAILED",
        "YOLO body detector received overlapping work",
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
          detectorError(
            "LOCAL_BODY_DETECTOR_TIMEOUT",
            "YOLO body detector timed out",
          ),
        );
        stop();
      }, effectiveTimeoutMs);
      current.pendingResponse = { reject, request, resolve, timer };
      current.stdin.write(
        Buffer.concat([header, metadata, bytes]),
        (error) => {
          if (!error) return;
          if (current.pendingResponse) {
            current.pendingResponse = null;
            clearTimeout(timer);
            reject(
              detectorError(
                "LOCAL_BODY_DETECTOR_PROCESS_FAILED",
                "YOLO body detector write failed",
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
    schemaVersion: ultralyticsYoloBodyDetectorVersion,
    async close() {
      const current = child;
      child = null;
      if (!current || current.killed) return;
      await new Promise((resolve) => {
        current.once("close", resolve);
        current.stdin.end();
      });
    },
    async detect(request) {
      const run = queue.then(() => detectOne(request));
      queue = run.catch(() => {});
      return run;
    },
  });
};
