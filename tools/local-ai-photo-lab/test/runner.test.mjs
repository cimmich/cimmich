import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runPhotoLab } from "../src/runner.mjs";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const configInput = {
  contextPolicy: {
    minimumMargin: 0.05,
    minimumSimilarity: 0.72,
    requireBidirectionalAnchors: true,
  },
  limits: {
    maxAssets: 10,
    maxEnhanceInputPixels: 1000,
    maxInputBytes: 1000,
    maxInputPixels: 1000,
    providerTimeoutMs: 1000,
  },
  providers: {
    bodies: {
      enabled: true,
      manifestPath: "/m",
      modelPath: "/b",
      providerScriptPath: "/p",
      pythonPath: "/py",
    },
    enhance: {
      device: "cpu",
      enabled: true,
      modelPath: "/e",
      pythonPath: "/py",
      scale: 2,
    },
    faces: {
      detectorModelPath: "/f",
      device: "cpu",
      enabled: true,
      pythonPath: "/py",
      scoreThreshold: 0.2,
    },
    sceneText: {
      enabled: true,
      endpoint: "http://localhost:11434",
      model: "vision",
    },
  },
  schemaVersion: "cimmich.local-ai-photo-lab-config.v1",
};

const providerImplementations = {
  async probeImage() {
    return {
      height: 1,
      schemaVersion: "cimmich.local-ai-image-probe.v1",
      width: 1,
    };
  },
  async renderOverlay({ outputPath }) {
    await writeFile(outputPath, tinyPng);
    return { artifactDigest: "overlay" };
  },
  async runBodies({ asset }) {
    return {
      bodies: [
        {
          appearanceFeature: [1, 0],
          bodyId: `body-${asset.assetId}`,
          box: { h: 0.8, w: 0.5, x: 0.2, y: 0.1 },
          featureDigest: "private-vector-digest",
        },
      ],
      operation: "bodies",
      state: "bodies_detected",
    };
  },
  async runEnhance({ outputPath }) {
    await writeFile(outputPath, tinyPng);
    return {
      artifactDigest: "enhance",
      operation: "enhance",
      scale: 2,
      state: "derived",
    };
  },
  async runFaces({ asset }) {
    return {
      faces: [
        {
          bodyId: `face-${asset.assetId}`,
          box: { h: 0.2, w: 0.2, x: 0.3, y: 0.1 },
        },
      ],
      operation: "faces",
      state: "faces_detected",
    };
  },
  async runSceneText() {
    return {
      operation: "scene-text",
      proposal: {
        activities: [],
        objects: [],
        peopleCountEstimate: 1,
        qualityFlags: [],
        scene: "room",
        summary: "A person.",
        visibleText: [],
      },
      state: "proposed",
    };
  },
};

test("runner appends immutable receipts, strips paths/vectors, and diffs reruns", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-runner-"));
  const inputs = join(root, "inputs");
  const outputRoot = join(root, "output");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(inputs));
  const paths = ["left.png", "middle.png", "right.png"].map((name) =>
    join(inputs, name),
  );
  for (const [index, path] of paths.entries())
    await writeFile(path, Buffer.concat([tinyPng, Buffer.from([index])]));
  const setInput = {
    assets: paths.map((path, index) => ({
      acceptedSubjects: index === 1 ? [] : ["Person A"],
      assetId: ["left", "middle", "right"][index],
      ...(index === 0
        ? { baselineObservations: { bodies: [], faces: [] } }
        : {}),
      path,
    })),
    contextKind: "sequence",
    schemaVersion: "cimmich.local-ai-photo-set.v1",
    setId: "three-frame",
  };
  const first = await runPhotoLab({
    configInput,
    operationsInput: "full",
    outputRoot,
    providerImplementations,
    setInput,
  });
  assert.equal(first.result.state, "completed");
  assert.equal(first.result.context.candidates[0].state, "supported");
  assert.equal(first.result.summary.state, "proposed");
  assert.match(first.result.summary.text, /candidate for Person A/);
  assert.equal(first.result.assets[0].baselineComparison.faces.added.length, 1);
  assert.equal(
    first.result.assets[0].baselineComparison.bodies.added.length,
    1,
  );
  assert.equal(first.result.originalsUnchanged, true);
  const persisted = await readFile(first.resultPath, "utf8");
  assert.equal(persisted.includes(root), false);
  assert.equal(persisted.includes("appearanceFeature"), false);
  assert.equal(persisted.includes("artifacts/left-enhanced-x2.png"), true);

  const second = await runPhotoLab({
    configInput,
    operationsInput: "full",
    outputRoot,
    providerImplementations,
    setInput,
  });
  assert.equal(second.result.revision, 2);
  assert.equal(
    JSON.parse(await readFile(second.diffPath, "utf8")).previousRunId,
    first.result.runId,
  );
  assert.notEqual(first.resultPath, second.resultPath);

  const facesOnly = await runPhotoLab({
    configInput,
    operationsInput: "faces",
    outputRoot: join(root, "faces-only"),
    providerImplementations,
    setInput,
  });
  assert.deepEqual(facesOnly.result.executedOperations, ["faces"]);
  assert.deepEqual(Object.keys(facesOnly.result.assets[0].operations), [
    "faces",
  ]);

  const contextOnly = await runPhotoLab({
    configInput,
    operationsInput: "context",
    outputRoot: join(root, "context-only"),
    providerImplementations,
    setInput,
  });
  assert.deepEqual(contextOnly.result.executedOperations, [
    "bodies",
    "context",
  ]);
  assert.deepEqual(Object.keys(contextOnly.result.assets[0].operations), [
    "bodies",
  ]);

  const disagreementProviders = {
    ...providerImplementations,
    async runBodies() {
      return { bodies: [], operation: "bodies", state: "no_body" };
    },
    async runFaces() {
      return {
        faces: [
          {
            box: { h: 0.02, w: 0.02, x: 0.3, y: 0.1 },
            quality: {
              pixelHeight: 12,
              pixelWidth: 12,
              reviewReasons: ["LOW_CONFIDENCE", "TINY_FACE"],
            },
          },
        ],
        operation: "faces",
        state: "faces_detected",
      };
    },
    async runSceneText() {
      return {
        operation: "scene-text",
        proposal: {
          activities: [],
          objects: [],
          peopleCountEstimate: 0,
          qualityFlags: [],
          scene: "empty garden",
          summary: "No person is visible.",
          visibleText: [],
        },
        state: "proposed",
      };
    },
  };
  const disagreement = await runPhotoLab({
    configInput,
    operationsInput: "faces,bodies,scene-text",
    outputRoot: join(root, "disagreement"),
    providerImplementations: disagreementProviders,
    setInput: {
      assets: [
        {
          acceptedSubjects: [],
          assetId: "empty",
          path: paths[0],
        },
      ],
      contextKind: "none",
      schemaVersion: "cimmich.local-ai-photo-set.v1",
      setId: "disagreement",
    },
  });
  assert.deepEqual(disagreement.result.assets[0].crossModelChecks.reasonCodes, [
    "ALL_FACE_CANDIDATES_REQUIRE_REVIEW",
    "FACE_ONLY_WITH_NO_PERSON_SUPPORT",
  ]);
  assert.match(disagreement.result.summary.text, /Candidate review/);

  const rejectedOutput = join(root, "rejected-before-output");
  await assert.rejects(
    runPhotoLab({
      configInput,
      operationsInput: "faces",
      outputRoot: rejectedOutput,
      providerImplementations: {
        ...providerImplementations,
        async probeImage() {
          throw Object.assign(new Error("not an image"), {
            code: "LOCAL_AI_SOURCE_UNREADABLE",
          });
        },
      },
      setInput: {
        assets: [{ acceptedSubjects: [], assetId: "bad", path: paths[0] }],
        contextKind: "none",
        schemaVersion: "cimmich.local-ai-photo-set.v1",
        setId: "bad",
      },
    }),
    { code: "LOCAL_AI_SOURCE_UNREADABLE" },
  );
  assert.equal(await stat(rejectedOutput).catch(() => null), null);
});
