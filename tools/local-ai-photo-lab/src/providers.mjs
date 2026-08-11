import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
          sourceContentDigest: asset.sourceContentDigest,
        }),
        manifestPath: config.manifestPath,
        modelPath: config.modelPath,
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
            sourceContentDigest: asset.sourceContentDigest,
          }),
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

const scenePrompt =
  "Inspect only visible evidence in this image. Do not identify or guess the names of people. Return a concise literal summary, scene, visible activities, concrete objects, legible text only, a conservative people count, and visible quality issues. Use empty arrays when evidence is absent.";

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
    qualityFlags: boundedStrings(value.qualityFlags, "quality flags", 12),
    scene: value.scene.trim(),
    summary: value.summary.trim(),
    visibleText: boundedStrings(value.visibleText, "visible text", 30),
  };
};

export const runSceneText = async ({ asset, config }) => {
  if (!config.enabled)
    return {
      operation: "scene-text",
      state: "unavailable",
      reason: "provider_disabled",
    };
  try {
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
              content: scenePrompt,
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
    const proposal = validateSceneProposal(JSON.parse(structuredText));
    return {
      activationAuthority: "none",
      configDigest: digest({
        format: sceneSchema,
        modelDigest: installed.digest,
        options: { seed: 0, temperature: 0 },
        prompt: scenePrompt,
        promptVersion: "literal-visible-evidence-v1",
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
      ],
      command: config.pythonPath,
      timeoutMs: config.timeoutMs,
    });
  } catch (error) {
    return providerFailure("overlay", error);
  }
};
