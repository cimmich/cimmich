import assert from "node:assert/strict";
import test from "node:test";
import {
  petMatchingSchemaVersion,
  validatePetMatchImport,
} from "../src/pet-matching.mjs";

const digest = "a".repeat(64);
const packet = (overrides = {}) => ({
  observations: [
    {
      assetId: "asset_pet_0001",
      box: { h: 0.5, w: 0.4, x: 0.1, y: 0.2 },
      candidates: [
        {
          galleryCount: 4,
          petId: "person_cafe_0001",
          score: 0.736,
        },
      ],
      detectionConfidence: 0.91,
      embeddingDigest: digest,
      observationId: "petobservation_0001",
      speciesKind: "dog",
    },
  ],
  provider: {
    configDigest: digest,
    lane: "face",
    modelFamily: "petface-arcface",
    modelVersion: "community-cat-dog-v1",
    providerId: "local.petface",
    speciesKind: "dog",
    vectorSpaceId: "petface-arcface-dog-512",
  },
  runId: "petmatchrun_0001",
  schemaVersion: petMatchingSchemaVersion,
  ...overrides,
});

test("validates a bounded Pet matching packet", () => {
  const validated = validatePetMatchImport(packet());
  assert.equal(validated.provider.lane, "face");
  assert.equal(validated.observations[0].candidates[0].rank, 1);
  assert.equal(validated.observations[0].speciesKind, "dog");
});

test("preserves an empty candidate list as an explicit Unknown Pet input", () => {
  const value = packet();
  value.observations[0].candidates = [];
  const validated = validatePetMatchImport(value);
  assert.deepEqual(validated.observations[0].candidates, []);
});

test("rejects boxes outside the image", () => {
  const value = packet();
  value.observations[0].box = { h: 0.5, w: 0.4, x: 0.7, y: 0.2 };
  assert.throws(
    () => validatePetMatchImport(value),
    (error) => error.code === "PET_MATCH_BOX_INVALID",
  );
});

test("rejects duplicate candidate Pets within one observation", () => {
  const value = packet();
  value.observations[0].candidates.push({
    galleryCount: 3,
    petId: "person_cafe_0001",
    score: 0.4,
  });
  assert.throws(
    () => validatePetMatchImport(value),
    (error) => error.code === "PET_MATCH_CANDIDATES_INVALID",
  );
});

test("rejects unsupported provider lanes", () => {
  const value = packet();
  value.provider.lane = "presence";
  assert.throws(
    () => validatePetMatchImport(value),
    (error) => error.code === "PET_MATCH_LANE_INVALID",
  );
});
