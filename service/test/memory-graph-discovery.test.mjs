import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryGraphDiscovery } from "../src/memory-graph-discovery.mjs";

test("Memory graph projects a bounded multi-entity evidence web", async () => {
  const statements = [];
  const sql = async (strings, ...values) => {
    statements.push({ statement: strings.join("?"), values });
    return [
      {
        cover_asset_id: "asset-shared",
        photo_count: 7,
        relation_kind: "shared_media",
        source_id: "person-maya",
        source_kind: "person",
        source_name: "Maya Vale",
        source_type_kind: null,
        target_id: "place-garden",
        target_kind: "place",
        target_name: "Willow Garden",
        target_type_kind: "property",
      },
      {
        cover_asset_id: null,
        photo_count: 0,
        relation_kind: "location",
        source_id: "event-weekend",
        source_kind: "event",
        source_name: "Bluewater Weekend",
        source_type_kind: "trip",
        target_id: "place-garden",
        target_kind: "place",
        target_name: "Willow Garden",
        target_type_kind: "property",
      },
    ];
  };
  const discovery = createMemoryGraphDiscovery({
    bridge: new Map([
      [
        "asset-shared",
        { filename: "garden.jpg", sourceAssetId: "source-shared" },
      ],
    ]),
    presentationRank: () => 2,
    sql,
  });

  const result = await discovery.read({ edgeLimit: 48 });

  assert.deepEqual(result.countsByKind, {
    event: 1,
    object: 0,
    person: 1,
    pet: 0,
    place: 1,
  });
  assert.equal(result.nodes.length, 3);
  assert.equal(result.edges.length, 2);
  assert.equal(result.scope.edgeLimit, 48);
  assert.deepEqual(
    result.nodes.find(({ nodeId }) => nodeId === "person:person-maya"),
    {
      connectionCount: 1,
      coverAssetId: "source-shared",
      displayName: "Maya Vale",
      entityId: "person-maya",
      kind: "person",
      nodeId: "person:person-maya",
      typeKind: null,
    },
  );
  assert.deepEqual(
    result.edges.find(({ edgeId }) => edgeId.includes("person:person-maya")),
    {
      coverAssetId: "source-shared",
      edgeId: "person:person-maya--place:place-garden",
      photoCount: 7,
      relationKinds: ["shared_media"],
      sourceNodeId: "person:person-maya",
      targetNodeId: "place:place-garden",
      weight: 4.75,
    },
  );
  assert.equal(statements.length, 1);
  assert.match(statements[0].statement, /FROM person_assets association/);
  assert.match(
    statements[0].statement,
    /FROM current_context_asset association/,
  );
  assert.match(
    statements[0].statement,
    /FROM current_context_relation relation/,
  );
  assert.match(statements[0].statement, /FROM current_connection_fact fact/);
  assert.match(
    statements[0].statement,
    /FROM current_connection_fact_context fact_context/,
  );
  assert.match(statements[0].statement, /relationship_contexts AS/);
  assert.match(
    statements[0].statement,
    /ELSE ' @ ' \|\| fact_contexts\.labels/,
  );
  assert.match(statements[0].statement, /JOIN connection_type type/);
  assert.match(
    statements[0].statement,
    /THEN ' \(Former' \|\| CASE WHEN qualifiers\.labels IS NULL/,
  );
  assert.match(statements[0].statement, /string_agg\(modifier\.label, ', '/);
  assert.match(statements[0].statement, /JOIN context_entity parent/);
  assert.match(statements[0].statement, /cimmich_visibility_person_rank/);
  assert.match(
    statements[0].statement,
    /cimmich_visibility_context_entity_rank/,
  );
  assert.equal(statements[0].values.filter((value) => value === 2).length, 16);
});
