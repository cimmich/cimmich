import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryPlaceholderJobPruneSchemaVersion,
  pruneInventoryPlaceholderJobs,
} from "../src/inventory-placeholder-job-prune.mjs";

const database = ({
  eligibleEvents = 6,
  eligibleJobs = 3,
  scopedJobs = 3,
  unsafeJobs = 0,
} = {}) => {
  const statements = [];
  const transaction = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("FROM inventory_placeholder_job_prune_command")) {
      return [];
    }
    if (
      statement.includes("WITH scoped AS MATERIALIZED") &&
      statement.includes("SELECT\n      (SELECT count(*) FROM scoped)")
    ) {
      return [
        {
          eligible_events: eligibleEvents,
          eligible_jobs: eligibleJobs,
          scoped_jobs: scopedJobs,
          unsafe_jobs: unsafeJobs,
        },
      ];
    }
    if (statement.includes("DELETE FROM media_job job")) {
      return Array.from({ length: eligibleJobs }, (_, index) => ({
        job_id: `job-${index}`,
      }));
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
  commandId: "placeholder-prune-1",
  expectedJobCount: 3,
};

test("inventory placeholder prune dry-run is exact and mutation-free", async () => {
  const { sql, statements } = database();
  const result = await pruneInventoryPlaceholderJobs({ ...command, sql });

  assert.equal(result.applied, false);
  assert.equal(result.before.eligible_jobs, 3);
  assert.equal(result.before.eligible_events, 6);
  assert.equal(result.expectedConfirmation, "inventory-only-placeholders:3");
  assert.equal(result.schemaVersion, inventoryPlaceholderJobPruneSchemaVersion);
  assert.equal(
    statements.some((statement) =>
      statement.includes("DELETE FROM media_job job"),
    ),
    false,
  );
});

test("inventory placeholder prune requires exact count confirmation", async () => {
  const { sql } = database();
  await assert.rejects(
    pruneInventoryPlaceholderJobs({
      ...command,
      apply: true,
      confirm: "wrong",
      sql,
    }),
    /requires --confirm=inventory-only-placeholders:3/,
  );
});

test("inventory placeholder prune refuses an unsafe mixed scope", async () => {
  const { sql } = database({
    eligibleEvents: 4,
    eligibleJobs: 2,
    scopedJobs: 3,
    unsafeJobs: 1,
  });
  await assert.rejects(
    pruneInventoryPlaceholderJobs({
      ...command,
      apply: true,
      confirm: "inventory-only-placeholders:3",
      sql,
    }),
    /does not match the confirmed safe set/,
  );
});

test("inventory placeholder prune deletes only the confirmed zero-work set", async () => {
  const { sql, statements } = database();
  const result = await pruneInventoryPlaceholderJobs({
    ...command,
    apply: true,
    confirm: "inventory-only-placeholders:3",
    sql,
  });

  assert.equal(result.applied, true);
  assert.equal(result.deletedJobs, 3);
  assert.equal(result.deletedEvents, 6);
  assert.equal(result.replayed, false);
  const deletion = statements.find((statement) =>
    statement.includes("DELETE FROM media_job job"),
  );
  assert.match(deletion, /job\.state = 'paused'/);
  assert.match(deletion, /job\.attempt_count = 0/);
  assert.match(deletion, /job\.checkpoint_payload = '\{\}'::jsonb/);
  assert.match(deletion, /job\.result_receipt_id IS NULL/);
  assert.match(deletion, /dependent_jobs AS MATERIALIZED/);
  assert.doesNotMatch(
    statements.join("\n"),
    /DELETE FROM (asset|face_observation|body_observation|face_embedding)/,
  );
});
