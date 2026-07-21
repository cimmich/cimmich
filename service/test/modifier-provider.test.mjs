import assert from "node:assert/strict";
import test from "node:test";
import {
  compileModifierProposals,
  compileTargetLocalModifierProposals,
  modifierVocabularyVersion,
} from "../src/modifier-provider.mjs";

const packet = {
  provider: {
    configDigest: "config_digest_1234567890",
    model: "test-condition-model",
    modelVersion: "v1",
    name: "test-provider",
    vocabularyVersion: modifierVocabularyVersion,
  },
  observations: [
    {
      cropDigest: "crop_digest_1234567890",
      faceId: "face_alpha",
      scores: { helmet: 0.96, profile: 0.62 },
    },
  ],
};

test("modifier provider abstains below a calibrated threshold", () => {
  const proposals = compileModifierProposals(packet, {
    thresholds: { helmet: 0.9, profile: 0.8 },
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].modifierKey, "helmet");
  assert.equal(proposals[0].calibratedConfidence, 0.96);
});

test("modifier proposal identity is deterministic and candidate-only", () => {
  const first = compileModifierProposals(packet, {
    thresholds: { helmet: 0.9, profile: 0.8 },
  });
  const second = compileModifierProposals(structuredClone(packet), {
    thresholds: { helmet: 0.9, profile: 0.8 },
  });
  assert.deepEqual(first, second);
  assert.equal("decision" in first[0], false);
  assert.equal("actorKind" in first[0], false);
});

test("unknown modifier labels fail closed instead of becoming vocabulary drift", () => {
  assert.throws(
    () =>
      compileModifierProposals(
        {
          ...packet,
          observations: [
            {
              cropDigest: "crop_digest_1234567890",
              faceId: "face_alpha",
              scores: { costume: 0.99 },
            },
          ],
        },
        { thresholds: { costume: 0.9 } },
      ),
    /Unknown modifier vocabulary key/,
  );
});

test("target-local provider excludes contaminated crops and keeps clean fallback evidence", () => {
  const proposals = compileTargetLocalModifierProposals(
    {
      provider: {
        ...packet.provider,
        cropPolicyVersion: "target-local-multicrop-v1",
      },
      observations: [
        {
          faceId: "face_alpha",
          scores: { sunglasses: 0.96 },
          targetLocal: {
            contaminatedCrops: { face: true, tight: false },
            cropDigests: {
              face: "face_crop_digest_1234567890",
              tight: "tight_crop_digest_1234567890",
            },
            requestedCrops: ["tight", "face"],
            selectionState: "selected",
            usableCrops: ["tight"],
          },
        },
      ],
    },
    { thresholds: { sunglasses: 0.9 } },
  );
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0].evidence.targetLocal.usableCrops, ["tight"]);
  assert.equal(proposals[0].cropDigest.length, 64);
});

test("target-local provider abstains when target selection or clean crops are absent", () => {
  const proposals = compileTargetLocalModifierProposals(
    {
      provider: {
        ...packet.provider,
        cropPolicyVersion: "target-local-multicrop-v1",
      },
      observations: [
        {
          faceId: "face_missing",
          scores: { helmet: 0.99 },
          targetLocal: {
            requestedCrops: ["head"],
            selectionState: "missing",
            usableCrops: [],
          },
        },
        {
          faceId: "face_contaminated",
          scores: { helmet: 0.99 },
          targetLocal: {
            requestedCrops: ["head"],
            selectionState: "selected",
            usableCrops: [],
          },
        },
      ],
    },
    { thresholds: { helmet: 0.9 } },
  );
  assert.deepEqual(proposals, []);
});

test("target-local provider rejects a contaminated crop mislabeled usable", () => {
  assert.throws(
    () =>
      compileTargetLocalModifierProposals(
        {
          provider: {
            ...packet.provider,
            cropPolicyVersion: "target-local-multicrop-v1",
          },
          observations: [
            {
              faceId: "face_alpha",
              scores: { helmet: 0.99 },
              targetLocal: {
                contaminatedCrops: { head: true },
                cropDigests: { head: "head_crop_digest_1234567890" },
                requestedCrops: ["head"],
                selectionState: "selected",
                usableCrops: ["head"],
              },
            },
          ],
        },
        { thresholds: { helmet: 0.9 } },
      ),
    /cannot be contaminated/,
  );
});
