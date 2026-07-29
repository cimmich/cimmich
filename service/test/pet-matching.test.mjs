import assert from "node:assert/strict";
import test from "node:test";
import {
  createPetMatchingStore,
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

test("read surfaces scope suggestions, unknowns and counts to visible active evidence", async () => {
  const statements = [];
  const values = [];
  const sql = async (strings, ...parameters) => {
    statements.push(strings.join("?"));
    values.push(parameters);
    return [];
  };
  const store = createPetMatchingStore(sql, { presentationRank: () => 1 });

  await store.suggestions({ petId: "person_cafe_0001" });
  await store.unknown({});
  await store.status();

  const suggestions = statements.find((statement) =>
    statement.includes("FROM pet_match_suggestion suggestion"),
  );
  assert.match(suggestions, /JOIN asset ON asset\.asset_id = observation\.asset_id\s+AND asset\.state = 'active'/);
  assert.match(suggestions, /pet\.status = 'active'/);
  assert.match(suggestions, /cimmich_visibility_pet_rank\(pet\.person_id\) <=/);
  assert.match(
    suggestions,
    /cimmich_visibility_asset_rank\(observation\.asset_id\) <=/,
  );

  const unknown = statements.find((statement) =>
    statement.includes("WHERE observation.state = 'unknown'"),
  );
  assert.match(unknown, /JOIN asset ON asset\.asset_id = observation\.asset_id\s+AND asset\.state = 'active'/);
  assert.match(
    unknown,
    /cimmich_visibility_asset_rank\(observation\.asset_id\)\s+<=/,
  );

  const counts = statements.find((statement) =>
    statement.includes("count(*) FILTER"),
  );
  assert.match(counts, /JOIN asset ON asset\.asset_id = observation\.asset_id\s+AND asset\.state = 'active'/);
  assert.match(
    counts,
    /cimmich_visibility_asset_rank\(observation\.asset_id\)\s+<=/,
  );
  // Status counts must agree with the lists, which only show observations
  // from completed runs.
  assert.match(
    counts,
    /JOIN pet_match_run run ON run\.run_id = observation\.run_id\s+AND run\.state = 'complete'/,
  );
  assert.ok(values.flat().includes(1), "queries must bind the caller rank");
});

test("suggestion confirm requires a live asset and a lifecycle-visible Pet", async () => {
  const statements = [];
  const tx = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("FROM pet_match_command")) return [];
    if (statement.includes("FROM pet_match_suggestion suggestion")) {
      return [
        {
          asset_id: "asset_pet_0001",
          box_h: 0.5,
          box_w: 0.4,
          box_x: 0.1,
          box_y: 0.2,
          detection_confidence: 0.91,
          display_name: "Café",
          lane: "face",
          observation_id: "petobservation_0001",
          observation_state: "pending",
          pet_id: "person_cafe_0001",
          score: 0.7,
          species_kind: "dog",
          suggestion_id: "petsuggestion_0001",
          suggestion_state: "pending",
        },
      ];
    }
    if (statement.includes("SELECT asset_id FROM asset")) return [];
    return [];
  };
  tx.json = (value) => value;
  const sql = async () => {
    throw new Error("Review must run inside one transaction");
  };
  sql.begin = (callback) => callback(tx);
  const store = createPetMatchingStore(sql);

  await assert.rejects(
    store.review({
      action: "confirm",
      actorId: "owner-test",
      commandId: "petmatchconfirm_0001",
      suggestionId: "petsuggestion_0001",
    }),
    (error) => error.code === "PET_MATCH_ASSET_NOT_FOUND",
  );
  const suggestionSelect = statements.find((statement) =>
    statement.includes("FOR UPDATE OF suggestion"),
  );
  assert.match(suggestionSelect, /pet\.subject_kind = 'pet'/);
  assert.match(suggestionSelect, /pet\.status IN \('active','hidden'\)/);
  assert.match(
    statements.find((statement) =>
      statement.includes("SELECT asset_id FROM asset"),
    ),
    /state = 'active'/,
  );
});

test("import batches observations and suggestions as two multi-row inserts", async () => {
  const statements = [];
  const bindings = [];
  const tx = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push(statement);
    bindings.push(values);
    if (statement.includes("FROM pet_match_run")) return [];
    if (statement.includes("SELECT asset_id FROM asset")) {
      return [{ asset_id: "asset_pet_0001" }, { asset_id: "asset_pet_0002" }];
    }
    if (statement.includes("SELECT person_id, species_kind FROM person")) {
      return [
        { person_id: "person_cafe_0001", species_kind: "dog" },
        { person_id: "person_mocha_0001", species_kind: "dog" },
      ];
    }
    return [];
  };
  const sql = { begin: async (callback) => callback(tx) };
  const store = createPetMatchingStore(sql);

  const result = await store.importBatch({
    actorId: "cimmich-operator",
    packet: packet({
      observations: [
        {
          assetId: "asset_pet_0001",
          box: { h: 0.5, w: 0.4, x: 0.1, y: 0.2 },
          candidates: [
            { galleryCount: 4, petId: "person_cafe_0001", score: 0.736 },
            { galleryCount: 2, petId: "person_mocha_0001", score: 0.42 },
          ],
          detectionConfidence: 0.91,
          embeddingDigest: digest,
          observationId: "petobservation_0001",
          speciesKind: "dog",
        },
        {
          assetId: "asset_pet_0002",
          box: { h: 0.3, w: 0.2, x: 0.5, y: 0.6 },
          candidates: [],
          detectionConfidence: 0.8,
          embeddingDigest: digest,
          observationId: "petobservation_0002",
          speciesKind: "dog",
        },
      ],
    }),
  });

  assert.equal(result.imported, true);
  assert.equal(result.observationCount, 2);
  const observationInserts = statements.filter((statement) =>
    statement.includes("INSERT INTO pet_match_observation"),
  );
  const suggestionInserts = statements.filter((statement) =>
    statement.includes("INSERT INTO pet_match_suggestion"),
  );
  assert.equal(observationInserts.length, 1);
  assert.equal(suggestionInserts.length, 1);
  assert.match(observationInserts[0], /FROM unnest\(/);
  assert.match(suggestionInserts[0], /FROM unnest\(/);
  const observationValues =
    bindings[
      statements.findIndex((statement) =>
        statement.includes("INSERT INTO pet_match_observation"),
      )
    ];
  // run id and receipt bind first, then the per-column arrays; the state
  // array preserves the pending/unknown split exactly as per-row inserts did.
  assert.deepEqual(observationValues[2], [
    "petobservation_0001",
    "petobservation_0002",
  ]);
  assert.deepEqual(observationValues.at(-1), ["pending", "unknown"]);
  const suggestionValues =
    bindings[
      statements.findIndex((statement) =>
        statement.includes("INSERT INTO pet_match_suggestion"),
      )
    ];
  assert.deepEqual(suggestionValues[2], [
    "petobservation_0001",
    "petobservation_0001",
  ]);
  assert.deepEqual(suggestionValues[3], [
    "person_cafe_0001",
    "person_mocha_0001",
  ]);
  assert.deepEqual(suggestionValues[5], [1, 2]);
});
