import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "cimmich.local-ai-jobs.v1";
const operationMap = new Map([
  ["faces", "faces"],
  ["quick", "enhance-preview"],
  ["best", "enhance"],
  ["bodies", "bodies"],
  ["poses", "poses"],
  ["context", "context"],
  ["scene-text", "scene-text"],
]);
const finalStates = new Set(["cancelled", "completed", "failed", "partial"]);
const maxRetainedRuns = 12;
const maxStoreBytes = 4 * 1024 * 1024 * 1024;
const maxQueuedJobs = 4;
const maximumRunMs = 32 * 60 * 1000;
const progressPrefix = "CIMMICH_LOCAL_AI_PROGRESS ";
const progressStages = new Set([
  "checking-result",
  "complete",
  "encoding",
  "resampling",
  "sharpening",
  "upscaling",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const isContained = (root, candidate) => {
  const normalizedRoot = `${resolve(root)}${sep}`;
  return resolve(candidate).startsWith(normalizedRoot);
};

const exactJobInput = (input, maximumAssets) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw typedError(
      "Local AI input is invalid",
      400,
      "LOCAL_AI_INPUT_INVALID",
    );
  }
  const keys = Object.keys(input).sort().join(",");
  if (keys !== "operation,sourceAssetIds") {
    throw typedError(
      "Local AI input must contain only operation and sourceAssetIds",
      400,
      "LOCAL_AI_INPUT_INVALID",
    );
  }
  const operation = String(input.operation || "").trim();
  const sourceAssetIds = Array.isArray(input.sourceAssetIds)
    ? input.sourceAssetIds.map((value) => String(value || "").trim())
    : [];
  if (!operationMap.has(operation)) {
    throw typedError(
      "Local AI operation is unsupported",
      400,
      "LOCAL_AI_OPERATION_INVALID",
    );
  }
  if (
    sourceAssetIds.length < 1 ||
    sourceAssetIds.length > maximumAssets ||
    sourceAssetIds.some((value) => !uuidPattern.test(value)) ||
    new Set(sourceAssetIds).size !== sourceAssetIds.length
  ) {
    throw typedError(
      `Local AI accepts 1-${maximumAssets} unique photo IDs`,
      400,
      "LOCAL_AI_ASSETS_INVALID",
    );
  }
  return { operation, sourceAssetIds };
};

const providerConfig = ({ enabled, environment, modelPaths }) => {
  const enhanceDevice = environment.CIMMICH_LOCAL_AI_ENHANCE_DEVICE || "cpu";
  return {
    contextPolicy: {
      maximumTemporalGapSeconds: 600,
      minimumMargin: 0.08,
      minimumSimilarity: 0.72,
      requireBidirectionalAnchors: true,
    },
    limits: {
      enhanceProviderTimeoutMs: 30 * 60 * 1000,
      maxAssets: 12,
      maxEnhanceInputPixels: 16_000_000,
      maxInputBytes: 128 * 1024 * 1024,
      maxInputPixels: 100_000_000,
      providerTimeoutMs: 10 * 60 * 1000,
    },
    providers: {
      bodies: {
        enabled:
          enabled &&
          environment.CIMMICH_LOCAL_AI_BODY_ENABLED === "true" &&
          Boolean(modelPaths.bodyModel && modelPaths.bodyManifest),
        manifestPath:
          modelPaths.bodyManifest || "/local-ai-models/body-disabled.json",
        modelPath:
          modelPaths.bodyModel || "/local-ai-models/body-disabled.onnx",
        providerScriptPath:
          environment.CIMMICH_LOCAL_AI_BODY_PROVIDER_SCRIPT ||
          "/app/providers/ultralytics-yolo-body/provider.py",
        pythonPath:
          environment.CIMMICH_LOCAL_AI_BODY_PYTHON_PATH || "/usr/bin/python3",
      },
      poses: {
        enabled:
          enabled &&
          environment.CIMMICH_LOCAL_AI_POSE_ENABLED === "true" &&
          Boolean(modelPaths.poseModel && modelPaths.poseManifest),
        manifestPath:
          modelPaths.poseManifest || "/local-ai-models/pose-disabled.json",
        modelPath:
          modelPaths.poseModel || "/local-ai-models/pose-disabled.onnx",
        providerScriptPath:
          environment.CIMMICH_LOCAL_AI_POSE_PROVIDER_SCRIPT ||
          "/app/providers/ultralytics-yolo-pose/provider.py",
        pythonPath:
          environment.CIMMICH_LOCAL_AI_POSE_PYTHON_PATH || "/usr/bin/python3",
      },
      enhance: {
        device: enhanceDevice,
        enabled:
          enabled &&
          Boolean(modelPaths.enhance) &&
          (enhanceDevice !== "vulkan" ||
            Boolean(modelPaths.enhanceParameter && modelPaths.enhanceRuntime)),
        modelPath:
          modelPaths.enhance || "/local-ai-models/enhance-disabled.onnx",
        pythonPath: "/usr/bin/python3",
        runtimePath:
          modelPaths.enhanceRuntime ||
          environment.CIMMICH_LOCAL_AI_ENHANCE_VULKAN_RUNTIME_PATH ||
          "/usr/local/bin/realesrgan-ncnn-vulkan",
      },
      faces: {
        detectorModelPath:
          modelPaths.face || "/local-ai-models/face-disabled.onnx",
        device: "cpu",
        enabled: enabled && Boolean(modelPaths.face),
        pythonPath: "/usr/bin/python3",
        scoreThreshold: 0.5,
      },
      sceneText: {
        enabled:
          enabled && environment.CIMMICH_LOCAL_AI_SCENE_TEXT_ENABLED === "true",
        endpoint:
          environment.CIMMICH_LOCAL_AI_SCENE_TEXT_ENDPOINT ||
          "http://127.0.0.1:11434",
        model: environment.CIMMICH_LOCAL_AI_SCENE_TEXT_MODEL || "disabled",
      },
    },
    schemaVersion: "cimmich.local-ai-photo-lab-config.v1",
  };
};

const existingFile = async (value) => {
  const path = String(value || "").trim();
  if (!path || !isAbsolute(path)) return "";
  const info = await stat(path).catch(() => null);
  return info?.isFile() ? resolve(path) : "";
};

const existingExecutable = async (value) => {
  const path = String(value || "").trim();
  if (!path || !isAbsolute(path)) return "";
  const info = await stat(path).catch(() => null);
  return info?.isFile() && (info.mode & 0o111) !== 0 ? resolve(path) : "";
};

const publicCapabilities = (config, enabled, environment) => {
  const faces = enabled && config.providers.faces.enabled;
  const enhance = enabled && config.providers.enhance.enabled;
  const bodies = enabled && config.providers.bodies.enabled;
  const poses = enabled && bodies && config.providers.poses.enabled;
  const sceneText = enabled && config.providers.sceneText.enabled;
  return {
    best: enhance,
    bodies,
    context: bodies && environment.CIMMICH_LOCAL_AI_CONTEXT_ENABLED === "true",
    faces,
    poses,
    quick: enabled,
    sceneText,
  };
};

const publicJob = (job) => ({
  artifactTokens: job.artifactTokens || [],
  completedAt: job.completedAt || null,
  createdAt: job.createdAt,
  error: job.error || null,
  jobId: job.jobId,
  operation: job.operation,
  progress: job.progress,
  result: job.result || null,
  schemaVersion,
  sourceAssetIds: job.sourceAssetIds,
  state: job.state,
});

const parseModelProgress = (line) => {
  if (!line.startsWith(progressPrefix)) return null;
  try {
    const value = JSON.parse(line.slice(progressPrefix.length));
    const completedUnits = Number(value.completedUnits);
    const totalUnits = Number(value.totalUnits);
    const completedTiles =
      value.completedTiles == null ? null : Number(value.completedTiles);
    const totalTiles =
      value.totalTiles == null ? null : Number(value.totalTiles);
    if (
      value.schemaVersion !== "cimmich.local-ai-progress.v1" ||
      !["quick", "best"].includes(value.operation) ||
      !progressStages.has(value.stage) ||
      !Number.isSafeInteger(completedUnits) ||
      !Number.isSafeInteger(totalUnits) ||
      completedUnits < 0 ||
      totalUnits < 1 ||
      completedUnits > totalUnits ||
      totalUnits > 1_000_000 ||
      (completedTiles == null) !== (totalTiles == null) ||
      (completedTiles != null &&
        (!Number.isSafeInteger(completedTiles) || completedTiles < 0)) ||
      (totalTiles != null &&
        (!Number.isSafeInteger(totalTiles) ||
          totalTiles < 1 ||
          completedTiles > totalTiles))
    ) {
      return null;
    }
    return {
      completedUnits,
      ...(completedTiles == null ? {} : { completedTiles }),
      operation: value.operation,
      stage: value.stage,
      ...(totalTiles == null ? {} : { totalTiles }),
      totalUnits,
    };
  } catch {
    return null;
  }
};

const collectProcess = (
  child,
  maximumBytes = 2 * 1024 * 1024,
  onProgress = () => undefined,
) =>
  new Promise((resolvePromise, reject) => {
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let progressBuffer = "";
    let settled = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        child.kill("SIGTERM");
        if (!settled) {
          settled = true;
          reject(
            typedError(
              "Local AI process output exceeded its limit",
              500,
              "LOCAL_AI_OUTPUT_OVERSIZED",
            ),
          );
        }
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", (chunk) => {
      collect(stderr)(chunk);
      progressBuffer += chunk.toString("utf8");
      const lines = progressBuffer.split("\n");
      progressBuffer = lines.pop() || "";
      for (const line of lines) {
        const progress = parseModelProgress(line);
        if (progress) onProgress(progress);
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      const finalProgress = parseModelProgress(progressBuffer);
      if (finalProgress) onProgress(finalProgress);
      resolvePromise({
        code,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });

const artifactEntries = (result) => {
  const entries = [];
  for (const asset of result.assets || []) {
    for (const [name, artifact] of [
      ["overlay", asset.artifacts?.overlay],
      ["quick", asset.operations?.enhancePreview?.artifact],
      ["best", asset.operations?.enhance?.artifact],
    ]) {
      if (
        artifact?.path &&
        /^[0-9a-f]{64}$/.test(String(artifact.digest || ""))
      ) {
        entries.push({
          digest: artifact.digest,
          relativePath: artifact.path,
          sourceAssetId: asset.assetId,
          sourceContentDigest: asset.sourceContentDigest,
          token: `${asset.assetId}:${name}`,
        });
      }
    }
  }
  return entries;
};

const directorySize = async (path) => {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) bytes += await directorySize(child);
    else if (entry.isFile()) bytes += (await stat(child)).size;
  }
  return bytes;
};

const pruneDerivedRuns = async (outputRoot) => {
  const setsRoot = join(outputRoot, "sets");
  const setEntries = await readdir(setsRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const runs = [];
  for (const setEntry of setEntries) {
    if (!setEntry.isDirectory()) continue;
    const runsRoot = join(setsRoot, setEntry.name, "runs");
    const runEntries = await readdir(runsRoot, { withFileTypes: true }).catch(
      () => [],
    );
    for (const runEntry of runEntries) {
      if (!runEntry.isDirectory() || !/^\d{4}$/.test(runEntry.name)) continue;
      const path = join(runsRoot, runEntry.name);
      const info = await stat(path);
      runs.push({
        bytes: await directorySize(path),
        modifiedMs: info.mtimeMs,
        path,
      });
    }
  }
  runs.sort((left, right) => right.modifiedMs - left.modifiedMs);
  let retainedBytes = 0;
  for (const [index, run] of runs.entries()) {
    retainedBytes += run.bytes;
    if (index >= maxRetainedRuns || retainedBytes > maxStoreBytes) {
      await rm(run.path, { force: true, recursive: true });
    }
  }
};

export const createLocalAiService = async ({
  environment = process.env,
  immichCompanion,
  repository,
  spawnImpl = spawn,
} = {}) => {
  const enabled = environment.CIMMICH_LOCAL_AI_ENABLED === "true";
  const root = resolve(environment.CIMMICH_LOCAL_AI_ROOT || "/local-ai");
  const cliPath = resolve(
    environment.CIMMICH_LOCAL_AI_CLI_PATH ||
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs",
      ),
  );
  const enhanceDevice = environment.CIMMICH_LOCAL_AI_ENHANCE_DEVICE || "cpu";
  const requestedVulkanModelPath =
    environment.CIMMICH_LOCAL_AI_ENHANCE_VULKAN_MODEL_PATH ||
    "/local-ai-models/realesrgan-ncnn-vulkan/realesrgan-x4plus.bin";
  const requestedVulkanRuntimePath =
    environment.CIMMICH_LOCAL_AI_ENHANCE_VULKAN_RUNTIME_PATH ||
    "/usr/local/bin/realesrgan-ncnn-vulkan";
  const modelPaths = {
    bodyManifest: await existingFile(
      environment.CIMMICH_LOCAL_AI_BODY_MANIFEST_PATH,
    ),
    bodyModel: await existingFile(environment.CIMMICH_LOCAL_AI_BODY_MODEL_PATH),
    poseManifest: await existingFile(
      environment.CIMMICH_LOCAL_AI_POSE_MANIFEST_PATH,
    ),
    poseModel: await existingFile(environment.CIMMICH_LOCAL_AI_POSE_MODEL_PATH),
    enhance: await existingFile(
      enhanceDevice === "vulkan"
        ? requestedVulkanModelPath
        : environment.CIMMICH_LOCAL_AI_ENHANCE_MODEL_PATH,
    ),
    enhanceParameter:
      enhanceDevice === "vulkan" && requestedVulkanModelPath.endsWith(".bin")
        ? await existingFile(`${requestedVulkanModelPath.slice(0, -4)}.param`)
        : "",
    enhanceRuntime:
      enhanceDevice === "vulkan"
        ? await existingExecutable(requestedVulkanRuntimePath)
        : "",
    face: await existingFile(environment.CIMMICH_LOCAL_AI_FACE_MODEL_PATH),
  };
  const config = providerConfig({ enabled, environment, modelPaths });
  const capabilities = publicCapabilities(config, enabled, environment);
  const jobs = new Map();
  let activeJob = null;
  const queue = [];
  if (enabled) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await rm(join(root, "work"), { force: true, recursive: true });
    await pruneDerivedRuns(join(root, "outputs"));
  }

  const status = () => ({
    capabilities,
    enabled,
    limits: {
      maxAssets: config.limits.maxAssets,
      maxConcurrentJobs: 1,
      maxQueuedJobs,
      maxRetainedRuns,
      maxStoreBytes,
    },
    originals: "read-only",
    reviewRequired: true,
    schemaVersion,
    state:
      enabled && Object.values(capabilities).some(Boolean)
        ? "ready"
        : enabled
          ? "unavailable"
          : "disabled",
  });

  const runNext = async () => {
    if (activeJob || queue.length === 0) return;
    const job = queue.shift();
    if (!job || job.state === "cancelled") return void runNext();
    activeJob = job;
    job.state = "running";
    job.progress = {
      completedAssets: 0,
      phase: "reading-originals",
      totalAssets: job.sourceAssetIds.length,
    };
    const workDir = join(root, "work", job.jobId);
    try {
      await mkdir(workDir, { recursive: true, mode: 0o700 });
      const assets = [];
      for (const [index, sourceAssetId] of job.sourceAssetIds.entries()) {
        const media = await immichCompanion.readAssetImage({
          assetId: sourceAssetId,
        });
        const extension =
          media.mimeType === "image/png"
            ? ".png"
            : media.mimeType === "image/webp"
              ? ".webp"
              : ".jpg";
        const inputPath = join(
          workDir,
          `${String(index + 1).padStart(2, "0")}-${sourceAssetId}${extension}`,
        );
        await writeFile(inputPath, media.bytes, { mode: 0o600 });
        const evidence = await repository.assetEvidence({ sourceAssetId });
        assets.push({
          acceptedSubjects: [
            ...new Set(
              evidence.faces.map((face) => face.display_name).filter(Boolean),
            ),
          ],
          assetId: sourceAssetId,
          baselineObservations: {
            bodies: evidence.bodies.map((body) => ({
              box: {
                h: body.box_h,
                w: body.box_w,
                x: body.box_x,
                y: body.box_y,
              },
              observationId: body.body_id,
            })),
            faces: evidence.faces.map((face) => ({
              box: {
                h: face.box_h,
                w: face.box_w,
                x: face.box_x,
                y: face.box_y,
              },
              observationId: face.face_id,
              ...(face.display_name ? { subject: face.display_name } : {}),
            })),
          },
          captureTime: evidence.capture_time,
          path: inputPath,
          presentationRotationQuarterTurns: Number(
            evidence.rotation_quarter_turns || 0,
          ),
        });
        job.progress = {
          completedAssets: index + 1,
          phase: "reading-originals",
          totalAssets: job.sourceAssetIds.length,
        };
      }
      const configPath = join(workDir, "config.json");
      const setPath = join(workDir, "set.json");
      await writeFile(configPath, `${JSON.stringify(config)}\n`, {
        mode: 0o600,
      });
      await writeFile(
        setPath,
        `${JSON.stringify({ assets, contextKind: assets.length > 1 ? "sequence" : "none", schemaVersion: "cimmich.local-ai-photo-set.v1", setId: `cimmich-${job.jobId}` })}\n`,
        { mode: 0o600 },
      );
      job.progress = {
        completedAssets: 0,
        phase: "running-model",
        totalAssets: job.sourceAssetIds.length,
      };
      const outputRoot = join(root, "outputs");
      await mkdir(outputRoot, { recursive: true, mode: 0o700 });
      const child = spawnImpl(
        process.execPath,
        [
          cliPath,
          "run",
          "--config",
          configPath,
          "--set",
          setPath,
          "--output",
          outputRoot,
          "--operations",
          operationMap.get(job.operation),
        ],
        {
          env: {
            LANG: process.env.LANG || "C.UTF-8",
            PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
            PYTHONNOUSERSITE: "1",
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      job.child = child;
      job.timer = setTimeout(() => child.kill("SIGTERM"), maximumRunMs);
      job.timer.unref();
      const processResult = await collectProcess(child, undefined, (model) => {
        if (job.state !== "running") return;
        if (
          ["quick", "best"].includes(job.operation) &&
          model.operation !== job.operation
        )
          return;
        job.progress = { ...job.progress, model };
      });
      clearTimeout(job.timer);
      job.timer = null;
      job.child = null;
      if (job.state === "cancelled") return;
      if (processResult.code !== 0) {
        throw typedError(
          "The local model run failed",
          500,
          "LOCAL_AI_RUN_FAILED",
        );
      }
      let receipt;
      try {
        receipt = JSON.parse(processResult.stdout);
      } catch {
        throw typedError(
          "The local model returned an invalid receipt",
          500,
          "LOCAL_AI_RECEIPT_INVALID",
        );
      }
      if (!receipt.resultPath || !isContained(outputRoot, receipt.resultPath)) {
        throw typedError(
          "The local model result path is invalid",
          500,
          "LOCAL_AI_RECEIPT_INVALID",
        );
      }
      const result = JSON.parse(await readFile(receipt.resultPath, "utf8"));
      const artifacts = artifactEntries(result);
      job.artifacts = new Map(
        artifacts.map((entry) => [
          entry.token,
          {
            ...entry,
            path: resolve(dirname(receipt.resultPath), entry.relativePath),
          },
        ]),
      );
      if (
        [...job.artifacts.values()].some(
          (entry) => !isContained(dirname(receipt.resultPath), entry.path),
        )
      ) {
        throw typedError(
          "The local model artifact path is invalid",
          500,
          "LOCAL_AI_RECEIPT_INVALID",
        );
      }
      job.artifactTokens = [...job.artifacts.keys()];
      job.result = result;
      job.runDir = dirname(receipt.resultPath);
      job.state = result.state === "partial" ? "partial" : "completed";
      job.progress = {
        completedAssets: job.sourceAssetIds.length,
        phase: "complete",
        totalAssets: job.sourceAssetIds.length,
      };
      job.completedAt = new Date().toISOString();
      await pruneDerivedRuns(outputRoot);
    } catch (error) {
      if (job.state !== "cancelled") {
        job.state = "failed";
        job.error = {
          code: error?.code || "LOCAL_AI_RUN_FAILED",
          message: "Local AI could not finish this review run.",
        };
        job.completedAt = new Date().toISOString();
      }
    } finally {
      clearTimeout(job.timer);
      job.timer = null;
      job.child = null;
      await rm(workDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      const completedJobs = [...jobs.values()]
        .filter((candidate) => finalStates.has(candidate.state))
        .sort((left, right) =>
          String(right.completedAt).localeCompare(String(left.completedAt)),
        );
      for (const stale of completedJobs.slice(maxRetainedRuns)) {
        jobs.delete(stale.jobId);
      }
      activeJob = null;
      void runNext();
    }
  };

  return {
    async artifact({ jobId, token }) {
      const job = jobs.get(jobId);
      const artifact = job?.artifacts?.get(token);
      if (!job || !finalStates.has(job.state) || !artifact) {
        throw typedError(
          "Local AI artifact was not found",
          404,
          "LOCAL_AI_ARTIFACT_NOT_FOUND",
        );
      }
      const fingerprint = await immichCompanion.readAssetFingerprint({
        assetId: artifact.sourceAssetId,
      });
      if (fingerprint.contentDigest !== artifact.sourceContentDigest) {
        throw typedError(
          "The source photo changed after this Local AI run",
          409,
          "LOCAL_AI_SOURCE_CHANGED",
        );
      }
      const handle = await open(artifact.path, "r").catch(() => null);
      if (!handle) {
        throw typedError(
          "Local AI artifact is unavailable",
          404,
          "LOCAL_AI_ARTIFACT_NOT_FOUND",
        );
      }
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size < 1 || info.size > 256 * 1024 * 1024) {
          throw typedError(
            "Local AI artifact is unavailable",
            404,
            "LOCAL_AI_ARTIFACT_NOT_FOUND",
          );
        }
        const bytes = Buffer.alloc(info.size);
        const { bytesRead } = await handle.read(bytes, 0, info.size, 0);
        const finalInfo = await handle.stat();
        if (
          bytesRead !== info.size ||
          finalInfo.size !== info.size ||
          finalInfo.mtimeMs !== info.mtimeMs
        ) {
          throw typedError(
            "Local AI artifact changed while it was being verified",
            409,
            "LOCAL_AI_ARTIFACT_INVALID",
          );
        }
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== artifact.digest) {
          throw typedError(
            "Local AI artifact verification failed",
            409,
            "LOCAL_AI_ARTIFACT_INVALID",
          );
        }
        return {
          bytes,
          disposition: "inline",
          filename: `${token.split(":").at(-1)}.png`,
          mimeType: "image/png",
        };
      } finally {
        await handle.close();
      }
    },
    cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job)
        throw typedError(
          "Local AI job was not found",
          404,
          "LOCAL_AI_JOB_NOT_FOUND",
        );
      if (finalStates.has(job.state)) return publicJob(job);
      job.state = "cancelled";
      job.completedAt = new Date().toISOString();
      job.progress = { ...job.progress, phase: "cancelled" };
      if (job.child) {
        job.child.kill("SIGTERM");
        const child = job.child;
        const escalation = setTimeout(() => child.kill("SIGKILL"), 2_000);
        escalation.unref();
      }
      return publicJob(job);
    },
    async close() {
      for (const job of jobs.values()) {
        if (finalStates.has(job.state)) continue;
        job.state = "cancelled";
        job.completedAt = new Date().toISOString();
        job.progress = { ...job.progress, phase: "cancelled" };
        job.child?.kill("SIGTERM");
      }
    },
    get(jobId) {
      const job = jobs.get(jobId);
      if (!job)
        throw typedError(
          "Local AI job was not found",
          404,
          "LOCAL_AI_JOB_NOT_FOUND",
        );
      return publicJob(job);
    },
    async start(input) {
      if (!enabled)
        throw typedError("Local AI is disabled", 503, "LOCAL_AI_DISABLED");
      const normalized = exactJobInput(input, config.limits.maxAssets);
      if (
        normalized.operation === "poses" &&
        normalized.sourceAssetIds.length !== 1
      ) {
        throw typedError(
          "Pose review accepts exactly one selected photo",
          400,
          "LOCAL_AI_POSE_ASSETS_INVALID",
        );
      }
      if (
        !capabilities[
          normalized.operation === "scene-text"
            ? "sceneText"
            : normalized.operation
        ]
      ) {
        throw typedError(
          "That Local AI capability is not configured",
          503,
          "LOCAL_AI_CAPABILITY_UNAVAILABLE",
        );
      }
      if (queue.length + (activeJob ? 1 : 0) >= maxQueuedJobs) {
        throw typedError(
          "Local AI already has the maximum number of queued runs",
          429,
          "LOCAL_AI_QUEUE_FULL",
        );
      }
      const visible = await repository.filterPresentableAssetSourceIds({
        sourceAssetIds: normalized.sourceAssetIds,
      });
      if (visible.sourceAssetIds.length !== normalized.sourceAssetIds.length) {
        throw typedError(
          "One or more photos are not visible in the current viewing mode",
          404,
          "LOCAL_AI_ASSET_NOT_VISIBLE",
        );
      }
      const job = {
        artifactTokens: [],
        createdAt: new Date().toISOString(),
        jobId: randomUUID(),
        operation: normalized.operation,
        progress: {
          completedAssets: 0,
          phase: "queued",
          totalAssets: normalized.sourceAssetIds.length,
        },
        sourceAssetIds: normalized.sourceAssetIds,
        state: "queued",
      };
      jobs.set(job.jobId, job);
      queue.push(job);
      void runNext();
      return publicJob(job);
    },
    status,
  };
};
