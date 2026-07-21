import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
} from "../src/body-detector-contract.mjs";
import {
  bodyProviderConformanceContractDigest,
  bodyProviderConformanceEvaluationSchemaVersion,
  bodyProviderConformanceReceiptSchemaVersion,
  createBodyProviderConformanceReceipt,
  projectReplayConsistentBodyProviderResult,
  validateBodyProviderConformance,
} from "../src/body-provider-conformance.mjs";
import { projectValidatedBodyResultForRepository } from "../src/body-detector-contract.mjs";

const digest = (character) => character.repeat(64);
const serviceRoot = fileURLToPath(new URL("../", import.meta.url));

const manifest = () => {
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
  };
  return {
    ...value,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(value),
  };
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

const packet = (overrides = {}) => ({
  first: { result: result(), runId: "run-a" },
  manifest: manifest(),
  schemaVersion: bodyProviderConformanceEvaluationSchemaVersion,
  second: { result: result(), runId: "run-b" },
  ...overrides,
});

test("two exact canonical results produce a minimized replay-consistent receipt", () => {
  const validation = validateBodyProviderConformance(packet());
  const receipt = createBodyProviderConformanceReceipt(validation);
  assert.equal(
    receipt.schemaVersion,
    bodyProviderConformanceReceiptSchemaVersion,
  );
  assert.equal(receipt.decision.status, "replay_consistent");
  assert.deepEqual(receipt.decision.reasons, []);
  assert.equal(receipt.replay.evidence, "consistent");
  assert.equal(receipt.replay.providerExecutionProof, "none");
  assert.equal(receipt.authority.activation, "none");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.boundary.providerExecution, "none");
  assert.equal(
    receipt.binding.contractDigest,
    bodyProviderConformanceContractDigest,
  );
  assert.equal(
    receipt.binding.resultDigests[0],
    receipt.binding.resultDigests[1],
  );

  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(result().assetToken), false);
  assert.equal(serialized.includes(result().sourceContentDigest), false);
  assert.equal(serialized.includes("body_"), false);
  assert.equal(serialized.includes("run-a"), false);
  assert.equal(serialized.includes("run-b"), false);
});

test("well-formed canonical result drift is reported without authority", () => {
  const input = packet({
    second: {
      result: result({ bodies: [observation({ confidence: 0.88 })] }),
      runId: "run-b",
    },
  });
  const receipt = createBodyProviderConformanceReceipt(
    validateBodyProviderConformance(input),
  );
  assert.equal(receipt.decision.status, "replay_drift");
  assert.deepEqual(receipt.decision.reasons, ["RESULT_REPLAY_DRIFT"]);
  assert.equal(receipt.replay.evidence, "drift");
  assert.notEqual(
    receipt.binding.resultDigests[0],
    receipt.binding.resultDigests[1],
  );
  assert.equal(receipt.authority.recommendation, "none");
  assert.throws(
    () =>
      projectReplayConsistentBodyProviderResult(
        validateBodyProviderConformance(input),
      ),
    (error) => error.code === "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID",
  );
});

test("only an exact replay-consistent envelope projects its validated result", () => {
  const envelope = validateBodyProviderConformance(packet());
  const validation = projectReplayConsistentBodyProviderResult(envelope);
  assert.equal(
    projectValidatedBodyResultForRepository(validation).resultDigest,
    envelope.runs[0].resultDigest,
  );
  assert.throws(
    () =>
      projectReplayConsistentBodyProviderResult(Object.freeze({ ...envelope })),
    (error) => error.code === "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID",
  );
});

test("run order and observation order do not change the receipt", () => {
  const bodies = [
    observation(),
    observation({
      box: { h: 0.6, w: 0.3, x: 0.6, y: 0.2 },
      confidence: 0.8,
      headBox: null,
      quality: { visibility: 0.8 },
    }),
  ];
  const first = packet({
    first: { result: result({ bodies }), runId: "run-a" },
    second: {
      result: result({ bodies: [...bodies].reverse() }),
      runId: "run-b",
    },
  });
  const reversed = packet({
    first: {
      result: result({ bodies: [...bodies].reverse() }),
      runId: "run-b",
    },
    second: { result: result({ bodies }), runId: "run-a" },
  });
  assert.deepEqual(
    createBodyProviderConformanceReceipt(
      validateBodyProviderConformance(first),
    ),
    createBodyProviderConformanceReceipt(
      validateBodyProviderConformance(reversed),
    ),
  );
});

test("no-body replay is valid but mixed state remains explicit drift", () => {
  const noBody = result({ bodies: [], state: "no_body" });
  const consistent = createBodyProviderConformanceReceipt(
    validateBodyProviderConformance(
      packet({
        first: { result: noBody, runId: "run-a" },
        second: { result: noBody, runId: "run-b" },
      }),
    ),
  );
  assert.equal(consistent.decision.status, "replay_consistent");
  assert.equal(consistent.runs[0].observationCount, 0);
  assert.equal(consistent.runs[0].state, "no_body");

  const drift = createBodyProviderConformanceReceipt(
    validateBodyProviderConformance(
      packet({
        first: { result: noBody, runId: "run-a" },
      }),
    ),
  );
  assert.equal(drift.decision.status, "replay_drift");
});

test("duplicate run IDs and substituted input bindings fail before receipt", () => {
  const adversarial = [
    packet({ second: { result: result(), runId: "run-a" } }),
    packet({
      second: {
        result: result({ assetToken: digest("e") }),
        runId: "run-b",
      },
    }),
    packet({
      second: {
        result: result({ inputRevision: digest("e") }),
        runId: "run-b",
      },
    }),
    packet({
      second: {
        result: result({ sourceContentDigest: digest("e") }),
        runId: "run-b",
      },
    }),
  ];
  for (const value of adversarial) {
    let receipt;
    assert.throws(
      () => {
        receipt = createBodyProviderConformanceReceipt(
          validateBodyProviderConformance(value),
        );
      },
      (error) => error.code === "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID",
    );
    assert.equal(receipt, undefined);
  }
});

test("public run IDs and all nested packet shapes are closed", () => {
  const adversarial = [
    packet({ first: { result: result(), runId: "../../private/person" } }),
    packet({ first: { result: result(), runId: "Person Name" } }),
    packet({ first: { result: result(), runId: "x".repeat(65) } }),
    packet({
      first: { result: result(), runId: "run-a", credential: "secret" },
    }),
    { ...packet(), callbackUrl: "https://private.invalid" },
  ];
  for (const value of adversarial) {
    assert.throws(
      () => validateBodyProviderConformance(value),
      (error) => error.code === "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID",
    );
  }
});

test("copied or substituted conformance envelopes cannot emit a receipt", () => {
  const validation = validateBodyProviderConformance(packet());
  const copied = Object.freeze({ ...validation });
  const substituted = Object.freeze({
    ...validation,
    detectorArtifactDigest: digest("f"),
  });
  for (const forged of [copied, substituted]) {
    let receipt;
    assert.throws(
      () => {
        receipt = createBodyProviderConformanceReceipt(forged);
      },
      (error) => error.code === "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID",
    );
    assert.equal(receipt, undefined);
  }
});

test("CLI is bounded, deterministic, and never echoes caller content", () => {
  const run = (input) =>
    spawnSync(
      process.execPath,
      ["bin/validate-body-provider-conformance.mjs"],
      {
        cwd: serviceRoot,
        encoding: "utf8",
        input,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  const input = packet();
  const first = run(JSON.stringify(input));
  const second = run(JSON.stringify(input));
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stdout.includes(input.first.result.assetToken), false);
  assert.equal(
    first.stdout.includes(input.first.result.sourceContentDigest),
    false,
  );

  const sentinel = "../../private/person-name.jpg?credential=secret";
  const invalid = run(
    JSON.stringify({
      ...input,
      first: { ...input.first, runId: sentinel },
    }),
  );
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.includes(sentinel), false);
  assert.deepEqual(JSON.parse(invalid.stderr), {
    error: { code: "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID" },
  });

  const malformed = run(`{"private":"${sentinel}`);
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stderr.includes(sentinel), false);
  const tooLarge = run("x".repeat(1024 * 1024 + 1));
  assert.equal(tooLarge.status, 1);
  assert.deepEqual(JSON.parse(tooLarge.stderr), {
    error: { code: "BODY_PROVIDER_CONFORMANCE_INPUT_TOO_LARGE" },
  });
});
