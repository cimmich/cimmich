import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  recognitionObservationSchemaVersion,
  validateRecognitionProviderManifest,
} from "./recognition-provider-contract.mjs";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";

export const insightFaceUserSuppliedRecognizerVersion =
  "cimmich.insightface-user-supplied-recognizer.v1";

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
  scriptPath,
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

  return Object.freeze({
    manifest,
    schemaVersion: insightFaceUserSuppliedRecognizerVersion,
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
      const metadata = Buffer.from(
        JSON.stringify({
          requests: observations.map((observation) => ({
            assetToken: assetId,
            observationId: observation.observationId,
            schemaVersion: "cimmich.recognition-request.v1",
            targetBox: observation.targetBox,
          })),
        }),
      );
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
          if (!Array.isArray(result?.packets)) {
            finish(() =>
              reject(
                recognizerError(
                  "LOCAL_RECOGNIZER_OUTPUT_INVALID",
                  "InsightFace recognizer omitted packets",
                ),
              ),
            );
            return;
          }
          finish(() =>
            resolve(
              result.packets.map((packet) => ({
                ...packet,
                schemaVersion: recognitionObservationSchemaVersion,
              })),
            ),
          );
        });
        child.stdin.on("error", () => {});
        child.stdin.end(Buffer.concat([header, metadata, bytes]));
      });
    },
  });
};
