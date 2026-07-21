import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";

test("asset evidence projects only current visibility-admitted photo context", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("FROM asset") && statement.includes("media_kind")) {
      return [
        {
          asset_id: "asset-1",
          capture_time: null,
          height: 800,
          media_kind: "image",
          mime_type: "image/jpeg",
          width: 1200,
        },
      ];
    }
    if (statement.includes("SELECT asset_id FROM asset")) {
      return [{ asset_id: "asset-1" }];
    }
    if (statement.includes("FROM current_context_asset link")) {
      return [
        {
          association_kind: "manual",
          display_name: "Bluewater Beach",
          entity_id: "place-1",
          entity_kind: "place",
          type_kind: "point",
        },
      ];
    }
    return [];
  };
  const repository = createCimmichRepository(
    sql,
    new Map([["asset-1", { filename: "photo.jpg", sourceAssetId: "source-1" }]]),
  );

  const result = await repository.assetEvidence({ sourceAssetId: "source-1" });

  assert.deepEqual(result.contexts, [
    {
      association_kind: "manual",
      display_name: "Bluewater Beach",
      entity_id: "place-1",
      entity_kind: "place",
      type_kind: "point",
    },
  ]);
  const contextStatement = statements.find((statement) =>
    statement.includes("FROM current_context_asset link"),
  );
  assert.match(contextStatement, /entity\.status = 'active'/);
  assert.match(
    contextStatement,
    /cimmich_visibility_context_entity_rank\(entity\.entity_id\) <=/,
  );
  assert.match(
    contextStatement,
    /ORDER BY entity\.entity_kind, lower\(entity\.display_name\), entity\.entity_id/,
  );
});
