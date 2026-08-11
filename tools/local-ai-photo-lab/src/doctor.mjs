import { readFile } from "node:fs/promises";
import { digest, fileDigest, validateConfig } from "./contract.mjs";
import { trackedSpawn } from "./processes.mjs";

const failure = (checkId, error) => ({
  checkId,
  errorCode: error?.code ?? "LOCAL_AI_DOCTOR_CHECK_FAILED",
  state: "failed",
});

const skipped = (checkId, reason = "provider_disabled") => ({
  checkId,
  reason,
  state: "skipped",
});

const terminateProcess = (child) => {
  child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, 1000);
  escalation.unref();
};

const boundedResponseJson = async (response) => {
  const maximumBytes = 1024 * 1024;
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw Object.assign(new Error("doctor response is oversized"), {
      code: "LOCAL_AI_DOCTOR_OUTPUT_OVERSIZED",
    });
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maximumBytes) {
    throw Object.assign(new Error("doctor response is oversized"), {
      code: "LOCAL_AI_DOCTOR_OUTPUT_OVERSIZED",
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("doctor response returned invalid JSON"), {
      code: "LOCAL_AI_DOCTOR_OUTPUT_INVALID",
    });
  }
};

const runJson = ({ args, command, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = trackedSpawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
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
        Object.assign(new Error("doctor process timed out"), {
          code: "LOCAL_AI_DOCTOR_TIMEOUT",
        }),
      );
    }, timeoutMs);
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        terminateProcess(child);
        fail(
          Object.assign(new Error("doctor process output is oversized"), {
            code: "LOCAL_AI_DOCTOR_OUTPUT_OVERSIZED",
          }),
        );
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      fail(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          Object.assign(
            new Error(
              Buffer.concat(stderr).toString("utf8").trim() ||
                `doctor process exited ${code}`,
            ),
            { code: "LOCAL_AI_DOCTOR_RUNTIME_FAILED" },
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch {
        reject(
          Object.assign(new Error("doctor process returned invalid JSON"), {
            code: "LOCAL_AI_DOCTOR_OUTPUT_INVALID",
          }),
        );
      }
    });
  });

const pythonCheck = async ({
  checkId,
  code,
  enabled,
  pythonPath,
  timeoutMs,
}) => {
  if (!enabled) return skipped(checkId);
  try {
    const details = await runJson({
      args: ["-c", code],
      command: pythonPath,
      timeoutMs,
    });
    return { checkId, details, state: "passed" };
  } catch (error) {
    return failure(checkId, error);
  }
};

const artifactCheck = async ({ checkId, enabled, paths }) => {
  if (!enabled) return skipped(checkId);
  try {
    const artifacts = {};
    for (const [name, path] of Object.entries(paths)) {
      artifacts[name] = await fileDigest(path);
    }
    return { artifacts, checkId, state: "passed" };
  } catch (error) {
    return failure(checkId, error);
  }
};

const bodyManifestCheck = async ({ config, modelDigest, runtime }) => {
  if (!config.enabled) return skipped("body-manifest");
  try {
    const manifest = JSON.parse(await readFile(config.manifestPath, "utf8"));
    if (manifest.schemaVersion !== "cimmich.body-detector.v1") {
      throw Object.assign(new Error("body manifest schema is invalid"), {
        code: "LOCAL_AI_BODY_MANIFEST_INVALID",
      });
    }
    if (manifest.detector?.artifactDigest !== modelDigest) {
      throw Object.assign(
        new Error("body model digest does not match manifest"),
        {
          code: "LOCAL_AI_BODY_MODEL_MISMATCH",
        },
      );
    }
    const { detectorConfigDigest, ...manifestCore } = manifest;
    if (detectorConfigDigest !== digest(manifestCore)) {
      throw Object.assign(
        new Error("body manifest digest does not match its contents"),
        { code: "LOCAL_AI_BODY_MANIFEST_DIGEST_MISMATCH" },
      );
    }
    if (
      manifest.execution?.network !== "forbidden" ||
      manifest.privacy?.externalUpload !== "none" ||
      manifest.privacy?.sourceMedia !== "local-read-only"
    ) {
      throw Object.assign(
        new Error("body manifest privacy boundary is invalid"),
        {
          code: "LOCAL_AI_BODY_PRIVACY_INVALID",
        },
      );
    }
    const acceleratorUnconfirmed =
      manifest.execution.device === "gpu" && runtime.details?.mps !== true;
    return {
      checkId: "body-manifest",
      details: {
        acceleratorConfirmed: !acceleratorUnconfirmed,
        detectorConfigDigest: manifest.detectorConfigDigest,
        device: manifest.execution.device,
        network: manifest.execution.network,
        providerId: manifest.provider?.providerId,
        threads: manifest.execution.threads,
      },
      reason: acceleratorUnconfirmed
        ? "REQUESTED_GPU_NOT_CONFIRMED"
        : undefined,
      state: acceleratorUnconfirmed ? "warning" : "passed",
    };
  } catch (error) {
    return failure("body-manifest", error);
  }
};

const sceneCheck = async ({ config, timeoutMs }) => {
  if (!config.enabled) return skipped("scene-text-loopback");
  try {
    const response = await fetch(`${config.endpoint}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`local model returned HTTP ${response.status}`),
        {
          code: "LOCAL_AI_LOCAL_MODEL_FAILED",
        },
      );
    }
    const tags = await boundedResponseJson(response);
    const installed = tags.models?.find(
      (candidate) =>
        candidate.name === config.model || candidate.model === config.model,
    );
    if (!installed) {
      throw Object.assign(
        new Error("configured local vision model is unavailable"),
        {
          code: "LOCAL_AI_MODEL_UNAVAILABLE",
        },
      );
    }
    return {
      checkId: "scene-text-loopback",
      details: {
        modelDigest: installed.digest,
        modelName: installed.name ?? installed.model,
        network: "loopback-only",
      },
      state: "passed",
    };
  } catch (error) {
    return failure("scene-text-loopback", error);
  }
};

export const runDoctor = async ({ configInput }) => {
  const started = Date.now();
  const config = validateConfig(configInput);
  const timeoutMs = Math.min(config.limits.providerTimeoutMs, 30_000);
  const vulkanEnhance = config.providers.enhance.device === "vulkan";
  const enhanceModelParameterPath = config.providers.enhance.modelPath.endsWith(
    ".bin",
  )
    ? `${config.providers.enhance.modelPath.slice(0, -4)}.param`
    : `${config.providers.enhance.modelPath}.param`;
  const [
    faceRuntime,
    bodyRuntime,
    enhanceRuntime,
    faceArtifacts,
    bodyArtifacts,
    enhanceArtifacts,
    scene,
  ] = await Promise.all([
    pythonCheck({
      checkId: "face-runtime",
      code: "import json,cv2,insightface,onnxruntime,PIL; print(json.dumps({'opencv':cv2.__version__,'insightface':insightface.__version__,'onnxruntime':onnxruntime.__version__,'pillow':PIL.__version__,'providers':onnxruntime.get_available_providers()}))",
      enabled: config.providers.faces.enabled,
      pythonPath: config.providers.faces.pythonPath,
      timeoutMs,
    }),
    pythonCheck({
      checkId: "body-runtime",
      code: "import json,numpy,PIL,torch,ultralytics; print(json.dumps({'numpy':numpy.__version__,'pillow':PIL.__version__,'torch':torch.__version__,'ultralytics':ultralytics.__version__,'mps':bool(getattr(torch.backends,'mps',None) and torch.backends.mps.is_available())}))",
      enabled: config.providers.bodies.enabled,
      pythonPath: config.providers.bodies.pythonPath,
      timeoutMs,
    }),
    pythonCheck({
      checkId: "enhance-runtime",
      code: vulkanEnhance
        ? `import json,subprocess; r=subprocess.run([${JSON.stringify(config.providers.enhance.runtimePath)},'-h'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10); assert r.returncode == 0; print(json.dumps({'device':'vulkan','runtime':'realesrgan-ncnn-vulkan'}))`
        : "import json,onnxruntime,PIL; print(json.dumps({'onnxruntime':onnxruntime.__version__,'pillow':PIL.__version__,'providers':onnxruntime.get_available_providers()}))",
      enabled: config.providers.enhance.enabled,
      pythonPath: config.providers.enhance.pythonPath,
      timeoutMs,
    }),
    artifactCheck({
      checkId: "face-artifacts",
      enabled: config.providers.faces.enabled,
      paths: { detectorModel: config.providers.faces.detectorModelPath },
    }),
    artifactCheck({
      checkId: "body-artifacts",
      enabled: config.providers.bodies.enabled,
      paths: {
        manifest: config.providers.bodies.manifestPath,
        model: config.providers.bodies.modelPath,
        providerScript: config.providers.bodies.providerScriptPath,
      },
    }),
    artifactCheck({
      checkId: "enhance-artifacts",
      enabled: config.providers.enhance.enabled,
      paths: vulkanEnhance
        ? {
            model: config.providers.enhance.modelPath,
            modelParameter: enhanceModelParameterPath,
            runtime: config.providers.enhance.runtimePath,
          }
        : { model: config.providers.enhance.modelPath },
    }),
    sceneCheck({ config: config.providers.sceneText, timeoutMs }),
  ]);
  const bodyManifest = await bodyManifestCheck({
    config: config.providers.bodies,
    modelDigest: bodyArtifacts.artifacts?.model,
    runtime: bodyRuntime,
  });
  const checks = [
    faceRuntime,
    faceArtifacts,
    bodyRuntime,
    bodyArtifacts,
    bodyManifest,
    scene,
    enhanceRuntime,
    enhanceArtifacts,
  ];
  const failed = checks.filter(({ state }) => state === "failed").length;
  const passed = checks.filter(({ state }) => state === "passed").length;
  const warnings = checks.filter(({ state }) => state === "warning").length;
  return {
    checks,
    configDigest: digest(config),
    durationMs: Date.now() - started,
    schemaVersion: "cimmich.local-ai-photo-lab-doctor.v1",
    state: failed
      ? "failed"
      : warnings
        ? "degraded"
        : passed
          ? "ready"
          : "limited",
    summary: {
      failed,
      passed,
      skipped: checks.length - failed - passed - warnings,
      warnings,
    },
  };
};

export const runDoctorFromFile = async ({ configPath }) =>
  runDoctor({ configInput: JSON.parse(await readFile(configPath, "utf8")) });
