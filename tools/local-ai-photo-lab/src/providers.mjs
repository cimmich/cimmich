import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUltralyticsYoloPoseDetector } from "../../../service/src/ultralytics-yolo-pose-detector.mjs";
import { digest, fileDigest } from "./contract.mjs";
import { trackedSpawn } from "./processes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pythonRoot = join(here, "..", "python");

const providerFailure = (operation, error) => ({
  errorCode:
    error?.code ||
    `LOCAL_AI_${operation.toUpperCase().replaceAll("-", "_")}_FAILED`,
  message: error instanceof Error ? error.message : String(error),
  operation,
  state: "failed",
});

const processOutputLimit = 16 * 1024 * 1024;
export const progressPrefix = "CIMMICH_LOCAL_AI_PROGRESS ";

const terminateProcess = (child) => {
  child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, 1000);
  escalation.unref();
};

export const runProcess = ({
  command,
  args = [],
  input,
  maxOutputBytes = processOutputLimit,
  timeoutMs,
}) =>
  new Promise((resolve, reject) => {
    const child = trackedSpawn(command, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let progressBuffer = "";
    let outputBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      terminateProcess(child);
      fail(
        Object.assign(new Error("provider timed out"), {
          code: "LOCAL_AI_PROVIDER_TIMEOUT",
        }),
      );
    }, timeoutMs);
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        terminateProcess(child);
        fail(
          Object.assign(new Error("provider output exceeded its limit"), {
            code: "LOCAL_AI_PROVIDER_OUTPUT_OVERSIZED",
          }),
        );
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
        if (line.startsWith(progressPrefix)) process.stderr.write(`${line}\n`);
      }
    });
    child.on("error", (error) => {
      fail(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (progressBuffer.startsWith(progressPrefix))
        process.stderr.write(`${progressBuffer}\n`);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0) {
        const details = Buffer.concat(stderr).toString("utf8").trim();
        let providerCode = "LOCAL_AI_PROVIDER_PROCESS_FAILED";
        try {
          const errorLine = details
            .split("\n")
            .findLast((line) => !line.startsWith(progressPrefix));
          providerCode =
            JSON.parse(errorLine || "{}").error?.code || providerCode;
        } catch {
          // The message remains local-only and is sanitized before persistence.
        }
        reject(
          Object.assign(new Error(details || `provider exited ${code}`), {
            code: providerCode,
          }),
        );
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(
          Object.assign(new Error("provider returned invalid JSON"), {
            code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
          }),
        );
      }
    });
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });

export const probeImage = async ({ asset, config }) =>
  runProcess({
    args: [join(pythonRoot, "image_tools.py"), "probe"],
    command: config.pythonPath,
    input: {
      imagePath: asset.path,
      maxInputPixels: config.maxInputPixels,
      sourceContentDigest: asset.sourceContentDigest,
    },
    timeoutMs: config.timeoutMs,
  });

const faceResultMatchesAsset = (result, asset) =>
  result?.schemaVersion === "cimmich.local-ai-face-scan.v1" &&
  result.assetToken === digest({ assetId: asset.assetId }) &&
  result.sourceContentDigest === asset.sourceContentDigest &&
  Array.isArray(result.faces) &&
  (result.state === "faces_detected" || result.state === "no_face");

export const runFaces = async ({ asset, config }) => {
  if (!config.enabled)
    return {
      operation: "faces",
      state: "unavailable",
      reason: "provider_disabled",
    };
  try {
    const result = await runProcess({
      args: [join(pythonRoot, "faces.py")],
      command: config.pythonPath,
      input: {
        assetToken: digest({ assetId: asset.assetId }),
        device: config.device,
        imagePath: asset.path,
        maxInputPixels: config.maxInputPixels,
        modelPath: config.detectorModelPath,
        scoreThreshold: config.scoreThreshold,
        sourceContentDigest: asset.sourceContentDigest,
      },
      timeoutMs: config.timeoutMs,
    });
    if (!faceResultMatchesAsset(result, asset)) {
      throw Object.assign(new Error("face result binding is invalid"), {
        code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
      });
    }
    return {
      ...result,
      provider: { ...result.provider, executionMode: "one-shot" },
    };
  } catch (error) {
    return providerFailure("faces", error);
  }
};

export const runFacesBatch = async ({ assets, config }) => {
  if (!config.enabled) {
    return assets.map(() => ({
      operation: "faces",
      reason: "provider_disabled",
      state: "unavailable",
    }));
  }
  try {
    const processStarted = Date.now();
    const response = await runProcess({
      args: [join(pythonRoot, "faces.py"), "--batch"],
      command: config.pythonPath,
      input: {
        assets: assets.map((asset) => ({
          assetToken: digest({ assetId: asset.assetId }),
          imagePath: asset.path,
          sourceContentDigest: asset.sourceContentDigest,
        })),
        device: config.device,
        maxInputPixels: config.maxInputPixels,
        modelPath: config.detectorModelPath,
        scoreThreshold: config.scoreThreshold,
      },
      timeoutMs: config.timeoutMs,
    });
    if (
      response.schemaVersion !== "cimmich.local-ai-face-scan-batch.v1" ||
      !Array.isArray(response.results) ||
      response.results.length !== assets.length ||
      !Number.isInteger(response.durationMs) ||
      response.durationMs < 0 ||
      !Number.isInteger(response.initializationMs) ||
      response.initializationMs < 0 ||
      response.results.some(
        (result, index) => !faceResultMatchesAsset(result, assets[index]),
      )
    ) {
      throw Object.assign(new Error("face batch result is invalid"), {
        code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
      });
    }
    const setProcessDurationMs = Date.now() - processStarted;
    return response.results.map((result) => ({
      ...result,
      provider: {
        ...result.provider,
        executionMode: "resident-set",
        setAssetCount: assets.length,
        setInitializationMs: response.initializationMs,
        setProcessDurationMs,
        setProviderDurationMs: response.durationMs,
      },
    }));
  } catch (error) {
    return assets.map(() => providerFailure("faces", error));
  }
};

const enrichBodies = async ({
  asset,
  config,
  executionMode,
  manifestDigest,
  modelDigest,
  result,
}) => {
  const assetToken = digest({ assetId: asset.assetId });
  const bodies = (result.bodies ?? []).map((body) => ({
    ...body,
    bodyId: `body_${digest({ assetToken, box: body.box, detectorConfigDigest: result.detectorConfigDigest }).slice(0, 40)}`,
  }));
  const appearance = await runProcess({
    args: [join(pythonRoot, "image_tools.py"), "appearance"],
    command: config.appearancePythonPath,
    input: {
      bodies,
      imagePath: asset.path,
      maxInputPixels: config.maxInputPixels,
      sourceContentDigest: asset.sourceContentDigest,
    },
    timeoutMs: config.timeoutMs,
  });
  return {
    ...result,
    appearanceConfigDigest: appearance.appearanceConfigDigest,
    bodies: bodies.map((body, index) => ({
      ...body,
      ...appearance.observations[index],
    })),
    image: appearance.image,
    provider: {
      activationAuthority: "none",
      detectorConfigDigest: result.detectorConfigDigest,
      executionMode,
      manifestDigest,
      modelDigest,
      network: "forbidden",
    },
  };
};

export const runBodies = async ({ asset, config }) => {
  if (!config.enabled)
    return {
      operation: "bodies",
      state: "unavailable",
      reason: "provider_disabled",
    };
  try {
    const assetToken = digest({ assetId: asset.assetId });
    const result = await runProcess({
      command: config.pythonPath,
      args: [config.providerScriptPath],
      input: {
        assetToken,
        imagePath: asset.path,
        inputRevision: digest({
          presentationRotationQuarterTurns:
            asset.presentationRotationQuarterTurns,
          sourceContentDigest: asset.sourceContentDigest,
        }),
        manifestPath: config.manifestPath,
        modelPath: config.modelPath,
        presentationRotationQuarterTurns:
          asset.presentationRotationQuarterTurns,
        schemaVersion: "cimmich.ultralytics-yolo-body-request.v1",
        sourceContentDigest: asset.sourceContentDigest,
      },
      timeoutMs: config.timeoutMs,
    });
    const [manifestDigest, modelDigest] = await Promise.all([
      fileDigest(config.manifestPath),
      fileDigest(config.modelPath),
    ]);
    return await enrichBodies({
      asset,
      config,
      executionMode: "one-shot",
      manifestDigest,
      modelDigest,
      result,
    });
  } catch (error) {
    return providerFailure("bodies", error);
  }
};

const withTimeout = (promise, timeoutMs, onTimeout) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(
        Object.assign(new Error("resident provider timed out"), {
          code: "LOCAL_AI_PROVIDER_TIMEOUT",
        }),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const runBodiesBatch = async ({ assets, config }) => {
  if (!config.enabled) {
    return assets.map(() => ({
      operation: "bodies",
      reason: "provider_disabled",
      state: "unavailable",
    }));
  }
  const child = trackedSpawn(
    config.pythonPath,
    [
      config.providerScriptPath,
      "--serve",
      "--manifest",
      config.manifestPath,
      "--model",
      config.modelPath,
    ],
    { shell: false, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.on("error", () => undefined);
  child.stderr.resume();
  const iterator = child.stdout[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  const readExactly = async (length) => {
    while (buffered.length < length) {
      const next = await iterator.next();
      if (next.done)
        throw Object.assign(new Error("resident provider closed early"), {
          code: "LOCAL_AI_PROVIDER_PROCESS_FAILED",
        });
      buffered = Buffer.concat([buffered, next.value]);
    }
    const value = buffered.subarray(0, length);
    buffered = buffered.subarray(length);
    return value;
  };
  const readResult = async () => {
    const header = await readExactly(8);
    const length = Number(header.readBigUInt64BE());
    if (
      !Number.isSafeInteger(length) ||
      length < 2 ||
      length > 16 * 1024 * 1024
    ) {
      throw Object.assign(new Error("resident provider result is oversized"), {
        code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
      });
    }
    return JSON.parse((await readExactly(length)).toString("utf8"));
  };
  const [manifestDigest, modelDigest] = await Promise.all([
    fileDigest(config.manifestPath),
    fileDigest(config.modelPath),
  ]);
  const results = [];
  for (const asset of assets) {
    const started = Date.now();
    try {
      const encoded = await readFile(asset.path);
      const metadata = Buffer.from(
        JSON.stringify({
          assetToken: digest({ assetId: asset.assetId }),
          inputRevision: digest({
            presentationRotationQuarterTurns:
              asset.presentationRotationQuarterTurns,
            sourceContentDigest: asset.sourceContentDigest,
          }),
          presentationRotationQuarterTurns:
            asset.presentationRotationQuarterTurns,
          schemaVersion: "cimmich.ultralytics-yolo-body-resident-request.v1",
          sourceContentDigest: asset.sourceContentDigest,
        }),
      );
      const header = Buffer.alloc(16);
      header.writeBigUInt64BE(BigInt(metadata.length), 0);
      header.writeBigUInt64BE(BigInt(encoded.length), 8);
      if (!child.stdin.write(Buffer.concat([header, metadata, encoded]))) {
        await once(child.stdin, "drain");
      }
      const raw = await withTimeout(readResult(), config.timeoutMs, () =>
        child.kill("SIGTERM"),
      );
      if (raw.error) {
        throw Object.assign(new Error("resident body provider failed"), {
          code: raw.error.code,
        });
      }
      const result = await enrichBodies({
        asset,
        config,
        executionMode: "resident-set",
        manifestDigest,
        modelDigest,
        result: raw,
      });
      results.push({ ...result, durationMs: Date.now() - started });
    } catch (error) {
      results.push({
        ...providerFailure("bodies", error),
        durationMs: Date.now() - started,
      });
    }
  }
  child.stdin.end();
  return results;
};

export const runPoses = async ({ asset, config }) => {
  if (!config.enabled)
    return {
      operation: "poses",
      state: "unavailable",
      reason: "provider_disabled",
    };
  let detector;
  try {
    const [manifest, bytes, manifestDigest, modelDigest] = await Promise.all([
      readFile(config.manifestPath, "utf8").then(JSON.parse),
      readFile(asset.path),
      fileDigest(config.manifestPath),
      fileDigest(config.modelPath),
    ]);
    detector = createUltralyticsYoloPoseDetector({
      manifest,
      manifestPath: config.manifestPath,
      maxInputBytes: config.maxInputBytes,
      modelPath: config.modelPath,
      pythonPath: config.pythonPath,
      scriptPath: config.providerScriptPath,
      timeoutMs: Math.min(config.timeoutMs, manifest.resources.maxRuntimeMs),
    });
    const request = {
      assetToken: digest({ assetId: asset.assetId }),
      bytes,
      inputRevision: digest({
        presentationRotationQuarterTurns:
          asset.presentationRotationQuarterTurns,
        sourceContentDigest: asset.sourceContentDigest,
      }),
      presentationRotationQuarterTurns: asset.presentationRotationQuarterTurns,
      sourceContentDigest: asset.sourceContentDigest,
    };
    const first = await detector.detect({ ...request, runId: "pose-review-a" });
    const second = await detector.detect({
      ...request,
      runId: "pose-review-b",
    });
    if (digest(first.result) !== digest(second.result)) {
      throw Object.assign(new Error("pose replay drifted"), {
        code: "LOCAL_AI_POSE_REPLAY_DRIFT",
      });
    }
    return {
      operation: "poses",
      poses: first.result.detections,
      poseConfigDigest: first.result.poseConfigDigest,
      provider: {
        activationAuthority: "none",
        executionMode: "resident-replay",
        manifestDigest,
        modelDigest,
        network: "forbidden",
        replayRuns: 2,
      },
      state: first.result.state,
    };
  } catch (error) {
    return providerFailure("poses", error);
  } finally {
    await detector?.close().catch(() => undefined);
  }
};

const sceneSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "activities",
    "objects",
    "peopleCountEstimate",
    "qualityFlags",
    "scene",
    "summary",
    "visibleText",
  ],
  properties: {
    activities: { type: "array", items: { type: "string" }, maxItems: 12 },
    objects: { type: "array", items: { type: "string" }, maxItems: 24 },
    peopleCountEstimate: { type: "integer", minimum: 0, maximum: 100 },
    qualityFlags: { type: "array", items: { type: "string" }, maxItems: 12 },
    scene: { type: "string" },
    summary: { type: "string" },
    visibleText: { type: "array", items: { type: "string" }, maxItems: 30 },
  },
};

const baseScenePrompt =
  "Inspect only visible evidence in this image. Do not guess identities, relationships, events, or locations. The summary must be one to three natural sentences, no more than 90 words, with the main action and the most useful visible detail first. The scene must be a short two-to-eight-word setting, not a description. Return visible activities, concrete objects, only complete meaningful legible text, a conservative people count, and visible image-quality issues. Exclude cropped or partial words, watermarks, logos, and incidental interface text. Quality flags describe only visible limitations such as blur, obstruction, or extreme crop; partial text is not a quality flag. Use empty arrays when evidence is absent.";

const roundedBox = (box) =>
  ["x", "y", "w", "h"]
    .map((key) => `${key}=${Number(box?.[key] || 0).toFixed(3)}`)
    .join(", ");

const enhancedIdentityPrompt = (asset) => {
  const locators = [
    ...(asset.baselineObservations?.faces || []).map((item) => ({
      ...item,
      kind: "face",
    })),
    ...(asset.baselineObservations?.bodies || []).map((item) => ({
      ...item,
      kind: "body",
    })),
  ].filter((item) => item.personId && item.subject && item.box);
  const people = [
    ...new Map(locators.map((item) => [item.personId, item])).values(),
  ];
  if (people.length === 0) return { aliases: [], prompt: baseScenePrompt };
  const aliases = people.map((item, index) => ({
    alias: `IDENTITY_${index + 1}`,
    personId: item.personId,
    subject: item.subject,
  }));
  const lines = locators.map((item) => {
    const alias = aliases.find(
      (candidate) => candidate.personId === item.personId,
    )?.alias;
    return `- ${alias}: owner-confirmed ${item.kind} box (${roundedBox(item.box)})`;
  });
  return {
    aliases,
    prompt: `${baseScenePrompt}\n\nThe owner has confirmed these spatial identity locators (normalized source-image coordinates, top-left origin):\n${lines.join("\n")}\nUse the exact alias directly as that person's name in the summary, for example \"IDENTITY_1 rides a bicycle\". Never say \"identified as\", \"confirmed as\", or otherwise explain the alias. Call every other person \"another person\". Never emit a display name or infer an identity outside its locator. The application will replace aliases with current owner-controlled names.`,
  };
};

const replaceIdentityAliases = (proposal, aliases) => ({
  ...proposal,
  summary: aliases.reduce(
    (summary, item) =>
      summary.replaceAll(item.alias, `{{person:${item.personId}}}`),
    proposal.summary,
  ),
});

const checkedFetch = async (url, init, timeoutMs) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw Object.assign(
      new Error(`local model returned HTTP ${response.status}`),
      { code: "LOCAL_AI_LOCAL_MODEL_FAILED" },
    );
  const contentLength = Number(response.headers.get("content-length"));
  const maximumBytes = 4 * 1024 * 1024;
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw Object.assign(new Error("local model response is oversized"), {
      code: "LOCAL_AI_PROVIDER_OUTPUT_OVERSIZED",
    });
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maximumBytes) {
    throw Object.assign(new Error("local model response is oversized"), {
      code: "LOCAL_AI_PROVIDER_OUTPUT_OVERSIZED",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("local model returned invalid JSON"), {
      code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
    });
  }
};

const boundedStrings = (value, label, maximumItems) => {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some((item) => typeof item !== "string")
  ) {
    throw Object.assign(new Error(`local model returned invalid ${label}`), {
      code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
    });
  }
  return value.map((item) => item.trim()).filter(Boolean);
};

const validateSceneProposal = (value) => {
  const keys = [
    "activities",
    "objects",
    "peopleCountEstimate",
    "qualityFlags",
    "scene",
    "summary",
    "visibleText",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== keys.sort().join("|")
  ) {
    throw Object.assign(
      new Error("local model returned an invalid scene contract"),
      { code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID" },
    );
  }
  if (
    !Number.isInteger(value.peopleCountEstimate) ||
    value.peopleCountEstimate < 0 ||
    value.peopleCountEstimate > 100
  ) {
    throw Object.assign(
      new Error("local model returned an invalid people count"),
      { code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID" },
    );
  }
  if (typeof value.scene !== "string" || typeof value.summary !== "string") {
    throw Object.assign(new Error("local model returned invalid scene text"), {
      code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
    });
  }
  return {
    activities: boundedStrings(value.activities, "activities", 12),
    objects: boundedStrings(value.objects, "objects", 24),
    peopleCountEstimate: value.peopleCountEstimate,
    qualityFlags: boundedStrings(
      value.qualityFlags,
      "quality flags",
      12,
    ).filter(
      (item) =>
        !/(?:partial|cropped|incidental).{0,24}(?:text|word)|watermark|logo|interface/i.test(
          item,
        ),
    ),
    scene: value.scene.trim(),
    summary: value.summary.trim(),
    visibleText: boundedStrings(value.visibleText, "visible text", 30),
  };
};

const appleSceneLabels = new Map([
  ["bar", "bar"],
  ["beach", "beach"],
  ["cave", "cave"],
  ["dirt_road", "dirt road"],
  ["interior_room", "indoor room"],
  ["interior_shop", "shop"],
  ["nightclub", "nightclub"],
  ["restaurant", "restaurant"],
  ["road_other", "road"],
  ["storefront", "shopfront"],
]);
const appleActivityLabels = new Set([
  "dancing",
  "diving",
  "eating",
  "hiking",
  "rock_climbing",
  "running",
  "skiing",
  "sunbathing",
  "surfing",
  "swimming",
]);
const appleGenericLabels = new Set([
  "adult",
  "art",
  "child",
  "clothing",
  "container",
  "conveyance",
  "decoration",
  "furniture",
  "land",
  "machine",
  "material",
  "outdoor",
  "people",
  "plant",
  "recreation",
  "sky",
  "structure",
  "tableware",
  "teen",
  "utensil",
  "vehicle",
]);
const appleLowValueLabels = new Set([
  "consumer_electronics",
  "daytime",
  "frame",
  "light",
  "liquid",
  "optical_equipment",
  "portal",
  "sport",
  "textile",
  "watersport",
  "wood_natural",
  "wood_processed",
]);
const humanizeAppleLabel = (value) => value.replaceAll("_", " ");

const appleVisionProposal = (raw, asset) => {
  if (
    !raw ||
    raw.schemaVersion !== "cimmich.apple-vision-summary.raw.v1" ||
    raw.imagePath !== asset.path ||
    !Array.isArray(raw.classifications) ||
    !Array.isArray(raw.animals) ||
    !Array.isArray(raw.visibleText) ||
    !Array.isArray(raw.errors) ||
    raw.errors.length > 0 ||
    !Number.isInteger(raw.faceCount) ||
    !Number.isInteger(raw.humanCount)
  ) {
    throw Object.assign(new Error("Apple Vision result is invalid"), {
      code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
    });
  }
  const classifications = raw.classifications.filter(
    (row) =>
      row &&
      typeof row.identifier === "string" &&
      Number.isFinite(row.confidence) &&
      row.confidence >= 0 &&
      row.confidence <= 1,
  );
  const sceneEntry = classifications.find(
    (row) => row.confidence >= 0.12 && appleSceneLabels.has(row.identifier),
  );
  const activities = classifications
    .filter(
      (row) =>
        row.confidence >= 0.45 && appleActivityLabels.has(row.identifier),
    )
    .slice(0, 4)
    .map((row) => humanizeAppleLabel(row.identifier));
  const excluded = new Set([
    ...appleGenericLabels,
    ...appleLowValueLabels,
    ...appleActivityLabels,
    ...appleSceneLabels.keys(),
  ]);
  let objects = classifications
    .filter((row) => row.confidence >= 0.2 && !excluded.has(row.identifier))
    .slice(0, 8)
    .map((row) => humanizeAppleLabel(row.identifier));
  for (const animal of raw.animals) {
    const label = animal?.labels?.find(
      (row) => typeof row.identifier === "string" && row.confidence >= 0.5,
    )?.identifier;
    if (label && !objects.includes(label)) objects.push(label);
  }
  const collapsedParents = new Set();
  if (
    objects.some((value) => ["atv", "motorcycle", "scooter"].includes(value))
  ) {
    for (const value of ["rim", "tire", "wheel"]) collapsedParents.add(value);
  }
  if (objects.includes("helmet")) collapsedParents.add("headgear");
  if (objects.includes("atv")) collapsedParents.add("scooter");
  if (
    objects.some((value) =>
      ["apple", "banana", "grape", "mango", "oranges", "pineapple"].includes(
        value,
      ),
    )
  ) {
    for (const value of ["citrus fruit", "food", "fruit"])
      collapsedParents.add(value);
  }
  if (objects.includes("folding chair")) collapsedParents.add("chair");
  objects = objects.filter((value) => !collapsedParents.has(value));
  const visibleText = raw.visibleText
    .filter(
      (row) =>
        row &&
        typeof row.identifier === "string" &&
        row.identifier.trim().length >= 2 &&
        Number(row.confidence) >= 0.5,
    )
    .slice(0, 30)
    .map((row) => row.identifier.trim());
  const baselinePeople = Math.max(
    asset.acceptedSubjects?.length || 0,
    asset.baselineObservations?.faces?.length || 0,
    asset.baselineObservations?.bodies?.length || 0,
  );
  const peopleCountEstimate = Math.min(
    100,
    Math.max(raw.faceCount, raw.humanCount, baselinePeople),
  );
  const scene = sceneEntry
    ? appleSceneLabels.get(sceneEntry.identifier)
    : classifications.some((row) => row.identifier === "outdoor")
      ? "outdoors"
      : classifications.some((row) => row.identifier === "interior_room")
        ? "indoors"
        : "general scene";
  const peopleText =
    peopleCountEstimate === 0
      ? "No person is clearly detected"
      : peopleCountEstimate === 1
        ? "One person is visible"
        : `${peopleCountEstimate} people are visible`;
  const activityText = activities.length
    ? `, with ${activities.join(" and ")}`
    : "";
  const objectText = objects.length
    ? ` Visible details include ${objects.slice(0, 5).join(", ")}.`
    : "";
  const scenePhrase =
    scene === "outdoors"
      ? "outdoors"
      : scene === "general scene"
        ? "in the scene"
        : ["beach", "shopfront"].includes(scene)
          ? `at a ${scene}`
          : ["dirt road", "road"].includes(scene)
            ? `on a ${scene}`
            : `in a ${scene}`;
  return validateSceneProposal({
    activities,
    objects,
    peopleCountEstimate,
    qualityFlags: [
      ...(raw.faceCount === 0 && baselinePeople > 0
        ? ["known person without Apple face detection"]
        : []),
    ],
    scene,
    summary: `${peopleText} ${scenePhrase}${activityText}.${objectText}`,
    visibleText,
  });
};

export const runAppleVisionSceneTextBatch = async ({ assets, config }) => {
  if (!config.enabled) {
    return assets.map(() => ({
      operation: "scene-text",
      reason: "provider_disabled",
      state: "unavailable",
    }));
  }
  try {
    const adapterDigest = await fileDigest(config.executablePath);
    const sourceDigest = await fileDigest(
      join(dirname(config.executablePath), "provider.swift"),
    ).catch(() => adapterDigest);
    const response = await runProcess({
      args: [
        "--json-array",
        ...(config.includeOcr ? [] : ["--skip-ocr"]),
        ...assets.map((asset) => asset.path),
      ],
      command: config.executablePath,
      timeoutMs: config.timeoutMs,
    });
    if (
      response?.schemaVersion !== "cimmich.apple-vision-summary.raw.v1" ||
      typeof response.runtime?.adapterVersion !== "string" ||
      typeof response.runtime?.operatingSystem !== "string" ||
      !Array.isArray(response.results) ||
      response.results.length !== assets.length
    ) {
      throw Object.assign(new Error("Apple Vision batch result is invalid"), {
        code: "LOCAL_AI_PROVIDER_OUTPUT_INVALID",
      });
    }
    const modelDigest = digest({
      adapterDigest,
      runtime: response.runtime,
      sourceDigest,
      model: "apple-vision-system",
      provider: "apple-vision-native-summary",
    });
    const configDigest = digest({
      activityConfidence: 0.45,
      adapterDigest,
      composerVersion: "apple-specialist-composer-v2",
      includeOcr: config.includeOcr,
      objectConfidence: 0.2,
      sceneConfidence: 0.12,
      sourceDigest,
    });
    return response.results.map((raw, index) => {
      const proposal = appleVisionProposal(raw, assets[index]);
      return {
        activationAuthority: "none",
        configDigest,
        model: { digest: modelDigest, name: "Apple Vision", size: 0 },
        network: "none",
        operation: "scene-text",
        providerId: "apple-vision-native-summary",
        proposal,
        proposalDigest: digest(proposal),
        state: "proposed",
      };
    });
  } catch (error) {
    return assets.map(() => providerFailure("scene-text", error));
  }
};

export const runSceneText = async ({ asset, config }) => {
  if (!config.enabled)
    return {
      operation: "scene-text",
      state: "unavailable",
      reason: "provider_disabled",
    };
  if (config.provider === "apple-vision") {
    return (await runAppleVisionSceneTextBatch({ assets: [asset], config }))[0];
  }
  try {
    const identityPrompt =
      config.summaryTier === "enhanced"
        ? enhancedIdentityPrompt(asset)
        : { aliases: [], prompt: baseScenePrompt };
    const tags = await checkedFetch(
      `${config.endpoint}/api/tags`,
      {},
      config.timeoutMs,
    );
    const installed = tags.models?.find(
      (candidate) =>
        candidate.name === config.model || candidate.model === config.model,
    );
    if (!installed)
      throw Object.assign(
        new Error("configured local vision model is not installed"),
        { code: "LOCAL_AI_MODEL_UNAVAILABLE" },
      );
    const encoded = (await readFile(asset.path)).toString("base64");
    const response = await checkedFetch(
      `${config.endpoint}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: sceneSchema,
          messages: [
            {
              role: "user",
              content: identityPrompt.prompt,
              images: [encoded],
            },
          ],
          model: config.model,
          options: { temperature: 0, seed: 0 },
          stream: false,
          think: false,
        }),
      },
      config.timeoutMs,
    );
    const structuredText =
      response.message?.content?.trim() ||
      response.message?.thinking?.trim() ||
      "";
    const proposal = replaceIdentityAliases(
      validateSceneProposal(JSON.parse(structuredText)),
      identityPrompt.aliases,
    );
    return {
      activationAuthority: "none",
      configDigest: digest({
        format: sceneSchema,
        modelDigest: installed.digest,
        options: { seed: 0, temperature: 0 },
        prompt: identityPrompt.prompt,
        promptVersion:
          config.summaryTier === "enhanced"
            ? "literal-visible-evidence-with-owner-locators-v2"
            : "literal-visible-evidence-v2",
      }),
      model: {
        digest: installed.digest,
        name: installed.name,
        size: installed.size,
      },
      network: "loopback-only",
      operation: "scene-text",
      providerId: "ollama-local-vision-photo-lab",
      proposal,
      proposalDigest: digest(proposal),
      state: "proposed",
    };
  } catch (error) {
    return providerFailure("scene-text", error);
  }
};

export const runEnhance = async ({
  asset,
  config,
  operation = "enhance",
  outputPath,
}) => {
  const quick = operation === "enhance-preview";
  if (!quick && !config.enabled)
    return {
      operation,
      state: "unavailable",
      reason: "provider_disabled",
    };
  try {
    const result = await runProcess({
      args: [
        join(pythonRoot, "image_tools.py"),
        "enhance",
        "--method",
        quick ? "quick" : "best",
        "--input",
        asset.path,
        ...(!quick ? ["--model", config.modelPath] : []),
        "--output",
        outputPath,
        "--device",
        config.device,
        "--max-input-pixels",
        String(config.maxInputPixels),
        "--runtime",
        config.runtimePath,
      ],
      command: config.pythonPath,
      timeoutMs: config.timeoutMs,
    });
    return {
      ...result,
      activationAuthority: "none",
      operation,
      output: undefined,
      state: "derived",
    };
  } catch (error) {
    return providerFailure(operation, error);
  }
};

export const renderOverlay = async ({
  asset,
  bodies,
  faces,
  poses,
  config,
  dataPath,
  outputPath,
}) => {
  try {
    return await runProcess({
      args: [
        join(pythonRoot, "image_tools.py"),
        "overlay",
        "--input",
        asset.path,
        "--data",
        dataPath,
        "--output",
        outputPath,
        "--rotate-quarter-turns",
        String(asset.presentationRotationQuarterTurns),
      ],
      command: config.pythonPath,
      timeoutMs: config.timeoutMs,
    });
  } catch (error) {
    return providerFailure("overlay", error);
  }
};
