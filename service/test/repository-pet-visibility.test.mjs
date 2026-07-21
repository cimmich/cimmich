import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";

const petRow = (personId, displayName, tier = "standard") => ({
  aliases: [],
  breed_label: null,
  confirmed_media_count: 2,
  cover_asset_id: null,
  cover_crop: null,
  current_revision: 4,
  description: "",
  display_name: displayName,
  document_count: 1,
  person_id: personId,
  species_kind: "cat",
  species_label: "Cat",
  status: "active",
  visibility_decision_id: `decision-${personId}`,
  visibility_explicit: tier !== "standard",
  visibility_revision: tier === "standard" ? 0 : 2,
  visibility_tier: tier,
});

test("Pet rows project independent visibility and batch accepted visible context connections", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("WITH visible_connections")) {
      return [
        {
          cover_asset_id: "asset-cover",
          display_name: "Bluewater Weekend",
          pet_id: "pet-juniper",
          relation_kind: "participant",
          target_id: "event-bluewater",
          target_kind: "event",
          type_kind: "trip",
        },
        {
          cover_asset_id: null,
          display_name: "Willow Community Garden",
          pet_id: "pet-juniper",
          relation_kind: "related",
          target_id: "place-willow",
          target_kind: "place",
          type_kind: "park",
        },
      ];
    }
    if (statement.includes("FROM current_person pet")) {
      return [
        petRow("pet-juniper", "Juniper", "personal"),
        petRow("pet-pixel", "Pixel"),
      ];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  const repository = createCimmichRepository(
    sql,
    new Map([
      [
        "asset-cover",
        {
          filename: "bluewater-weekend.png",
          sourceAssetId: "source-asset-cover",
        },
      ],
    ]),
    { currentRank: () => 1 },
  );

  const result = await repository.pets({ limit: 100 });

  assert.equal(statements.length, 2, "Pet collection must not query per Pet");
  assert.deepEqual(result[0].visibility, {
    decisionId: "decision-pet-juniper",
    explicit: true,
    objectId: "pet-juniper",
    objectScope: "pet",
    revision: 2,
    visibilityTier: "personal",
  });
  assert.deepEqual(result[0].connections, [
    {
      coverAssetId: "source-asset-cover",
      direction: "incoming",
      displayName: "Bluewater Weekend",
      relationType: "participant",
      targetId: "event-bluewater",
      targetKind: "event",
      typeKind: "trip",
    },
    {
      coverAssetId: null,
      direction: "incoming",
      displayName: "Willow Community Garden",
      relationType: "related",
      targetId: "place-willow",
      targetKind: "place",
      typeKind: "park",
    },
  ]);
  assert.deepEqual(result[1].connections, []);

  assert.match(
    statements[0],
    /cimmich_visibility_pet_rank\(pet\.person_id\) <=/,
  );
  assert.match(statements[0], /visibility\.object_scope = 'pet'/);
  assert.match(
    statements[0],
    /cimmich_visibility_asset_rank\(association\.asset_id\) <=/,
  );
  assert.match(statements[1], /FROM current_context_relation link/);
  assert.match(statements[1], /source\.status = 'active'/);
  assert.match(
    statements[1],
    /cimmich_visibility_context_entity_rank\(source\.entity_id\)\s*<=/,
  );
  assert.match(
    statements[1],
    /cimmich_visibility_asset_rank\(association\.asset_id\)\s*<=/,
  );
  assert.match(statements[1], /WHERE position <= 100/);
  assert.doesNotMatch(statements[1], /count\s*\(/i);
});

test("Pet-bearing identity, search, document and context surfaces use the subject visibility seam", async () => {
  const { readFile } = await import("node:fs/promises");
  const paths = [
    "../src/basic-smart-search.mjs",
    "../src/context-entities.mjs",
    "../src/documents.mjs",
    "../src/manual-subject-presence.mjs",
    "../src/manual-subject-tag.mjs",
    "../src/repository.mjs",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(
      source,
      /cimmich_visibility_subject_rank/,
      `${path} must admit Person/Pet subjects through the typed visibility seam`,
    );
  }

  const petDocuments = await readFile(
    new URL("../src/pet-documents.mjs", import.meta.url),
    "utf8",
  );
  const legacyPetDocuments = await readFile(
    new URL("../src/document-legacy-pet.mjs", import.meta.url),
    "utf8",
  );
  assert.match(petDocuments, /cimmich_visibility_pet_rank/);
  assert.match(legacyPetDocuments, /cimmich_visibility_pet_rank/);

  const visibility = await readFile(
    new URL("../src/visibility.mjs", import.meta.url),
    "utf8",
  );
  assert.match(visibility, /scope === "person"/);
  assert.match(
    visibility,
    /WHERE person_id = \$\{id\} AND subject_kind = 'pet'/,
  );
});
