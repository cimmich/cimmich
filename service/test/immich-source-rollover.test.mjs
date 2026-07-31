import assert from "node:assert/strict";
import test from "node:test";
import {
  immichSourceRolloverSchemaVersion,
  rolloverImmichInventorySource,
} from "../src/immich-source-rollover.mjs";

const sourceRows = [
  {
    last_completed_run_id: "run-old",
    source_id: "immich-old",
    state: "active",
    superseded_by_source_id: null,
  },
  {
    last_completed_run_id: "run-current",
    source_id: "immich-current",
    state: "active",
    superseded_by_source_id: null,
  },
];

const database = () => {
  const statements = [];
  const transaction = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (statement.includes("FROM immich_inventory_source_rollover_command")) {
      return [];
    }
    if (statement.includes("FROM immich_inventory_source\n")) {
      return sourceRows;
    }
    if (
      statement.includes("FROM immich_inventory_run") &&
      statement.includes("state = 'processing'")
    ) {
      return [];
    }
    if (
      statement.includes("SELECT run.run_id") &&
      statement.includes("selected_visibilities")
    ) {
      return [{ run_id: "run-current" }];
    }
    if (statement.includes("WITH predecessor AS MATERIALIZED")) {
      return [
        {
          ambiguous_metadata_projections: 2,
          historical_evidence_assets: 20,
          jobs_to_pause: 0,
          metadata_equivalent_projections: 27,
          predecessor_only_assets: 78,
          projections: 4044,
          shared_asset_projections: 3968,
          source_bindings: 4044,
          unmatched_projections: 51,
        },
      ];
    }
    if (statement.includes("UPDATE immich_asset_projection")) {
      return Array.from({ length: 4044 }, () => ({ cimmich_asset_id: "a" }));
    }
    if (statement.includes("UPDATE asset_source_binding")) {
      return Array.from({ length: 4044 }, () => ({ binding_id: "b" }));
    }
    if (statement.includes("UPDATE media_job")) return [];
    if (statement.includes("UPDATE asset\n")) {
      return Array.from({ length: 78 }, () => ({ asset_id: "a" }));
    }
    return [];
  };
  transaction.json = (value) => value;
  const sql = Object.assign(transaction, {
    begin: async (operation) => operation(transaction),
  });
  return { sql, statements };
};

const command = {
  actorId: "owner",
  commandId: "rollover-1",
  predecessorSourceId: "immich-old",
  successorSourceId: "immich-current",
};

test("Immich source rollover dry-run is bounded and mutation-free", async () => {
  const { sql, statements } = database();
  const result = await rolloverImmichInventorySource({ ...command, sql });

  assert.equal(result.applied, false);
  assert.equal(result.before.projections, 4044);
  assert.equal(result.before.shared_asset_projections, 3968);
  assert.equal(result.before.predecessor_only_assets, 78);
  assert.equal(result.schemaVersion, immichSourceRolloverSchemaVersion);
  assert.equal(
    statements.some(({ statement }) =>
      statement.includes("UPDATE immich_asset_projection"),
    ),
    false,
  );
});

test("Immich source rollover requires exact confirmation before mutation", async () => {
  const { sql } = database();
  await assert.rejects(
    rolloverImmichInventorySource({
      ...command,
      apply: true,
      confirm: "wrong",
      sql,
    }),
    /requires --confirm=immich-old->immich-current/,
  );
});

test("Immich source rollover retires the predecessor without deleting intelligence", async () => {
  const { sql, statements } = database();
  const result = await rolloverImmichInventorySource({
    ...command,
    apply: true,
    confirm: "immich-old->immich-current",
    sql,
  });

  assert.equal(result.applied, true);
  assert.equal(result.changedProjections, 4044);
  assert.equal(result.changedBindings, 4044);
  assert.equal(result.missingAssets, 78);
  assert.equal(result.pausedJobs, 0);
  assert.equal(result.replayed, false);
  const sourceUpdate = statements.find(({ statement }) =>
    statement.includes("UPDATE immich_inventory_source"),
  )?.statement;
  assert.match(sourceUpdate, /state = 'disabled'/);
  assert.match(sourceUpdate, /superseded_by_source_id/);
  assert.equal(
    statements.some(({ statement }) => /DELETE FROM/.test(statement)),
    false,
  );
  assert.equal(
    statements.some(({ statement }) =>
      /UPDATE (face_observation|body_observation|identity_claim)/.test(
        statement,
      ),
    ),
    false,
  );
});
