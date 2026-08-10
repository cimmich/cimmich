import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import {
  configSchema,
  digest,
  fileDigest,
  normalizeOperations,
  publicAsset,
  runSchema,
  setSchema,
  validateConfig,
  validatePhotoSet,
} from "./contract.mjs";
import { inferContext } from "./context.mjs";
import { diffObservations, diffRunResults } from "./diff.mjs";
import * as defaultProviders from "./providers.mjs";
import { renderReport } from "./report.mjs";
import { buildSetSummary } from "./summary.mjs";

const readJson = async (path, label) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(`${label} is not valid readable JSON`), {
      cause: error,
      code: "LOCAL_AI_INPUT_INVALID",
    });
  }
};

const atomicJson = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
};

const atomicText = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
};

const safeName = (value) => {
  const normalized = String(value)
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .slice(0, 80);
  return normalized || "asset";
};

const artifact = async (path, runDir) => ({
  digest: await fileDigest(path),
  path: relative(runDir, path),
});

const sanitizeBodies = (operation) => {
  if (!operation?.bodies) return operation;
  return {
    ...operation,
    bodies: operation.bodies.map(
      ({ appearanceFeature: _discarded, ...body }) => body,
    ),
  };
};

const sanitizeFailure = (operation) => {
  if (operation?.state !== "failed") return operation;
  return {
    errorCode: operation.errorCode,
    message:
      "The local provider failed. The typed code is retained without provider paths.",
    operation: operation.operation,
    state: "failed",
  };
};

const timed = async (callback) => {
  const started = performance.now();
  const result = await callback();
  return { ...result, durationMs: Math.round(performance.now() - started) };
};

const crossModelChecks = (operations) => {
  const faces = operations.faces?.faces ?? [];
  const bodies = operations.bodies?.bodies ?? [];
  const people = operations.sceneText?.proposal?.peopleCountEstimate;
  const reasonCodes = [];
  if (
    faces.length > 0 &&
    faces.every((face) => face.quality?.reviewReasons?.length)
  ) {
    reasonCodes.push("ALL_FACE_CANDIDATES_REQUIRE_REVIEW");
  }
  if (
    faces.length > 0 &&
    operations.bodies &&
    bodies.length === 0 &&
    people === 0
  ) {
    reasonCodes.push("FACE_ONLY_WITH_NO_PERSON_SUPPORT");
  }
  if (Number.isInteger(people) && Math.abs(bodies.length - people) >= 2) {
    reasonCodes.push("BODY_COUNT_DISAGREES_WITH_SCENE");
  }
  if (
    people > 0 &&
    operations.faces &&
    operations.bodies &&
    !faces.length &&
    !bodies.length
  ) {
    reasonCodes.push("SCENE_PERSON_WITHOUT_FACE_OR_BODY");
  }
  return {
    reasonCodes,
    state: reasonCodes.length ? "review" : "clear",
  };
};

const acquireRunDirectory = async (setRoot, startingRevision) => {
  await mkdir(join(setRoot, "runs"), { recursive: true });
  let revision = startingRevision;
  while (revision < startingRevision + 1000) {
    const runName = String(revision).padStart(4, "0");
    const runDir = join(setRoot, "runs", runName);
    try {
      await mkdir(runDir);
      return { revision, runDir, runName };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      revision += 1;
    }
  }
  throw Object.assign(new Error("unable to reserve a run revision"), {
    code: "LOCAL_AI_OUTPUT_BUSY",
  });
};

const previousRun = async (setRoot) => {
  try {
    const index = JSON.parse(
      await readFile(join(setRoot, "index.json"), "utf8"),
    );
    if (
      !Number.isSafeInteger(index.latestRevision) ||
      !/^runs\/\d{4}\/result\.json$/.test(String(index.latestResult ?? ""))
    )
      return null;
    const result = JSON.parse(
      await readFile(join(setRoot, index.latestResult), "utf8"),
    );
    return { index, result };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
};

const makeSinglePhotoSet = (photoPath) => ({
  assets: [
    {
      acceptedSubjects: [],
      assetId: safeName(basename(photoPath)),
      path: photoPath,
    },
  ],
  contextKind: "none",
  schemaVersion: setSchema,
  setId: `single-${safeName(basename(photoPath))}`,
});

export const runPhotoLab = async ({
  configInput,
  operationsInput,
  outputRoot,
  photoPath,
  providerImplementations = defaultProviders,
  setInput,
}) => {
  if (Boolean(photoPath) === Boolean(setInput)) {
    throw Object.assign(new Error("provide exactly one photo or photo set"), {
      code: "LOCAL_AI_INPUT_INVALID",
    });
  }
  const config = validateConfig(configInput);
  const photoSet = await validatePhotoSet(
    setInput ?? makeSinglePhotoSet(photoPath),
    config.limits,
  );
  const requestedOperations = normalizeOperations(operationsInput);
  const executedOperations =
    requestedOperations.includes("context") &&
    !requestedOperations.includes("bodies")
      ? [...requestedOperations, "bodies"].sort(
          (left, right) =>
            ["faces", "bodies", "context", "scene-text", "enhance"].indexOf(
              left,
            ) -
            ["faces", "bodies", "context", "scene-text", "enhance"].indexOf(
              right,
            ),
        )
      : requestedOperations;
  const setKey = digest({
    assetIds: photoSet.assets.map(({ assetId }) => assetId),
    setId: photoSet.setId,
  }).slice(0, 24);
  const setRoot = join(outputRoot, "sets", setKey);
  await mkdir(setRoot, { recursive: true });
  const previous = await previousRun(setRoot);
  const reserved = await acquireRunDirectory(
    setRoot,
    (previous?.index.latestRevision ?? 0) + 1,
  );
  const runId = `local_ai_${setKey}_${reserved.runName}`;
  const artifactRoot = join(reserved.runDir, "artifacts");
  await mkdir(artifactRoot);
  const runtimeAssets = [];
  const facesConfig = {
    ...config.providers.faces,
    maxInputPixels: config.limits.maxInputPixels,
    timeoutMs: config.limits.providerTimeoutMs,
  };
  const bodiesConfig = {
    ...config.providers.bodies,
    appearancePythonPath: config.providers.bodies.pythonPath,
    maxInputPixels: config.limits.maxInputPixels,
    timeoutMs: config.limits.providerTimeoutMs,
  };
  const sceneTextConfig = {
    ...config.providers.sceneText,
    timeoutMs: config.limits.providerTimeoutMs,
  };
  const enhanceConfig = {
    ...config.providers.enhance,
    maxInputPixels: config.limits.maxEnhanceInputPixels,
    timeoutMs: config.limits.providerTimeoutMs,
  };
  const bodyBatchResults =
    executedOperations.includes("bodies") &&
    photoSet.assets.length > 1 &&
    providerImplementations.runBodiesBatch
      ? await providerImplementations.runBodiesBatch({
          assets: photoSet.assets,
          config: bodiesConfig,
        })
      : null;

  for (const [assetIndex, assetInput] of photoSet.assets.entries()) {
    const operations = {};
    const name = safeName(assetInput.assetId);
    const image = await providerImplementations.probeImage({
      asset: assetInput,
      config: {
        maxInputPixels: config.limits.maxInputPixels,
        pythonPath: config.providers.faces.pythonPath,
        timeoutMs: config.limits.providerTimeoutMs,
      },
    });
    if (executedOperations.includes("faces")) {
      operations.faces = await timed(() =>
        providerImplementations.runFaces({
          asset: assetInput,
          config: facesConfig,
        }),
      );
    }
    if (executedOperations.includes("bodies")) {
      operations.bodies = bodyBatchResults
        ? bodyBatchResults[assetIndex]
        : await timed(() =>
            providerImplementations.runBodies({
              asset: assetInput,
              config: bodiesConfig,
            }),
          );
    }
    if (executedOperations.includes("scene-text")) {
      operations.sceneText = await timed(() =>
        providerImplementations.runSceneText({
          asset: assetInput,
          config: sceneTextConfig,
        }),
      );
    }
    if (executedOperations.includes("enhance")) {
      const outputPath = join(
        artifactRoot,
        `${name}-enhanced-x${config.providers.enhance.scale}.png`,
      );
      const enhanced = await timed(() =>
        providerImplementations.runEnhance({
          asset: assetInput,
          config: enhanceConfig,
          outputPath,
        }),
      );
      operations.enhance =
        enhanced.state === "derived"
          ? {
              ...enhanced,
              artifact: await artifact(outputPath, reserved.runDir),
            }
          : enhanced;
    }
    const artifacts = {};
    const faces = operations.faces?.faces ?? [];
    const bodies = operations.bodies?.bodies ?? [];
    if (faces.length || bodies.length) {
      const dataPath = join(reserved.runDir, `.${name}-overlay-input.json`);
      const outputPath = join(artifactRoot, `${name}-review-overlay.png`);
      await atomicJson(dataPath, { bodies, faces });
      const overlay = await providerImplementations.renderOverlay({
        asset: assetInput,
        bodies,
        config: {
          pythonPath: config.providers.enhance.pythonPath,
          timeoutMs: config.limits.providerTimeoutMs,
        },
        dataPath,
        faces,
        outputPath,
      });
      await unlink(dataPath).catch(() => undefined);
      if (!overlay?.state || overlay.state !== "failed")
        artifacts.overlay = await artifact(outputPath, reserved.runDir);
      else artifacts.overlayFailure = sanitizeFailure(overlay);
    }
    runtimeAssets.push({
      ...publicAsset(assetInput),
      artifacts,
      crossModelChecks: crossModelChecks(operations),
      image,
      operations,
    });
  }

  const context = requestedOperations.includes("context")
    ? inferContext({
        assets: runtimeAssets,
        contextKind: photoSet.contextKind,
        policy: config.contextPolicy,
      })
    : null;
  const originalsUnchanged = (
    await Promise.all(
      photoSet.assets.map(
        async (asset) =>
          (await fileDigest(asset.path)) === asset.sourceContentDigest,
      ),
    )
  ).every(Boolean);
  const assets = runtimeAssets.map((asset) => {
    const operations = Object.fromEntries(
      Object.entries(asset.operations).map(([key, operation]) => [
        key,
        sanitizeFailure(sanitizeBodies(operation)),
      ]),
    );
    const baselineComparison = asset.baselineObservations
      ? {
          bodies: operations.bodies
            ? diffObservations(
                asset.baselineObservations.bodies,
                operations.bodies.bodies,
              )
            : null,
          faces: operations.faces
            ? diffObservations(
                asset.baselineObservations.faces,
                operations.faces.faces,
              )
            : null,
        }
      : null;
    return { ...asset, baselineComparison, operations };
  });
  const summary = buildSetSummary({
    assets,
    context,
    contextKind: photoSet.contextKind,
  });
  const providerStates = assets.flatMap((asset) =>
    Object.values(asset.operations).map((operation) => operation.state),
  );
  const state = !originalsUnchanged
    ? "failed"
    : providerStates.some(
          (value) => value === "failed" || value === "unavailable",
        )
      ? "partial"
      : "completed";
  const createdAt = new Date().toISOString();
  let result = {
    assets,
    context,
    createdAt,
    executedOperations,
    originalsUnchanged,
    providerBoundary: {
      activationAuthority: "none",
      network: "local-only",
      sourceMedia: "read-only",
    },
    requestedOperations,
    revision: reserved.revision,
    runId,
    schemaVersion: runSchema,
    set: {
      contextKind: photoSet.contextKind,
      schemaVersion: setSchema,
      setId: photoSet.setId,
      setKey,
    },
    state,
    summary,
  };
  result = { ...result, receiptDigest: digest(result) };
  const diff = diffRunResults(previous?.result ?? null, result);
  await atomicJson(join(reserved.runDir, "result.json"), result);
  await atomicJson(join(reserved.runDir, "diff.json"), diff);
  await atomicText(
    join(reserved.runDir, "report.md"),
    renderReport({ diff, result }),
  );
  const relativeResult = join("runs", reserved.runName, "result.json");
  await atomicJson(join(setRoot, "index.json"), {
    latestResult: relativeResult,
    latestRevision: reserved.revision,
    latestRunId: runId,
    schemaVersion: "cimmich.local-ai-photo-lab-index.v1",
    setKey,
  });
  return {
    diffPath: join(reserved.runDir, "diff.json"),
    reportPath: join(reserved.runDir, "report.md"),
    result,
    resultPath: join(reserved.runDir, "result.json"),
    runDir: reserved.runDir,
  };
};

export const runPhotoLabFromFiles = async ({
  configPath,
  operations,
  outputRoot,
  photoPath,
  setPath,
}) =>
  runPhotoLab({
    configInput: await readJson(configPath, "config"),
    operationsInput: operations,
    outputRoot,
    photoPath,
    setInput: setPath ? await readJson(setPath, "photo set") : undefined,
  });

export { configSchema };
