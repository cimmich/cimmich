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
          relation_id: "relation-bluewater-juniper",
          subject_id: "pet-juniper",
          relation_kind: "participant",
          target_id: "event-bluewater",
          target_kind: "event",
          type_kind: "trip",
        },
        {
          cover_asset_id: null,
          display_name: "Willow Community Garden",
          relation_id: "relation-willow-juniper",
          subject_id: "pet-juniper",
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
      relationId: "relation-bluewater-juniper",
      relationType: "participant",
      targetId: "event-bluewater",
      targetKind: "event",
      typeKind: "trip",
    },
    {
      coverAssetId: null,
      direction: "incoming",
      displayName: "Willow Community Garden",
      relationId: "relation-willow-juniper",
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

test("Person connections project incoming context relations without requiring shared media", async () => {
  const statements = [];
  const sql = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (
      statement.includes("SELECT person_id, subject_kind FROM current_person")
    ) {
      return [{ person_id: "person-maya", subject_kind: "person" }];
    }
    if (statement.includes("WITH visible_connections")) {
      return [
        {
          cover_asset_id: null,
          display_name: "Garden notebook",
          relation_id: "relation-maya-notebook",
          relation_kind: "companion",
          subject_id: "person-maya",
          target_id: "object-garden-notebook",
          target_kind: "object",
          type_kind: "journal",
        },
      ];
    }
    if (statement.includes("WITH subject_assets AS MATERIALIZED")) {
      return [
        {
          cover_asset_id: "asset-maya-with-noah",
          display_name: "Noah Vale",
          photo_count: 2,
          target_id: "person-noah",
        },
      ];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  const repository = createCimmichRepository(
    sql,
    new Map([
      [
        "asset-maya-with-noah",
        {
          filename: "maya-with-noah.jpg",
          sourceAssetId: "source-maya-with-noah",
        },
      ],
    ]),
    { currentRank: () => 0 },
  );

  const result = await repository.personConnections({
    personId: "person-maya",
  });

  assert.deepEqual(result, [
    {
      coverAssetId: "source-maya-with-noah",
      direction: "incoming",
      displayName: "Noah Vale",
      photoCount: 2,
      relationType: "co_appearance",
      targetId: "person-noah",
      targetKind: "person",
      typeKind: null,
    },
    {
      coverAssetId: null,
      direction: "incoming",
      displayName: "Garden notebook",
      relationId: "relation-maya-notebook",
      relationType: "companion",
      targetId: "object-garden-notebook",
      targetKind: "object",
      typeKind: "journal",
    },
  ]);
  assert.equal(statements[1].values.includes("person"), true);
  assert.match(statements[1].statement, /link\.target_id = ANY/);
  assert.match(
    statements[1].statement,
    /cimmich_visibility_context_entity_rank\(source\.entity_id\)/,
  );
  assert.match(statements[2].statement, /WITH subject_assets AS MATERIALIZED/);
  assert.match(statements[2].statement, /shared_people_assets AS MATERIALIZED/);
  assert.match(statements[2].statement, /claim\.state = 'accepted'/);
  assert.match(statements[2].statement, /tag\.state = 'accepted'/);
  assert.match(statements[2].statement, /presence\.state = 'accepted'/);
  assert.match(statements[2].statement, /cimmich_visibility_asset_rank/);
  assert.match(statements[2].statement, /cimmich_visibility_person_rank/);
  assert.match(statements[2].statement, /target\.status = 'active'/);
  assert.match(statements[2].statement, /LIMIT 100/);
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

test("Pet media projects accepted Pet face geometry for automatic presentation focus", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("WITH visible_connections")) return [];
    if (statement.includes("SELECT person_id, cover_asset_id, cover_crop")) {
      return [
        { cover_asset_id: null, cover_crop: null, person_id: "pet-cafe" },
      ];
    }
    if (statement.includes("FROM current_person pet")) {
      return [petRow("pet-cafe", "Cafe")];
    }
    if (statement.includes("FROM person_assets association")) {
      return [
        {
          asset_id: "asset-cafe",
          association_types: ["face"],
          capture_time: "2018-01-27T12:00:00Z",
          height: 3024,
          media_kind: "image",
          pet_face: {
            box_h: 0.1,
            box_w: 0.06,
            box_x: 0.86,
            box_y: 0.78,
            face_id: "face-cafe",
          },
          width: 4032,
        },
      ];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  const repository = createCimmichRepository(
    sql,
    new Map([
      ["asset-cafe", { filename: "cafe.jpg", sourceAssetId: "source-cafe" }],
    ]),
    { currentRank: () => 0 },
  );

  const [media] = await repository.petMedia({
    limit: 1,
    petId: "pet-cafe",
  });

  assert.deepEqual(media.pet_face, {
    box_h: 0.1,
    box_w: 0.06,
    box_x: 0.86,
    box_y: 0.78,
    face_id: "face-cafe",
  });
  const mediaStatement = statements.find((statement) =>
    statement.includes("AS pet_face"),
  );
  assert.match(mediaStatement, /face_association\.person_id =/);
  assert.match(mediaStatement, /face_association\.asset_id = asset\.asset_id/);
  assert.match(
    mediaStatement,
    /face_association\.authority_state = 'accepted'/,
  );
});
