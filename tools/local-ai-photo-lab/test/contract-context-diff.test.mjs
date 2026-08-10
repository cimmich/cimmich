import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import {
  normalizeOperations,
  validateConfig,
  validatePhotoSet,
} from "../src/contract.mjs";
import { inferContext } from "../src/context.mjs";
import { diffRunResults, iou } from "../src/diff.mjs";
import { runSceneText } from "../src/providers.mjs";
import { buildSetSummary } from "../src/summary.mjs";

const config = (endpoint = "http://127.0.0.1:11434") => ({
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
    sceneText: { enabled: true, endpoint, model: "vision" },
  },
  schemaVersion: "cimmich.local-ai-photo-lab-config.v1",
});

const body = (bodyId, appearanceFeature, x = 0.1) => ({
  appearanceFeature,
  bodyId,
  box: { h: 0.6, w: 0.3, x, y: 0.2 },
});

test("config accepts loopback, rejects remote endpoints, and expands full", () => {
  assert.equal(
    validateConfig(config()).providers.sceneText.endpoint,
    "http://127.0.0.1:11434",
  );
  assert.throws(() => validateConfig(config("https://example.com")), {
    code: "LOCAL_AI_NETWORK_FORBIDDEN",
  });
  assert.deepEqual(normalizeOperations("full"), [
    "faces",
    "bodies",
    "context",
    "scene-text",
    "enhance",
  ]);
});

test("photo-set contract binds ordered immutable source digests", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-contract-"));
  const first = join(root, "one.bin");
  const second = join(root, "two.bin");
  await writeFile(first, "one");
  await writeFile(second, "two");
  const value = await validatePhotoSet(
    {
      assets: [
        {
          acceptedSubjects: ["Person A"],
          assetId: "one",
          baselineObservations: {
            bodies: [],
            faces: [
              {
                box: { h: 0.2, w: 0.2, x: 0.3, y: 0.1 },
                observationId: "existing-face",
              },
            ],
          },
          path: first,
        },
        { acceptedSubjects: [], assetId: "two", path: second },
      ],
      contextKind: "sequence",
      schemaVersion: "cimmich.local-ai-photo-set.v1",
      setId: "set",
    },
    validateConfig(config()).limits,
  );
  assert.equal(value.assets.length, 2);
  assert.notEqual(
    value.assets[0].sourceContentDigest,
    value.assets[1].sourceContentDigest,
  );
  assert.equal(value.assets[0].path, first);
  assert.equal(
    value.assets[0].baselineObservations.faces[0].observationId,
    "existing-face",
  );
});

test("context supports an unassigned middle body only from independent two-sided anchors", () => {
  const assets = [
    {
      acceptedSubjects: ["Person A"],
      assetId: "left",
      bodyAssignments: {},
      sourceContentDigest: "left",
      operations: { bodies: { bodies: [body("left-body", [1, 0])] } },
    },
    {
      acceptedSubjects: [],
      assetId: "middle",
      bodyAssignments: {},
      sourceContentDigest: "middle",
      operations: { bodies: { bodies: [body("middle-body", [0.999, 0.001])] } },
    },
    {
      acceptedSubjects: ["Person A"],
      assetId: "right",
      bodyAssignments: {},
      sourceContentDigest: "right",
      operations: { bodies: { bodies: [body("right-body", [1, 0])] } },
    },
  ];
  const result = inferContext({
    assets,
    contextKind: "sequence",
    policy: {
      minimumMargin: 0.05,
      minimumSimilarity: 0.72,
      requireBidirectionalAnchors: true,
    },
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].state, "supported");
  assert.equal(result.candidates[0].subject, "Person A");

  assets[1].sourceContentDigest = "left";
  const duplicate = inferContext({
    assets,
    contextKind: "sequence",
    policy: {
      minimumMargin: 0.05,
      minimumSimilarity: 0.72,
      requireBidirectionalAnchors: true,
    },
  });
  assert.equal(duplicate.candidates[0].state, "abstained");
  assert.deepEqual(duplicate.candidates[0].evidence.reasonCodes, [
    "DUPLICATE_SOURCE_EVIDENCE",
  ]);
});

test("rerun diff matches observations by geometry", () => {
  assert.equal(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }), 1);
  const prior = {
    runId: "one",
    assets: [
      {
        assetId: "a",
        sourceContentDigest: "x",
        operations: { faces: { faces: [body("f1", [], 0.1)] } },
      },
    ],
  };
  const current = {
    assets: [
      {
        assetId: "a",
        sourceContentDigest: "x",
        operations: { faces: { faces: [body("f2", [], 0.1)] } },
      },
    ],
  };
  const value = diffRunResults(prior, current);
  assert.equal(value.assets[0].faces.matched, 1);
  assert.equal(value.assets[0].faces.added.length, 0);
});

test("Scene/Text accepts validated structured output from a local model thinking field", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-scene-"));
  const imagePath = join(root, "image.bin");
  await writeFile(imagePath, "image");
  const proposal = {
    activities: ["standing"],
    objects: ["mug"],
    peopleCountEstimate: 1,
    qualityFlags: [],
    scene: "kitchen",
    summary: "A person holds a mug.",
    visibleText: [],
  };
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/tags")
      response.end(
        JSON.stringify({
          models: [{ digest: "model-digest", name: "vision", size: 1 }],
        }),
      );
    else
      response.end(
        JSON.stringify({
          message: { content: "", thinking: JSON.stringify(proposal) },
        }),
      );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const result = await runSceneText({
    asset: { path: imagePath },
    config: {
      enabled: true,
      endpoint: `http://127.0.0.1:${port}`,
      model: "vision",
      timeoutMs: 1000,
    },
  });
  assert.equal(result.state, "proposed");
  assert.deepEqual(result.proposal, proposal);
});

test("set summary stays compact and preserves review/candidate language", () => {
  const assets = Array.from({ length: 6 }, (_, index) => ({
    assetId: `asset-${index + 1}`,
    crossModelChecks: {
      reasonCodes: index === 0 ? ["REVIEW"] : [],
      state: index === 0 ? "review" : "clear",
    },
    operations: {
      sceneText: {
        proposal: {
          scene: `A deliberately long scene description for photo ${index + 1} with several visible details and objects in view`,
          summary: `Long literal summary ${index + 1}`,
        },
        state: "proposed",
      },
    },
  }));
  const value = buildSetSummary({
    assets,
    context: {
      candidates: [
        {
          assetId: "asset-2",
          candidateId: "candidate-1",
          kind: "body_candidate",
          state: "supported",
          subject: "Person A",
        },
      ],
    },
    contextKind: "sequence",
  });
  assert.ok(value.text.length < 600);
  assert.match(value.text, /plus 2 additional photos/);
  assert.match(value.text, /supported candidate for Person A/);
  assert.match(value.text, /review is needed for asset-1/);
});

test("context emits Presence when the middle body is unavailable and abstains on an appearance tie", () => {
  const policy = {
    minimumMargin: 0.05,
    minimumSimilarity: 0.72,
    requireBidirectionalAnchors: true,
  };
  const presenceAssets = [
    {
      acceptedSubjects: ["Person A"],
      assetId: "left",
      bodyAssignments: {},
      sourceContentDigest: "left",
      operations: { bodies: { bodies: [body("left", [1, 0])] } },
    },
    {
      acceptedSubjects: [],
      assetId: "middle",
      bodyAssignments: {},
      sourceContentDigest: "middle",
      operations: { bodies: { bodies: [] } },
    },
    {
      acceptedSubjects: ["Person A"],
      assetId: "right",
      bodyAssignments: {},
      sourceContentDigest: "right",
      operations: { bodies: { bodies: [body("right", [1, 0])] } },
    },
  ];
  const presence = inferContext({
    assets: presenceAssets,
    contextKind: "sequence",
    policy,
  });
  assert.equal(presence.candidates[0].kind, "presence_candidate");
  assert.equal(presence.candidates[0].state, "possible");

  const tiedAssets = [
    {
      acceptedSubjects: ["Person A", "Person B"],
      assetId: "left",
      bodyAssignments: { "Person A": 0, "Person B": 1 },
      sourceContentDigest: "left",
      operations: {
        bodies: {
          bodies: [body("left-a", [1, 0]), body("left-b", [1, 0], 0.6)],
        },
      },
    },
    {
      acceptedSubjects: [],
      assetId: "middle",
      bodyAssignments: {},
      sourceContentDigest: "middle",
      operations: { bodies: { bodies: [body("middle", [1, 0])] } },
    },
    {
      acceptedSubjects: ["Person A", "Person B"],
      assetId: "right",
      bodyAssignments: { "Person A": 0, "Person B": 1 },
      sourceContentDigest: "right",
      operations: {
        bodies: {
          bodies: [body("right-a", [1, 0]), body("right-b", [1, 0], 0.6)],
        },
      },
    },
  ];
  const tied = inferContext({
    assets: tiedAssets,
    contextKind: "sequence",
    policy,
  });
  assert.equal(tied.candidates[0].state, "abstained");
  assert.equal(tied.candidates[0].evidence.margin, 0);
});
