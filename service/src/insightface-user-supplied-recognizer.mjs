import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  faceDetectionDigest,
  faceDetectorSchemaVersion,
} from "./face-detector-contract.mjs";
import {
  recognitionObservationSchemaVersion,
  validateRecognitionProviderManifest,
} from "./recognition-provider-contract.mjs";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";
import { closeResidentProcess } from "./resident-process-shutdown.mjs";

export const insightFaceUserSuppliedRecognizerVersion =
  "cimmich.insightface-user-supplied-recognizer.v1";
export const insightFaceUserSuppliedDetectorVersion =
  "cimmich.insightface-user-supplied-detector.v1";

const recognizerError = (code, message) =>
  Object.assign(new Error(message), { code });
const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw recognizerError(
      "LOCAL_RECOGNIZER_CONFIG_INVALID",
      `InsightFace recognizer requires ${label}`,
    );
  }
  return normalized;
};

export const createInsightFaceUserSuppliedRecognizer = ({
  detectorModelPath,
  manifest: manifestInput,
  manifestPath,
  maxOutputBytes = 16 * 1024 * 1024,
  pythonPath,
  recognizerModelPath,
  residentProcess = false,
  scriptPath,
  shutdownTimeoutMs = 5_000,
  timeoutMs = 120_000,
} = {}) => {
  const manifest = validateRecognitionProviderManifest(manifestInput);
  const config = {
    detectorModelPath: requiredText(detectorModelPath, "detectorModelPath"),
    manifestPath: requiredText(manifestPath, "manifestPath"),
    pythonPath: requiredText(pythonPath, "pythonPath"),
    recognizerModelPath: requiredText(
      recognizerModelPath,
      "recognizerModelPath",
    ),
    scriptPath: requiredText(scriptPath, "scriptPath"),
  };
  const detectorManifestCore = {
    detector: manifest.detector,
    execution: manifest.execution,
    preprocessing: {
      colorSpace: "rgb",
      exifOrientation: "applied",
      inputSize: manifest.detector.inputSize,
      pipelineVersion: "insightface-scrfd-full-image-v1",
    },
    privacy: manifest.privacy,
    provider: manifest.provider,
  };
  const detectorManifest = Object.freeze({
    ...detectorManifestCore,
    detectorConfigDigest: faceDetectionDigest(detectorManifestCore),
    schemaVersion: faceDetectorSchemaVersion,
  });
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 600_000
  ) {
    throw recognizerError(
      "LOCAL_RECOGNIZER_CONFIG_INVALID",
      "InsightFace timeout is invalid",
    );
  }
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1024 ||
    maxOutputBytes > 64 * 1024 * 1024
  ) {
    throw recognizerError(
      "LOCAL_RECOGNIZER_CONFIG_INVALID",
      "InsightFace output limit is invalid",
    );
  }
  if (typeof residentProcess !== "boolean") {
    throw recognizerError(
      "LOCAL_RECOGNIZER_CONFIG_INVALID",
      "InsightFace resident-process selection is invalid",
    );
  }
  if (
    !Number.isInteger(shutdownTimeoutMs) ||
    shutdownTimeoutMs < 50 ||
    shutdownTimeoutMs > 30_000
  ) {
    throw recognizerError(
      "LOCAL_RECOGNIZER_CONFIG_INVALID",
      "InsightFace shutdown timeout is invalid",
    );
  }

  const validateCurrentManifest = async () => {
    let fileManifest;
    try {
      fileManifest = JSON.parse(await readFile(config.manifestPath, "utf8"));
    } catch {
      throw recognizerError(
        "LOCAL_RECOGNIZER_CONFIG_INVALID",
        "InsightFace manifest could not be read",
      );
    }
    const current = validateRecognitionProviderManifest(fileManifest);
    if (
      current.providerConfigDigest !== manifest.providerConfigDigest ||
      current.recognitionSpaceConfigDigest !==
        manifest.recognitionSpaceConfigDigest
    ) {
      throw recognizerError(
        "LOCAL_RECOGNIZER_CONFIG_INVALID",
        "InsightFace manifest changed after worker configuration",
      );
    }
  };

  const requestMetadata = ({ assetId, observations }) =>
    Buffer.from(
      JSON.stringify({
        requests: observations.map((observation) => ({
          assetToken: assetId,
          observationId: observation.observationId,
          schemaVersion: "cimmich.recognition-request.v1",
          targetBox: observation.targetBox,
        })),
      }),
    );

  const projectPackets = (result) => {
    if (result?.error?.code === "PROVIDER_REQUEST_FAILED") {
      const reason = String(result.error.reason || "provider-request-failed");
      throw recognizerError(
        "LOCAL_RECOGNIZER_REQUEST_FAILED",
        `InsightFace provider rejected request (${reason})`,
      );
    }
    if (!Array.isArray(result?.packets)) {
      throw recognizerError(
        "LOCAL_RECOGNIZER_OUTPUT_INVALID",
        "InsightFace recognizer omitted packets",
      );
    }
    return result.packets.map((packet) => ({
      ...packet,
      schemaVersion: recognitionObservationSchemaVersion,
    }));
  };

  let resident = null;
  let residentQueue = Promise.resolve();
  const stopResident = () => {
    const current = resident;
    resident = null;
    if (current && !current.killed) current.kill("SIGKILL");
  };
  const startResident = () => {
    if (resident && !resident.killed) return resident;
    const child = spawn(
      config.pythonPath,
      [
        config.scriptPath,
        "--manifest",
        config.manifestPath,
        "--detector-model",
        config.detectorModelPath,
        "--recognizer-model",
        config.recognizerModelPath,
        "--max-metadata-bytes",
        String(4 * 1024 * 1024),
        "--max-input-bytes",
        String(128 * 1024 * 1024),
        "--serve",
      ],
      {
        env: providerSubprocessEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.responseBuffer = Buffer.alloc(0);
    child.pendingResponse = null;
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk) => {
      child.responseBuffer = Buffer.concat([child.responseBuffer, chunk]);
      const pending = child.pendingResponse;
      if (!pending) {
        stopResident();
        return;
      }
      if (child.responseBuffer.length > maxOutputBytes + 8) {
        child.pendingResponse = null;
        pending.reject(
          recognizerError(
            "LOCAL_RECOGNIZER_OUTPUT_INVALID",
            "InsightFace output exceeded its bound",
          ),
        );
        stopResident();
        return;
      }
      if (child.responseBuffer.length < 8) return;
      const length = Number(child.responseBuffer.readBigUInt64BE(0));
      if (
        !Number.isSafeInteger(length) ||
        length < 2 ||
        length > maxOutputBytes
      ) {
        child.pendingResponse = null;
        pending.reject(
          recognizerError(
            "LOCAL_RECOGNIZER_OUTPUT_INVALID",
            "InsightFace response frame is invalid",
          ),
        );
        stopResident();
        return;
      }
      if (child.responseBuffer.length < length + 8) return;
      const payload = child.responseBuffer.subarray(8, length + 8);
      child.responseBuffer = child.responseBuffer.subarray(length + 8);
      child.pendingResponse = null;
      clearTimeout(pending.timer);
      try {
        pending.resolve(pending.project(JSON.parse(payload.toString("utf8"))));
      } catch (error) {
        pending.reject(
          error?.code
            ? error
            : recognizerError(
                "LOCAL_RECOGNIZER_OUTPUT_INVALID",
                "InsightFace recognizer returned invalid output",
              ),
        );
        stopResident();
      }
    });
    const rejectPending = () => {
      const pending = child.pendingResponse;
      child.pendingResponse = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(
          recognizerError(
            "LOCAL_RECOGNIZER_PROCESS_FAILED",
            "InsightFace resident recognizer stopped",
          ),
        );
      }
      if (resident === child) resident = null;
    };
    child.on("error", rejectPending);
    child.on("close", rejectPending);
    child.stdin.on("error", () => {});
    resident = child;
    return child;
  };

  const recognizeResident = async ({
    bytes,
    metadata,
    effectiveTimeoutMs,
    project = projectPackets,
  }) => {
    if (bytes.length > 128 * 1024 * 1024) {
      throw recognizerError(
        "LOCAL_RECOGNIZER_INPUT_INVALID",
        "InsightFace source media exceeded its resident-process bound",
      );
    }
    const child = startResident();
    if (child.pendingResponse) {
      throw recognizerError(
        "LOCAL_RECOGNIZER_PROCESS_FAILED",
        "InsightFace resident recognizer received overlapping work",
      );
    }
    const header = Buffer.alloc(16);
    header.writeBigUInt64BE(BigInt(metadata.length), 0);
    header.writeBigUInt64BE(BigInt(bytes.length), 8);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.pendingResponse = null;
        reject(
          recognizerError(
            "LOCAL_RECOGNIZER_TIMEOUT",
            "InsightFace recognizer timed out",
          ),
        );
        stopResident();
      }, effectiveTimeoutMs);
      child.pendingResponse = { project, reject, resolve, timer };
      child.stdin.write(Buffer.concat([header, metadata, bytes]), (error) => {
        if (!error) return;
        if (child.pendingResponse) {
          child.pendingResponse = null;
          clearTimeout(timer);
          reject(
            recognizerError(
              "LOCAL_RECOGNIZER_PROCESS_FAILED",
              "InsightFace resident recognizer write failed",
            ),
          );
        }
        stopResident();
      });
    });
  };

  return Object.freeze({
    detectorManifest,
    manifest,
    schemaVersion: insightFaceUserSuppliedRecognizerVersion,
    async close() {
      const child = resident;
      resident = null;
      if (!child || child.killed) return;
      await closeResidentProcess(child, { timeoutMs: shutdownTimeoutMs });
    },
    async detect({ bytes, timeoutMs: budget }) {
      if (!Buffer.isBuffer(bytes) || !bytes.length) {
        throw recognizerError(
          "LOCAL_DETECTOR_INPUT_INVALID",
          "InsightFace detector requires encoded image bytes",
        );
      }
      const effectiveTimeoutMs =
        budget == null
          ? timeoutMs
          : Math.min(timeoutMs, Math.floor(Number(budget)));
      if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1_000) {
        throw recognizerError(
          "LOCAL_RECOGNIZER_CONFIG_INVALID",
          "InsightFace command budget is invalid",
        );
      }
      await validateCurrentManifest();
      const run = residentQueue.then(() =>
        recognizeResident({
          bytes,
          effectiveTimeoutMs,
          metadata: Buffer.from(JSON.stringify({ operation: "detect" })),
          project: (result) => result,
        }),
      );
      residentQueue = run.catch(() => {});
      return run;
    },
    async recognize({ assetId, bytes, observations, timeoutMs: budget }) {
      if (!Buffer.isBuffer(bytes) || !bytes.length) {
        throw recognizerError(
          "LOCAL_RECOGNIZER_INPUT_INVALID",
          "InsightFace recognizer requires encoded image bytes",
        );
      }
      if (
        !Array.isArray(observations) ||
        observations.length < 1 ||
        observations.length > 1000
      ) {
        throw recognizerError(
          "LOCAL_RECOGNIZER_INPUT_INVALID",
          "InsightFace recognizer requires bounded observations",
        );
      }
      const effectiveTimeoutMs =
        budget == null
          ? timeoutMs
          : Math.min(timeoutMs, Math.floor(Number(budget)));
      if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1_000) {
        throw recognizerError(
          "LOCAL_RECOGNIZER_CONFIG_INVALID",
          "InsightFace command budget is invalid",
        );
      }
      await validateCurrentManifest();
      const metadata = requestMetadata({ assetId, observations });
      if (residentProcess) {
        const run = residentQueue.then(() =>
          recognizeResident({ bytes, effectiveTimeoutMs, metadata }),
        );
        residentQueue = run.catch(() => {});
        return run;
      }
      const header = Buffer.alloc(8);
      header.writeBigUInt64BE(BigInt(metadata.length));

      return new Promise((resolve, reject) => {
        const child = spawn(
          config.pythonPath,
          [
            config.scriptPath,
            "--manifest",
            config.manifestPath,
            "--detector-model",
            config.detectorModelPath,
            "--recognizer-model",
            config.recognizerModelPath,
            "--max-metadata-bytes",
            String(metadata.length),
            "--max-input-bytes",
            String(bytes.length),
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
          clearTimeout(timer);
          callback();
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() =>
            reject(
              recognizerError(
                "LOCAL_RECOGNIZER_TIMEOUT",
                "InsightFace recognizer timed out",
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
                recognizerError(
                  "LOCAL_RECOGNIZER_OUTPUT_INVALID",
                  "InsightFace output exceeded its bound",
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
              recognizerError(
                "LOCAL_RECOGNIZER_PROCESS_FAILED",
                "InsightFace recognizer could not start",
              ),
            ),
          ),
        );
        child.on("close", (code) => {
          if (settled) return;
          if (code !== 0) {
            finish(() =>
              reject(
                recognizerError(
                  "LOCAL_RECOGNIZER_PROCESS_FAILED",
                  "InsightFace recognizer failed",
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
                recognizerError(
                  "LOCAL_RECOGNIZER_OUTPUT_INVALID",
                  "InsightFace recognizer returned invalid output",
                ),
              ),
            );
            return;
          }
          finish(() => {
            try {
              resolve(projectPackets(result));
            } catch (error) {
              reject(error);
            }
          });
        });
        child.stdin.on("error", () => {});
        child.stdin.end(Buffer.concat([header, metadata, bytes]));
      });
    },
  });
};
