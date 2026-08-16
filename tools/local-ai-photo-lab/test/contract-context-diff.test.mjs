import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { evaluateBenchmarkCase, runBenchmark } from "../src/benchmark.mjs";
import { deriveBodyExecutionProfile } from "../src/body-profile.mjs";
import {
  normalizeOperations,
  validateConfig,
  validatePhotoSet,
} from "../src/contract.mjs";
import { inferContext } from "../src/context.mjs";
import { diffRunResults, iou } from "../src/diff.mjs";
import { runDoctor } from "../src/doctor.mjs";
import {
  runAppleVisionSceneTextBatch,
  runProcess,
  runSceneText,
} from "../src/providers.mjs";
import {
  activeProcessCount,
  terminateActiveProcesses,
  trackedSpawn,
} from "../src/processes.mjs";
import { buildSetSummary } from "../src/summary.mjs";

const config = (endpoint = "http://127.0.0.1:11434") => ({
  contextPolicy: {
    maximumTemporalGapSeconds: 600,
    minimumMargin: 0.05,
    minimumSimilarity: 0.72,
    requireBidirectionalAnchors: true,
  },
  limits: {
    enhanceProviderTimeoutMs: 2000,
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
      runtimePath: "/runtime",
    },
    faces: {
      detectorModelPath: "/f",
      device: "cpu",
      enabled: true,
      pythonPath: "/py",
      scoreThreshold: 0.2,
    },
    poses: {
      enabled: true,
      manifestPath: "/pose-manifest",
      modelPath: "/pose-model",
      providerScriptPath: "/pose-provider",
      pythonPath: "/py",
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
  assert.throws(() => validateConfig(config("http://127.0.0.1:11435")), {
    code: "LOCAL_AI_NETWORK_FORBIDDEN",
  });
  const apple = config();
  apple.providers.sceneText = {
    enabled: true,
    endpoint: "native://apple-vision",
    executablePath: "/provider",
    includeOcr: false,
    model: "Apple Vision",
    provider: "apple-vision",
  };
  assert.deepEqual(
    validateConfig(apple).providers.sceneText,
    apple.providers.sceneText,
  );
  assert.deepEqual(normalizeOperations("full"), [
    "faces",
    "bodies",
    "context",
    "scene-text",
    "enhance",
  ]);
  const vulkan = config();
  vulkan.providers.enhance.device = "vulkan";
  assert.equal(validateConfig(vulkan).providers.enhance.device, "vulkan");
  delete vulkan.providers.enhance.runtimePath;
  assert.throws(() => validateConfig(vulkan), /exact contract fields/);
});

test("body execution profiles make fallback device truth explicit and rebind the digest", () => {
  const source = {
    detector: { artifactDigest: "a".repeat(64) },
    detectorConfigDigest: "b".repeat(64),
    execution: { device: "gpu", network: "forbidden" },
    privacy: { externalUpload: "none" },
    schemaVersion: "cimmich.body-detector.v1",
  };
  const profile = deriveBodyExecutionProfile(source, "cpu");
  assert.equal(profile.execution.device, "cpu");
  assert.match(profile.detectorConfigDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(profile.detectorConfigDigest, source.detectorConfigDigest);
  assert.equal(source.execution.device, "gpu");
});

test("doctor returns a path-free limited receipt when every provider is disabled", async () => {
  const input = config();
  for (const provider of Object.values(input.providers))
    provider.enabled = false;
  const result = await runDoctor({ configInput: input });
  assert.equal(result.state, "limited");
  assert.deepEqual(result.summary, {
    failed: 0,
    passed: 0,
    skipped: 10,
    warnings: 0,
  });
  assert.equal(JSON.stringify(result).includes("/py"), false);
});

test("doctor rejects oversized loopback model inventory responses", async (context) => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(`{"padding":"${"x".repeat(1024 * 1024)}"}`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const input = config();
  for (const [name, provider] of Object.entries(input.providers))
    provider.enabled = name === "sceneText";
  const result = await runDoctor({
    configInput: input,
    sceneTextFetch: (_url, options) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/tags`, options),
  });
  assert.equal(result.state, "failed");
  assert.equal(
    result.checks.find(({ checkId }) => checkId === "scene-text-loopback")
      .errorCode,
    "LOCAL_AI_DOCTOR_OUTPUT_OVERSIZED",
  );
});

test("tracked local provider processes terminate cleanly on cancellation", async () => {
  const child = trackedSpawn(
    process.execPath,
    ["-e", "setInterval(() => undefined, 1000)"],
    { stdio: "ignore" },
  );
  assert.equal(activeProcessCount(), 1);
  assert.equal(terminateActiveProcesses(), 1);
  await once(child, "close");
  assert.equal(activeProcessCount(), 0);
});

test("provider subprocess output is bounded before JSON parsing", async () => {
  await assert.rejects(
    runProcess({
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
      command: process.execPath,
      maxOutputBytes: 1024,
      timeoutMs: 1000,
    }),
    { code: "LOCAL_AI_PROVIDER_OUTPUT_OVERSIZED" },
  );
});

test("provider subprocesses forward only structured progress lines", async () => {
  const originalWrite = process.stderr.write;
  let forwarded = "";
  process.stderr.write = (chunk) => {
    forwarded += String(chunk);
    return true;
  };
  try {
    await runProcess({
      args: [
        "-e",
        "process.stderr.write('private diagnostic\\nCIMMICH_LOCAL_AI_PROGRESS {\\\"schemaVersion\\\":\\\"cimmich.local-ai-progress.v1\\\"}\\n'); process.stdout.write('{}')",
      ],
      command: process.execPath,
      timeoutMs: 1000,
    });
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(
    forwarded,
    'CIMMICH_LOCAL_AI_PROGRESS {"schemaVersion":"cimmich.local-ai-progress.v1"}\n',
  );
});

test("timed-out provider subprocesses escalate and leave no tracked child", async () => {
  await assert.rejects(
    runProcess({
      args: [
        "-e",
        "process.on('SIGTERM',()=>{}); setInterval(() => undefined, 1000)",
      ],
      command: process.execPath,
      timeoutMs: 20,
    }),
    { code: "LOCAL_AI_PROVIDER_TIMEOUT" },
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(activeProcessCount(), 0);
});

test("benchmark evaluator scores bounded expectations and rejects fixture traversal", async () => {
  const evaluation = evaluateBenchmarkCase({
    expectations: {
      assets: {
        photo: {
          bodies: { min: 1, max: 1 },
          crossModelState: "clear",
          enhance: {
            height: 20,
            quality: { downsampleSsim: { min: 0.9, max: 1 } },
            width: 20,
          },
          faces: { min: 1, max: 1 },
          maxFaceReview: 0,
          peopleEstimate: { min: 1, max: 1 },
          visibleTextIncludes: ["HELLO"],
        },
      },
      maximumUnexpectedContextCandidates: 0,
    },
    result: {
      assets: [
        {
          assetId: "photo",
          crossModelChecks: { reasonCodes: [], state: "clear" },
          operations: {
            bodies: { bodies: [{}] },
            enhance: {
              artifact: { digest: "digest", path: "artifacts/preview.png" },
              height: 20,
              quality: { downsampleSsim: 0.99 },
              state: "derived",
              width: 20,
            },
            faces: { faces: [{ quality: { reviewReasons: [] } }] },
            sceneText: {
              proposal: {
                peopleCountEstimate: 1,
                visibleText: ["HELLO"],
              },
            },
          },
        },
      ],
      context: null,
      originalsUnchanged: true,
      state: "completed",
    },
  });
  assert.equal(evaluation.state, "passed");

  const root = await mkdtemp(join(tmpdir(), "local-ai-benchmark-"));
  const disabled = config();
  for (const provider of Object.values(disabled.providers))
    provider.enabled = false;
  await assert.rejects(
    runBenchmark({
      configInput: disabled,
      fixtureRoot: join(root, "fixtures"),
      manifestInput: {
        benchmarkId: "escape",
        cases: [
          {
            assets: [
              {
                acceptedSubjects: [],
                assetId: "escape",
                fixturePath: "../outside.png",
              },
            ],
            caseId: "escape",
            contextKind: "none",
            expectations: { assets: {} },
            operations: "faces",
          },
        ],
        schemaVersion: "cimmich.local-ai-photo-lab-benchmark.v1",
      },
      outputRoot: join(root, "output"),
    }),
    { code: "LOCAL_AI_BENCHMARK_FIXTURE_FORBIDDEN" },
  );
  assert.equal(await stat(join(root, "output")).catch(() => null), null);

  const fixtures = join(root, "fixtures");
  const outside = join(root, "outside.png");
  await mkdir(fixtures);
  await writeFile(outside, "not needed because confinement runs first");
  await symlink(outside, join(fixtures, "linked.png"));
  await assert.rejects(
    runBenchmark({
      configInput: disabled,
      fixtureRoot: fixtures,
      manifestInput: {
        benchmarkId: "symlink-escape",
        cases: [
          {
            assets: [
              {
                acceptedSubjects: [],
                assetId: "escape",
                fixturePath: "linked.png",
              },
            ],
            caseId: "escape",
            contextKind: "none",
            expectations: { assets: {} },
            operations: "faces",
          },
        ],
        schemaVersion: "cimmich.local-ai-photo-lab-benchmark.v1",
      },
      outputRoot: join(root, "symlink-output"),
    }),
    { code: "LOCAL_AI_BENCHMARK_FIXTURE_FORBIDDEN" },
  );
  assert.equal(
    await stat(join(root, "symlink-output")).catch(() => null),
    null,
  );
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
                subject: "Person A",
              },
            ],
          },
          captureTime: "2026-08-11T00:00:00Z",
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
  assert.equal(
    value.assets[0].baselineObservations.faces[0].subject,
    "Person A",
  );
  assert.equal(value.assets[0].captureTime, "2026-08-11T00:00:00.000Z");
  const oversized = join(root, "oversized.bin");
  await writeFile(oversized, Buffer.alloc(1001));
  await assert.rejects(
    validatePhotoSet(
      {
        assets: [
          { acceptedSubjects: [], assetId: "oversized", path: oversized },
        ],
        contextKind: "none",
        schemaVersion: "cimmich.local-ai-photo-set.v1",
        setId: "oversized",
      },
      validateConfig(config()).limits,
    ),
    { code: "LOCAL_AI_INPUT_INVALID" },
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
      maximumTemporalGapSeconds: 600,
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
      maximumTemporalGapSeconds: 600,
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

test("context uses champion face geometry and close time for a head-occluded body without overriding identity", () => {
  const championFace = (subject, x) => ({
    box: { h: 0.1, w: 0.08, x, y: 0.22 },
    observationId: `champion-${subject}`,
    subject,
  });
  const anchor = (assetId, captureTime, reversed = false) => ({
    acceptedSubjects: ["Person A", "Person B"],
    assetId,
    baselineObservations: {
      bodies: [],
      faces: [championFace("Person A", 0.18), championFace("Person B", 0.68)],
    },
    bodyAssignments: {},
    captureTime,
    sourceContentDigest: assetId,
    operations: {
      bodies: {
        bodies: [
          body(`${assetId}-a`, reversed ? [0, 1] : [1, 0], 0.1),
          body(`${assetId}-b`, reversed ? [1, 0] : [0, 1], 0.6),
        ],
      },
    },
  });
  const assets = [
    anchor("left", "2026-08-11T00:00:00Z"),
    {
      acceptedSubjects: [],
      assetId: "middle",
      baselineObservations: { bodies: [], faces: [] },
      bodyAssignments: {},
      captureTime: "2026-08-11T00:00:05Z",
      sourceContentDigest: "middle",
      operations: {
        bodies: { bodies: [body("middle-body", [0.5, 0.5], 0.35)] },
      },
    },
    anchor("right", "2026-08-11T00:00:10Z", true),
  ];
  // Limit the two-sided accepted evidence to Person A. Person B remains useful
  // for proving that geometry, rather than array position, chooses the anchors.
  assets[2].acceptedSubjects = ["Person A"];
  assets[2].baselineObservations.faces = [championFace("Person A", 0.18)];
  const result = inferContext({
    assets,
    contextKind: "rapid_burst",
    policy: {
      maximumTemporalGapSeconds: 60,
      minimumMargin: 0.05,
      minimumSimilarity: 0.99,
      requireBidirectionalAnchors: true,
    },
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].state, "possible");
  assert.equal(result.candidates[0].subject, "Person A");
  assert.equal(
    result.candidates[0].evidence.leftAnchorAssociation,
    "champion_face_geometry",
  );
  assert.deepEqual(result.candidates[0].evidence.reasonCodes, [
    "BIDIRECTIONAL_ACCEPTED_SUPPORT",
    "TEMPORAL_PROXIMITY_SUPPORTED",
    "SINGLE_UNASSIGNED_BODY",
    "BODY_APPEARANCE_INSUFFICIENT",
  ]);

  assets[1].captureTime = "2026-08-11T01:00:00Z";
  const distant = inferContext({
    assets,
    contextKind: "sequence",
    policy: {
      maximumTemporalGapSeconds: 60,
      minimumMargin: 0.05,
      minimumSimilarity: 0.99,
      requireBidirectionalAnchors: true,
    },
  });
  assert.equal(distant.candidates[0].state, "abstained");
});

test("context permits at most one supported body per subject and abstains on body ties", () => {
  const makeAssets = (features) => [
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
      operations: {
        bodies: {
          bodies: features.map((feature, index) =>
            body(`middle-${index}`, feature),
          ),
        },
      },
    },
    {
      acceptedSubjects: ["Person A"],
      assetId: "right",
      bodyAssignments: {},
      sourceContentDigest: "right",
      operations: { bodies: { bodies: [body("right", [1, 0])] } },
    },
  ];
  const policy = {
    maximumTemporalGapSeconds: 600,
    minimumMargin: 0.05,
    minimumSimilarity: 0.72,
    requireBidirectionalAnchors: true,
  };
  const separated = inferContext({
    assets: makeAssets([
      [1, 0],
      [0.7, 0.7],
    ]),
    contextKind: "sequence",
    policy,
  });
  assert.deepEqual(
    separated.candidates.map(({ state }) => state),
    ["supported", "abstained"],
  );
  assert.equal(
    separated.candidates[0].evidence.reasonCodes.includes(
      "BODY_COMPETITOR_SEPARATED",
    ),
    true,
  );

  const tied = inferContext({
    assets: makeAssets([
      [1, 0],
      [0.999, 0.001],
    ]),
    contextKind: "sequence",
    policy,
  });
  assert.equal(
    tied.candidates.every(({ state }) => state === "abstained"),
    true,
  );
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

test("Enhanced Scene/Text replaces spatial identity aliases with stable person tokens", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-scene-identity-"));
  const imagePath = join(root, "image.bin");
  await writeFile(imagePath, "image");
  let prompt = "";
  const proposal = {
    activities: ["riding"],
    objects: ["atv"],
    peopleCountEstimate: 2,
    qualityFlags: [],
    scene: "outdoors",
    summary: "IDENTITY_1 and another person ride an ATV.",
    visibleText: [],
  };
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/tags") {
      response.end(
        JSON.stringify({
          models: [{ digest: "model-digest", name: "vision", size: 1 }],
        }),
      );
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      prompt = JSON.parse(Buffer.concat(chunks).toString()).messages[0].content;
      response.end(
        JSON.stringify({ message: { content: JSON.stringify(proposal) } }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const result = await runSceneText({
    asset: {
      baselineObservations: {
        bodies: [],
        faces: [
          {
            box: { h: 0.2, w: 0.1, x: 0.4, y: 0.1 },
            personId: "person_ted",
            subject: "Ted",
          },
        ],
      },
      path: imagePath,
    },
    config: {
      enabled: true,
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: "vision",
      summaryTier: "enhanced",
      timeoutMs: 1000,
    },
  });
  assert.match(prompt, /IDENTITY_1: owner-confirmed face box/);
  assert.doesNotMatch(prompt, /Ted/);
  assert.equal(
    result.proposal.summary,
    "{{person:person_ted}} and another person ride an ATV.",
  );
});

test("Apple Vision batch composes conservative Smart facts without a network model", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-apple-vision-"));
  const imagePath = join(root, "photo.jpg");
  const executablePath = join(root, "provider");
  await writeFile(imagePath, "image");
  const raw = {
    animals: [],
    classifications: [
      { confidence: 0.95, identifier: "people" },
      { confidence: 0.9, identifier: "outdoor" },
      { confidence: 0.82, identifier: "vehicle" },
      { confidence: 0.79, identifier: "atv" },
      { confidence: 0.71, identifier: "helmet" },
      { confidence: 0.7, identifier: "scooter" },
    ],
    elapsedSeconds: 0.05,
    errors: [],
    faceCount: 1,
    humanCount: 1,
    imagePath,
    ocrPerformed: false,
    schemaVersion: "cimmich.apple-vision-summary.raw.v1",
    visibleText: [],
  };
  await writeFile(
    executablePath,
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ results: [raw], runtime: { adapterVersion: "test-v1", operatingSystem: "macOS test" }, schemaVersion: raw.schemaVersion })}'\n`,
  );
  await chmod(executablePath, 0o500);
  const [result] = await runAppleVisionSceneTextBatch({
    assets: [
      {
        acceptedSubjects: ["Example Person"],
        assetId: "asset-1",
        path: imagePath,
        sourceContentDigest: "source-digest",
      },
    ],
    config: {
      enabled: true,
      executablePath,
      includeOcr: false,
      timeoutMs: 1000,
    },
  });
  assert.equal(result.state, "proposed");
  assert.equal(result.providerId, "apple-vision-native-summary");
  assert.equal(result.network, "none");
  assert.equal(result.proposal.peopleCountEstimate, 1);
  assert.deepEqual(result.proposal.objects, ["atv", "helmet"]);
  assert.match(result.proposal.summary, /atv, helmet/);
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
    maximumTemporalGapSeconds: 600,
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
