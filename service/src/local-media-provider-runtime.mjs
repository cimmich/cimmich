import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createMediaPipelineManifest } from "./media-pipeline-contract.mjs";
import {
  createOpenCvSFaceRecognizer,
  openCvSFaceRecognizerVersion,
} from "./opencv-sface-recognizer.mjs";
import {
  createOpenCvYuNetDetector,
  openCvYuNetDetectorVersion,
} from "./opencv-yunet-detector.mjs";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";
import { validateRecognitionProviderManifest } from "./recognition-provider-contract.mjs";

export const localMediaProviderRuntimeVersion =
  "cimmich.local-media-provider-runtime.v1";
export const openCvReferenceProviderId = "opencv-yunet-sface-cpu";

const execFileAsync = promisify(execFile);
const sha256Pattern = /^[0-9a-f]{64}$/;

const runtimeError = (message, code = "LOCAL_MEDIA_PROVIDER_CONFIG_INVALID") =>
  Object.assign(new Error(message), { code });

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw runtimeError(`Local media provider requires ${label}`);
  return normalized;
};

const boundedInteger = (value, label, minimum, maximum, fallback) => {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw runtimeError(`Local media provider ${label} is invalid`);
  }
  return parsed;
};

const digestBuffer = (value) =>
  createHash("sha256").update(value).digest("hex");

const defaultFileDigest = async (path) => digestBuffer(await readFile(path));

const defaultReadJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw runtimeError("Local media provider manifest could not be read");
  }
};

const defaultRuntimeProbe = async (pythonPath) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      pythonPath,
      [
        "-I",
        "-c",
        "import cv2,json,sys;print(json.dumps({'opencvVersion':cv2.__version__,'pythonVersion':'.'.join(map(str,sys.version_info[:3]))}))",
      ],
      {
        encoding: "utf8",
        env: providerSubprocessEnvironment(),
        maxBuffer: 64 * 1024,
        timeout: 10_000,
      },
    ));
  } catch {
    throw runtimeError(
      "Local media provider Python/OpenCV runtime is unavailable",
    );
  }
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw runtimeError(
      "Local media provider runtime probe returned invalid output",
    );
  }
};

const assertDigest = (actual, expected, label) => {
  if (!sha256Pattern.test(actual) || actual !== expected) {
    throw runtimeError(
      `Local media provider ${label} digest does not match its manifest`,
    );
  }
};

export const loadLocalMediaProviderRuntime = async ({
  env = process.env,
  fileDigest = defaultFileDigest,
  readJson = defaultReadJson,
  runtimeProbe = defaultRuntimeProbe,
} = {}) => {
  const providerId = String(env.CIMMICH_LOCAL_MEDIA_PROVIDER || "").trim();
  if (!providerId) {
    return {
      enabled: false,
      matchingProvider: null,
      providerReceipt: {
        activationAuthority: "none",
        schemaVersion: localMediaProviderRuntimeVersion,
        state: "disabled",
      },
    };
  }
  if (providerId !== openCvReferenceProviderId) {
    throw runtimeError("Unsupported local media provider");
  }

  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const providerRoot = String(
    env.CIMMICH_OPENCV_PROVIDER_ROOT ||
      `${repositoryRoot}/providers/opencv-sface`,
  ).replace(/\/+$/, "");
  const paths = {
    detectorManifest: `${providerRoot}/detector-manifest.json`,
    detectorModel: requiredText(
      env.CIMMICH_OPENCV_DETECTOR_MODEL_PATH,
      "CIMMICH_OPENCV_DETECTOR_MODEL_PATH",
    ),
    detectorScript: `${providerRoot}/detect.py`,
    python: requiredText(
      env.CIMMICH_LOCAL_PYTHON_PATH,
      "CIMMICH_LOCAL_PYTHON_PATH",
    ),
    recognitionManifest: `${providerRoot}/provider-manifest.json`,
    recognitionModel: requiredText(
      env.CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH,
      "CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH",
    ),
    recognitionScript: `${providerRoot}/recognize.py`,
  };
  const [detectorManifest, recognitionManifestInput, probe] = await Promise.all(
    [
      readJson(paths.detectorManifest),
      readJson(paths.recognitionManifest),
      runtimeProbe(paths.python),
    ],
  );
  const recognitionManifest = validateRecognitionProviderManifest(
    recognitionManifestInput,
  );
  const expectedOpenCv = String(recognitionManifest.execution?.runtime || "")
    .replace(/^opencv-dnn-/, "")
    .trim();
  if (
    !expectedOpenCv ||
    !String(probe.opencvVersion || "").startsWith(`${expectedOpenCv}.`)
  ) {
    throw runtimeError(
      "Local media provider OpenCV runtime does not match its manifest",
    );
  }
  if (
    recognitionManifest.detector?.artifactSha256 !==
    detectorManifest.detector?.artifactSha256
  ) {
    throw runtimeError(
      "Detector and recognizer manifests bind different detector artifacts",
    );
  }

  const [
    detectorModelDigest,
    recognitionModelDigest,
    detectorScriptDigest,
    recognitionScriptDigest,
  ] = await Promise.all([
    fileDigest(paths.detectorModel),
    fileDigest(paths.recognitionModel),
    fileDigest(paths.detectorScript),
    fileDigest(paths.recognitionScript),
  ]);
  assertDigest(
    detectorModelDigest,
    detectorManifest.detector.artifactSha256,
    "detector model",
  );
  assertDigest(
    recognitionModelDigest,
    recognitionManifest.recognizer.artifactSha256,
    "recognizer model",
  );

  const detectorTimeoutMs = boundedInteger(
    env.CIMMICH_LOCAL_DETECTOR_TIMEOUT_MS,
    "detector timeout",
    1_000,
    600_000,
    120_000,
  );
  const recognitionTimeoutMs = boundedInteger(
    env.CIMMICH_LOCAL_RECOGNIZER_TIMEOUT_MS,
    "recognizer timeout",
    1_000,
    600_000,
    120_000,
  );
  const detector = createOpenCvYuNetDetector({
    detectorModelPath: paths.detectorModel,
    manifest: detectorManifest,
    manifestPath: paths.detectorManifest,
    pythonPath: paths.python,
    scriptPath: paths.detectorScript,
    timeoutMs: detectorTimeoutMs,
  });
  const recognizer = createOpenCvSFaceRecognizer({
    detectorModelPath: paths.detectorModel,
    manifest: recognitionManifest,
    manifestPath: paths.recognitionManifest,
    pythonPath: paths.python,
    recognizerModelPath: paths.recognitionModel,
    scriptPath: paths.recognitionScript,
    timeoutMs: recognitionTimeoutMs,
  });
  const pipelineManifest = createMediaPipelineManifest({
    detectorManifest,
    name: "opencv-reference-local-face-intelligence",
    recognitionManifest,
    recognitionToolVersion: openCvSFaceRecognizerVersion,
    version: "1",
  });
  const providerReceiptCore = {
    activationAuthority: "none",
    detectorConfigDigest: detectorManifest.detectorConfigDigest,
    detectorScriptDigest,
    externalUpload: "none",
    network: "forbidden",
    opencvVersion: String(probe.opencvVersion),
    pipelineConfigDigest: pipelineManifest.pipelineConfigDigest,
    providerId,
    pythonVersion: String(probe.pythonVersion),
    recognitionConfigDigest: recognitionManifest.providerConfigDigest,
    recognitionScriptDigest,
    schemaVersion: localMediaProviderRuntimeVersion,
    sourceMedia: "local-read-only",
    state: "ready",
    vectorSpaceId: recognitionManifest.vectorSpaceId,
  };
  return {
    detector,
    detectorManifest,
    enabled: true,
    inventoryJob: {
      configDigest: detectorManifest.detectorConfigDigest,
      maxAttempts: boundedInteger(
        env.CIMMICH_MEDIA_JOB_MAX_ATTEMPTS,
        "job max attempts",
        1,
        25,
        3,
      ),
      operation: "detect_faces",
      toolVersion: openCvYuNetDetectorVersion,
    },
    matchingProvider: Object.freeze({
      configDigest: recognitionManifest.recognitionSpaceConfigDigest,
      modelFamily: recognitionManifest.recognitionSpace.modelFamily,
      modelVersion: recognitionManifest.recognitionSpace.modelVersion,
      providerId,
      vectorSpaceId: recognitionManifest.vectorSpaceId,
    }),
    pipelineManifest,
    providerReceipt: {
      ...providerReceiptCore,
      runtimeDigest: digestBuffer(
        Buffer.from(JSON.stringify(providerReceiptCore)),
      ),
    },
    recognitionManifest,
    recognizer,
  };
};
