import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bodyDetectionContractDigest,
  bodyDetectionResultSchemaVersion,
  bodyDetectionValidationReceiptSchemaVersion,
  bodyDetectorSchemaVersion,
  createBodyDetectionValidationReceipt,
  deriveBodyDetectorConfigDigest,
  projectValidatedBodyResultForRepository,
  projectValidatedBodyResultToLinker,
  validateBodyDetectionResult,
  validateBodyDetectorManifest,
} from "../src/body-detector-contract.mjs";

const digest = (character) => character.repeat(64);
const serviceRoot = fileURLToPath(new URL("../", import.meta.url));

const manifest = (overrides = {}) => {
  const value = {
    detector: {
      artifactDigest: digest("a"),
      modelId: "synthetic-body-detector",
      modelVersionId: "v1",
      scoreThreshold: 0.5,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: {
      code: "declared",
      model: "unknown",
      trainingData: "unknown",
    },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: {
      externalUpload: "none",
      sourceMedia: "local-read-only",
    },
    provider: {
      providerId: "synthetic-provider",
      versionId: "v1",
    },
    resources: {
      maxMemoryMiB: 1024,
      maxRuntimeMs: 30_000,
    },
    schemaVersion: bodyDetectorSchemaVersion,
    ...overrides,
  };
  if (!Object.hasOwn(value, "detectorConfigDigest")) {
    value.detectorConfigDigest = deriveBodyDetectorConfigDigest(value);
  }
  return value;
};

const observation = (overrides = {}) => ({
  box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
  confidence: 0.9,
  headBox: { h: 0.16, w: 0.14, x: 0.22, y: 0.12 },
  quality: { occlusion: 0.1, truncation: 0, visibility: 0.95 },
  ...overrides,
});

const result = (overrides = {}) => ({
  assetToken: digest("b"),
  bodies: [observation()],
  detectorConfigDigest: manifest().detectorConfigDigest,
  inputRevision: digest("c"),
  schemaVersion: bodyDetectionResultSchemaVersion,
  sourceContentDigest: digest("d"),
  state: "bodies_detected",
  ...overrides,
});

test("body detector manifest is exact, closed and digest-bound", () => {
  const validated = validateBodyDetectorManifest(manifest());
  assert.equal(validated.execution.network, "forbidden");
  assert.equal(validated.privacy.externalUpload, "none");
  assert.equal(validated.privacy.sourceMedia, "local-read-only");
  assert.match(validated.detectorConfigDigest, /^[0-9a-f]{64}$/);
  assert.match(bodyDetectionContractDigest, /^[0-9a-f]{64}$/);
  assert.throws(
    () =>
      validateBodyDetectorManifest(
        manifest({ detectorConfigDigest: digest("f") }),
      ),
    /config digest does not match/,
  );
});

test("repository projection requires the exact validation envelope", () => {
  const validated = validateBodyDetectionResult(result(), manifest());
  const projected = projectValidatedBodyResultForRepository(validated);
  assert.equal(projected.resultDigest, validated.resultDigest);
  assert.equal(projected.bodies.length, 1);
  assert.match(projected.bodies[0].qualityDigest, /^[0-9a-f]{64}$/);
  assert.throws(() =>
    projectValidatedBodyResultForRepository({ ...validated }),
  );
});

test("manifest and result reject free-form, path, credential and identity fields", () => {
  const baseManifest = manifest();
  const baseResult = result();
  const adversarial = [
    {
      manifest: { ...baseManifest, downloadUrl: "https://private.invalid" },
      result: baseResult,
    },
    {
      manifest: {
        ...baseManifest,
        provider: { ...baseManifest.provider, credentials: "secret" },
      },
      result: baseResult,
    },
    {
      manifest: {
        ...baseManifest,
        detector: { ...baseManifest.detector, modelId: "../../private" },
      },
      result: baseResult,
    },
    {
      manifest: {
        ...baseManifest,
        licensing: { ...baseManifest.licensing, trainingData: "free form" },
      },
      result: baseResult,
    },
    {
      manifest: baseManifest,
      result: { ...baseResult, assetToken: "raw-asset-name" },
    },
    {
      manifest: baseManifest,
      result: { ...baseResult, filename: "private.jpg" },
    },
    {
      manifest: baseManifest,
      result: {
        ...baseResult,
        bodies: [{ ...observation(), personId: "person-name" }],
      },
    },
    {
      manifest: baseManifest,
      result: {
        ...baseResult,
        bodies: [
          { ...observation(), quality: { note: "private", visibility: 1 } },
        ],
      },
    },
  ];
  for (const packet of adversarial) {
    assert.throws(
      () => validateBodyDetectionResult(packet.result, packet.manifest),
      (error) => error.code === "BODY_DETECTOR_INPUT_INVALID",
    );
  }
});

test("body observations are stable, anonymous and order-independent", () => {
  const detector = manifest();
  const bodies = [
    observation(),
    observation({
      box: { h: 0.7, w: 0.3, x: 0.6, y: 0.2 },
      confidence: 0.8,
      headBox: null,
      quality: { visibility: 0.7 },
    }),
  ];
  const first = validateBodyDetectionResult(result({ bodies }), detector);
  const second = validateBodyDetectionResult(
    result({ bodies: [...bodies].reverse() }),
    detector,
  );
  assert.equal(first.resultDigest, second.resultDigest);
  assert.deepEqual(
    first.result.bodies.map((body) => body.bodyId),
    second.result.bodies.map((body) => body.bodyId),
  );
  assert.equal(
    first.result.bodies.every((body) =>
      /^body_[0-9a-f]{40}$/.test(body.bodyId),
    ),
    true,
  );
});

test("state/count consistency and duplicate observations fail closed", () => {
  const detector = manifest();
  assert.equal(
    validateBodyDetectionResult(
      result({ bodies: [], state: "no_body" }),
      detector,
    ).result.bodies.length,
    0,
  );
  assert.throws(
    () =>
      validateBodyDetectionResult(
        result({ bodies: [observation()], state: "no_body" }),
        detector,
      ),
    /no_body results cannot contain/,
  );
  assert.throws(
    () =>
      validateBodyDetectionResult(
        result({ bodies: [], state: "bodies_detected" }),
        detector,
      ),
    /require observations/,
  );
  assert.throws(
    () =>
      validateBodyDetectionResult(
        result({ bodies: [observation(), observation()] }),
        detector,
      ),
    /duplicate observations/,
  );
  assert.throws(
    () =>
      validateBodyDetectionResult(
        result({ bodies: Array.from({ length: 1001 }, observation) }),
        detector,
      ),
    /exceeds 1000 observations/,
  );
  assert.throws(
    () =>
      validateBodyDetectionResult(
        result({ detectorConfigDigest: "e".repeat(64) }),
        detector,
      ),
    /another detector configuration/,
  );
  assert.throws(
    () =>
      validateBodyDetectionResult(
        result({ inputRevision: "revision" }),
        detector,
      ),
    /inputRevision must be a lowercase SHA-256 digest/,
  );
});

test("box, head relationship, confidence and quality bounds are enforced", () => {
  const detector = manifest();
  const invalidBodies = [
    observation({ box: { h: 0.2, w: 0.2, x: 0.9, y: 0.1 } }),
    observation({ confidence: Number.NaN }),
    observation({ quality: { visibility: 1.1 } }),
    observation({
      headBox: { h: 0.7, w: 0.7, x: 0.1, y: 0.1 },
    }),
    observation({
      headBox: { h: 0.1, w: 0.1, x: 0.8, y: 0.1 },
    }),
  ];
  for (const body of invalidBodies) {
    assert.throws(
      () => validateBodyDetectionResult(result({ bodies: [body] }), detector),
      (error) => error.code === "BODY_DETECTOR_INPUT_INVALID",
    );
  }
});

test("linker projection requires validated input and carries geometry only", () => {
  const detector = manifest();
  const raw = result();
  assert.throws(
    () =>
      projectValidatedBodyResultToLinker({
        result: raw,
        resultDigest: digest("e"),
      }),
    /requires a validated body result/,
  );
  const validation = validateBodyDetectionResult(raw, detector);
  const projection = projectValidatedBodyResultToLinker(validation);
  assert.deepEqual(Object.keys(projection), ["assetId", "bodies"]);
  assert.deepEqual(Object.keys(projection.bodies[0]).sort(), [
    "bodyId",
    "boxH",
    "boxW",
    "boxX",
    "boxY",
    "headBox",
  ]);
  assert.doesNotMatch(
    JSON.stringify(projection),
    /person|identity|claim|face/i,
  );
});

test("validation receipt is minimized and contains no library-derived tokens", () => {
  const detector = manifest();
  const validation = validateBodyDetectionResult(result(), detector);
  const receipt = createBodyDetectionValidationReceipt(validation);
  assert.equal(
    receipt.schemaVersion,
    bodyDetectionValidationReceiptSchemaVersion,
  );
  assert.equal(receipt.observationCount, 1);
  assert.equal(receipt.state, "bodies_detected");
  assert.equal(receipt.authority.activation, "none");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.boundary.providerExecution, "none");
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(validation.result.assetToken), false);
  assert.equal(
    serialized.includes(validation.result.sourceContentDigest),
    false,
  );
  assert.equal(serialized.includes(validation.result.bodies[0].bodyId), false);
});

test("copied or substituted validation envelopes cannot emit or project", () => {
  const validation = validateBodyDetectionResult(result(), manifest());
  const copied = Object.freeze({
    manifest: validation.manifest,
    result: validation.result,
    resultDigest: validation.resultDigest,
  });
  const substitutedArtifact = Object.freeze({
    ...copied,
    manifest: Object.freeze({
      ...validation.manifest,
      detector: Object.freeze({
        ...validation.manifest.detector,
        artifactDigest: "f".repeat(64),
      }),
    }),
  });
  const substitutedConfig = Object.freeze({
    ...copied,
    manifest: Object.freeze({
      ...validation.manifest,
      detectorConfigDigest: "e".repeat(64),
    }),
  });
  for (const forged of [copied, substitutedArtifact, substitutedConfig]) {
    let receipt;
    assert.throws(
      () => {
        receipt = createBodyDetectionValidationReceipt(forged);
      },
      (error) => error.code === "BODY_DETECTOR_INPUT_INVALID",
    );
    assert.equal(receipt, undefined);
    assert.throws(
      () => projectValidatedBodyResultToLinker(forged),
      (error) => error.code === "BODY_DETECTOR_INPUT_INVALID",
    );
  }
});

test("CLI is deterministic, bounded and never echoes caller content", () => {
  const packet = { manifest: manifest(), result: result() };
  const run = (input) =>
    spawnSync(process.execPath, ["bin/validate-body-detector.mjs"], {
      cwd: serviceRoot,
      encoding: "utf8",
      input,
      maxBuffer: 4 * 1024 * 1024,
    });
  const first = run(JSON.stringify(packet));
  const second = run(JSON.stringify(packet));
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  const receipt = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(receipt).sort(), [
    "authority",
    "boundary",
    "contractDigest",
    "detectorArtifactDigest",
    "detectorConfigDigest",
    "observationCount",
    "receiptDigest",
    "resultDigest",
    "schemaVersion",
    "state",
  ]);
  assert.equal(first.stdout.includes(packet.result.assetToken), false);
  assert.equal(first.stdout.includes(packet.result.sourceContentDigest), false);

  const sentinel = "../../private/person-name.jpg?credential=secret";
  const invalid = run(
    JSON.stringify({
      ...packet,
      manifest: {
        ...packet.manifest,
        provider: { providerId: sentinel, versionId: "v1" },
      },
    }),
  );
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.includes(sentinel), false);
  assert.deepEqual(JSON.parse(invalid.stderr), {
    error: { code: "BODY_DETECTOR_INPUT_INVALID" },
  });

  const malformed = run(`{"private":"${sentinel}`);
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stderr.includes(sentinel), false);
  const tooLarge = run("x".repeat(1024 * 1024 + 1));
  assert.equal(tooLarge.status, 1);
  assert.deepEqual(JSON.parse(tooLarge.stderr), {
    error: { code: "BODY_DETECTOR_INPUT_TOO_LARGE" },
  });
});
