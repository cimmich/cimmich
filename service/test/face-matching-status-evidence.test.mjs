import assert from "node:assert/strict";
import test from "node:test";
import { readFaceMatchingStatusEvidence } from "../src/face-matching-status-evidence.mjs";

test("matching status uses one bounded set join instead of per-Face pipeline scans", async () => {
  const statements = [];
  const values = [];
  const evidence = {
    accepted_faces: 9,
    analysed_faces: 7,
    eligible_faces: 8,
    provider_embeddings: 6,
  };
  const tx = async (strings, ...queryValues) => {
    const statement = strings.join("?");
    statements.push(statement);
    values.push(...queryValues);
    return statement.includes("WITH accepted AS") ? [evidence] : [];
  };
  const sql = async () => {
    throw new Error("Status evidence must use its bounded transaction");
  };
  sql.begin = async (callback) => callback(tx);
  const provider = {
    configDigest: "a".repeat(64),
    modelFamily: "synthetic-face",
    modelVersion: "v1",
    providerConfigDigest: "b".repeat(64),
    vectorSpaceId: "synthetic-space-v1",
  };

  assert.deepEqual(
    await readFaceMatchingStatusEvidence({
      provider,
      sourceId: "immich-primary",
      sql,
      visibleRank: 2,
    }),
    evidence,
  );
  assert.match(
    statements[0],
    /set_config\('statement_timeout', '8000', true\)/,
  );
  assert.match(statements[1], /analysed AS MATERIALIZED/);
  assert.match(
    statements[1],
    /JOIN media_pipeline_run_observation observation/,
  );
  assert.match(statements[1], /LEFT JOIN analysed analysis/);
  assert.doesNotMatch(statements[1], /LEFT JOIN LATERAL/);
  assert.ok(values.includes("immich-primary"));
  assert.ok(values.includes(provider.providerConfigDigest));
  assert.ok(values.includes(provider.vectorSpaceId));
  assert.ok(values.includes(2));
});
