import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { validateFaceDetectorManifest } from "./face-detector-contract.mjs";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";

export const openCvYuNetDetectorVersion = "cimmich.opencv-yunet-detector.v1";

const detectorError = (code, message) =>
  Object.assign(new Error(message), { code });

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized)
    throw detectorError(
      "LOCAL_DETECTOR_CONFIG_INVALID",
      `YuNet detector requires ${label}`,
    );
  return normalized;
};

export const createOpenCvYuNetDetector = ({
  detectorModelPath,
  manifest: manifestInput,
  manifestPath,
  maxOutputBytes = 1024 * 1024,
  pythonPath,
  scriptPath,
  timeoutMs = 120_000,
} = {}) => {
  const manifest = validateFaceDetectorManifest(manifestInput);
  const config = {
    detectorModelPath: requiredText(detectorModelPath, "detectorModelPath"),
    manifestPath: requiredText(manifestPath, "manifestPath"),
    pythonPath: requiredText(pythonPath, "pythonPath"),
    scriptPath: requiredText(scriptPath, "scriptPath"),
  };
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 600_000
  ) {
    throw detectorError(
      "LOCAL_DETECTOR_CONFIG_INVALID",
      "YuNet timeout is invalid",
    );
  }
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1024 ||
    maxOutputBytes > 16 * 1024 * 1024
  ) {
    throw detectorError(
      "LOCAL_DETECTOR_CONFIG_INVALID",
      "YuNet output limit is invalid",
    );
  }

  return {
    manifest,
    schemaVersion: openCvYuNetDetectorVersion,

    async detect({ bytes, timeoutMs: requestedTimeoutMs }) {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw detectorError(
          "LOCAL_DETECTOR_INPUT_INVALID",
          "YuNet detector requires encoded image bytes",
        );
      }
      const effectiveTimeoutMs =
        requestedTimeoutMs == null
          ? timeoutMs
          : Math.min(timeoutMs, Math.floor(Number(requestedTimeoutMs)));
      if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1_000) {
        throw detectorError(
          "LOCAL_DETECTOR_CONFIG_INVALID",
          "YuNet command budget is invalid",
        );
      }
      let fileManifest;
      try {
        fileManifest = JSON.parse(await readFile(config.manifestPath, "utf8"));
      } catch {
        throw detectorError(
          "LOCAL_DETECTOR_CONFIG_INVALID",
          "YuNet detector manifest could not be read",
        );
      }
      const validatedFileManifest = validateFaceDetectorManifest(fileManifest);
      if (
        validatedFileManifest.detectorConfigDigest !==
        manifest.detectorConfigDigest
      ) {
        throw detectorError(
          "LOCAL_DETECTOR_CONFIG_INVALID",
          "YuNet detector manifest changed after worker configuration",
        );
      }

      return new Promise((resolve, reject) => {
        const child = spawn(
          config.pythonPath,
          [
            config.scriptPath,
            "--manifest",
            config.manifestPath,
            "--detector-model",
            config.detectorModelPath,
            "--max-input-bytes",
            String(Math.max(bytes.length, 1024 * 1024)),
          ],
          {
            env: providerSubprocessEnvironment(),
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
          clearTimeout(timeout);
          callback();
        };
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() =>
            reject(
              detectorError(
                "LOCAL_DETECTOR_TIMEOUT",
                "YuNet detector timed out",
              ),
            ),
          );
        }, effectiveTimeoutMs);
        child.stdout.on("data", (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > maxOutputBytes) {
            child.kill("SIGKILL");
            finish(() =>
              reject(
                detectorError(
                  "LOCAL_DETECTOR_OUTPUT_INVALID",
                  "YuNet detector output exceeded its bound",
                ),
              ),
            );
            return;
          }
          output.push(Buffer.from(chunk));
        });
        child.stderr.on("data", () => {});
        child.on("error", () => {
          finish(() =>
            reject(
              detectorError(
                "LOCAL_DETECTOR_PROCESS_FAILED",
                "YuNet detector could not start",
              ),
            ),
          );
        });
        child.on("close", (code) => {
          if (settled) return;
          if (code !== 0) {
            finish(() =>
              reject(
                detectorError(
                  "LOCAL_DETECTOR_PROCESS_FAILED",
                  "YuNet detector failed",
                ),
              ),
            );
            return;
          }
          let result;
          try {
            result = JSON.parse(
              Buffer.concat(output, outputBytes).toString("utf8"),
            );
          } catch {
            finish(() =>
              reject(
                detectorError(
                  "LOCAL_DETECTOR_OUTPUT_INVALID",
                  "YuNet detector returned invalid output",
                ),
              ),
            );
            return;
          }
          finish(() => resolve(result));
        });
        child.stdin.on("error", () => {});
        child.stdin.end(bytes);
      });
    },
  };
};
