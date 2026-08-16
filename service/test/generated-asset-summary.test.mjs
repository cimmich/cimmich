import assert from "node:assert/strict";
import test from "node:test";
import {
  createGeneratedAssetSummaryStore,
  normalizeGeneratedVisualFacts,
} from "../src/generated-asset-summary.mjs";

const digest = "a".repeat(64);
const facts = {
  activities: ["walking"],
  objects: ["boat"],
  peopleCountEstimate: 2,
  qualityFlags: ["blur"],
  scene: "harbour",
  summary: "Two people near a boat",
  visibleText: ["JETTY"],
};

test("generated summary facts are closed, bounded and canonical", () => {
  assert.deepEqual(
    normalizeGeneratedVisualFacts({ ...facts, objects: ["boat", "boat"] }),
    facts,
  );
  assert.throws(
    () => normalizeGeneratedVisualFacts({ ...facts, peopleCountEstimate: 101 }),
    (error) => error.code === "GENERATED_SUMMARY_INPUT_INVALID",
  );
  assert.throws(
    () => normalizeGeneratedVisualFacts({ ...facts, summary: "" }),
    (error) => error.code === "GENERATED_SUMMARY_INPUT_INVALID",
  );
});

test("a local summary commit supersedes one tier and retains exact lineage", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("FROM immich_asset_projection"))
      return [{ input_revision: digest }];
    if (statement.includes("FROM current_generated_asset_summary_analysis"))
      return [];
    return [];
  };
  sql.begin = async (run) => {
    const transaction = async (strings) => {
      statements.push(strings.join("?"));
      return [];
    };
    transaction.json = (value) => value;
    await run(transaction);
  };
  const store = createGeneratedAssetSummaryStore(sql, {
    resolveVisibleAssetDisplay: async () => ({ assetId: "asset-1" }),
  });

  const result = await store.commitFromLocalAi({
    configDigest: digest,
    modelDigest: "model-digest",
    modelName: "vision-fast",
    proposalDigest: digest,
    providerId: "loopback-provider",
    sourceAssetId: "source-1",
    sourceContentDigest: digest,
    tier: "smart",
    visualFacts: facts,
  });

  assert.equal(result.changed, true);
  assert.match(result.summaryAnalysisId, /^summaryanalysis_[0-9a-f]{32}$/);
  assert.ok(
    statements.some((statement) =>
      statement.includes("SET state = 'superseded'"),
    ),
  );
  assert.ok(
    statements.some((statement) =>
      statement.includes("INSERT INTO generated_asset_summary_analysis"),
    ),
  );
});
