import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createLocalAiService } from "../src/local-ai-service.mjs";

const assetId = "2af22c3c-e009-42a4-98e8-bb0f790bb25f";

test("Local AI is fail-closed by default", async () => {
  const service = await createLocalAiService({
    environment: {},
    immichCompanion: {},
    repository: {},
  });
  assert.deepEqual(service.status().capabilities, {
    best: false,
    bodies: false,
    context: false,
    faces: false,
    quick: false,
    sceneText: false,
  });
  assert.equal(service.status().state, "disabled");
  await assert.rejects(
    service.start({ operation: "faces", sourceAssetIds: [assetId] }),
    (error) => error.code === "LOCAL_AI_DISABLED" && error.statusCode === 503,
  );
});

test("Local AI reports only present models and checks current visibility before media reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-local-ai-service-"));
  try {
    const faceModel = join(root, "face.onnx");
    await writeFile(faceModel, "private-test-model");
    let mediaReads = 0;
    const service = await createLocalAiService({
      environment: {
        CIMMICH_LOCAL_AI_ENABLED: "true",
        CIMMICH_LOCAL_AI_FACE_MODEL_PATH: faceModel,
        CIMMICH_LOCAL_AI_ROOT: root,
      },
      immichCompanion: {
        readAssetImage: async () => {
          mediaReads += 1;
          throw new Error("must not read hidden media");
        },
      },
      repository: {
        filterPresentableAssetSourceIds: async () => ({ sourceAssetIds: [] }),
      },
    });
    assert.equal(service.status().state, "ready");
    assert.equal(service.status().capabilities.faces, true);
    assert.equal(service.status().capabilities.quick, true);
    await assert.rejects(
      service.start({ operation: "faces", sourceAssetIds: [assetId] }),
      (error) =>
        error.code === "LOCAL_AI_ASSET_NOT_VISIBLE" && error.statusCode === 404,
    );
    assert.equal(mediaReads, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Body activation does not implicitly activate unvalidated Context", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-local-ai-service-"));
  try {
    const bodyModel = join(root, "body.pt");
    const bodyManifest = join(root, "body.json");
    await writeFile(bodyModel, "private-body-model");
    await writeFile(bodyManifest, "{}");
    const baseEnvironment = {
      CIMMICH_LOCAL_AI_BODY_ENABLED: "true",
      CIMMICH_LOCAL_AI_BODY_MANIFEST_PATH: bodyManifest,
      CIMMICH_LOCAL_AI_BODY_MODEL_PATH: bodyModel,
      CIMMICH_LOCAL_AI_ENABLED: "true",
      CIMMICH_LOCAL_AI_ROOT: root,
    };
    const bodyOnly = await createLocalAiService({
      environment: baseEnvironment,
      immichCompanion: {},
      repository: {},
    });
    assert.equal(bodyOnly.status().capabilities.bodies, true);
    assert.equal(bodyOnly.status().capabilities.context, false);

    const explicitlyValidatedContext = await createLocalAiService({
      environment: {
        ...baseEnvironment,
        CIMMICH_LOCAL_AI_CONTEXT_ENABLED: "true",
      },
      immichCompanion: {},
      repository: {},
    });
    assert.equal(
      explicitlyValidatedContext.status().capabilities.context,
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Local AI rejects unknown fields and unconfigured model capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-local-ai-service-"));
  try {
    const service = await createLocalAiService({
      environment: {
        CIMMICH_LOCAL_AI_ENABLED: "true",
        CIMMICH_LOCAL_AI_ROOT: root,
      },
      immichCompanion: {},
      repository: {},
    });
    await assert.rejects(
      service.start({ operation: "best", sourceAssetIds: [assetId] }),
      (error) => error.code === "LOCAL_AI_CAPABILITY_UNAVAILABLE",
    );
    await assert.rejects(
      service.start({
        extra: true,
        operation: "faces",
        sourceAssetIds: [assetId],
      }),
      (error) => error.code === "LOCAL_AI_INPUT_INVALID",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Vulkan Best is ready only with its executable and both model artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-local-ai-service-"));
  try {
    const model = join(root, "realesrgan-x4plus.bin");
    const parameter = join(root, "realesrgan-x4plus.param");
    const runtime = join(root, "realesrgan-ncnn-vulkan");
    await writeFile(model, "model");
    await writeFile(parameter, "parameter");
    await writeFile(runtime, "runtime");
    const environment = {
      CIMMICH_LOCAL_AI_ENABLED: "true",
      CIMMICH_LOCAL_AI_ENHANCE_DEVICE: "vulkan",
      CIMMICH_LOCAL_AI_ENHANCE_VULKAN_MODEL_PATH: model,
      CIMMICH_LOCAL_AI_ENHANCE_VULKAN_RUNTIME_PATH: runtime,
      CIMMICH_LOCAL_AI_ROOT: root,
    };
    const unavailable = await createLocalAiService({
      environment,
      immichCompanion: {},
      repository: {},
    });
    assert.equal(unavailable.status().capabilities.best, false);
    await chmod(runtime, 0o500);
    const ready = await createLocalAiService({
      environment,
      immichCompanion: {},
      repository: {},
    });
    assert.equal(ready.status().capabilities.best, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Local AI completes a bounded derived run and re-verifies the source before serving it", async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-local-ai-service-"));
  const sourceBytes = Buffer.from("unchanged-source-photo");
  const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
  const artifactBytes = Buffer.from("derived-preview");
  const artifactDigest = createHash("sha256")
    .update(artifactBytes)
    .digest("hex");
  let fingerprintDigest = sourceDigest;
  let observedSet;
  try {
    const enhanceModel = join(root, "enhance.onnx");
    await writeFile(enhanceModel, "private-test-model");
    const fakeSpawn = (_command, args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      setImmediate(async () => {
        observedSet = JSON.parse(
          await readFile(args[args.indexOf("--set") + 1], "utf8"),
        );
        child.stderr.write(
          'CIMMICH_LOCAL_AI_PROGRESS {"completedUnits":1,"operation":"quick","schemaVersion":"cimmich.local-ai-progress.v1","stage":"sharpening","totalUnits":3}\n',
        );
        await new Promise((resolve) => setTimeout(resolve, 15));
        const outputRoot = args[args.indexOf("--output") + 1];
        const runDir = join(outputRoot, "sets", "test-set", "runs", "0001");
        const artifactPath = join(runDir, "artifacts", `${assetId}-quick.png`);
        await mkdir(join(runDir, "artifacts"), { recursive: true });
        await writeFile(artifactPath, artifactBytes);
        const resultPath = join(runDir, "result.json");
        await writeFile(
          resultPath,
          JSON.stringify({
            assets: [
              {
                assetId,
                artifacts: {},
                operations: {
                  enhancePreview: {
                    artifact: {
                      digest: artifactDigest,
                      path: `artifacts/${assetId}-quick.png`,
                    },
                    state: "derived",
                  },
                },
                sourceContentDigest: sourceDigest,
              },
            ],
            originalsUnchanged: true,
            state: "completed",
          }),
        );
        child.stdout.end(JSON.stringify({ resultPath }));
        child.stderr.end();
        child.emit("close", 0, null);
      });
      return child;
    };
    const service = await createLocalAiService({
      environment: {
        CIMMICH_LOCAL_AI_ENABLED: "true",
        CIMMICH_LOCAL_AI_ENHANCE_MODEL_PATH: enhanceModel,
        CIMMICH_LOCAL_AI_ROOT: root,
      },
      immichCompanion: {
        readAssetFingerprint: async () => ({
          contentDigest: fingerprintDigest,
        }),
        readAssetImage: async () => ({
          asset: { originalFileName: "photo.jpg" },
          bytes: sourceBytes,
          contentDigest: sourceDigest,
          mimeType: "image/jpeg",
        }),
      },
      repository: {
        assetEvidence: async () => ({
          bodies: [],
          capture_time: null,
          faces: [],
          rotation_quarter_turns: 3,
        }),
        filterPresentableAssetSourceIds: async ({ sourceAssetIds }) => ({
          sourceAssetIds,
        }),
      },
      spawnImpl: fakeSpawn,
    });
    const started = await service.start({
      operation: "quick",
      sourceAssetIds: [assetId],
    });
    let completed = started;
    let observedModelProgress = null;
    for (
      let attempt = 0;
      attempt < 20 &&
      !["completed", "failed", "partial"].includes(completed.state);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed = service.get(started.jobId);
      observedModelProgress ||= completed.progress.model || null;
    }
    assert.equal(completed.state, "completed");
    assert.deepEqual(observedModelProgress, {
      completedUnits: 1,
      operation: "quick",
      stage: "sharpening",
      totalUnits: 3,
    });
    assert.deepEqual(completed.artifactTokens, [`${assetId}:quick`]);
    assert.equal(completed.result.originalsUnchanged, true);
    assert.equal(observedSet.assets[0].presentationRotationQuarterTurns, 3);
    const artifact = await service.artifact({
      jobId: started.jobId,
      token: `${assetId}:quick`,
    });
    assert.deepEqual(artifact.bytes, artifactBytes);
    fingerprintDigest = "0".repeat(64);
    await assert.rejects(
      service.artifact({ jobId: started.jobId, token: `${assetId}:quick` }),
      (error) =>
        error.code === "LOCAL_AI_SOURCE_CHANGED" && error.statusCode === 409,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
