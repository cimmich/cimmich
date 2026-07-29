import assert from "node:assert/strict";
import test from "node:test";

import {
  carryForwardIdentityAuditDismissals,
  createIdentityAudit,
  identityAuditQueryFrontierLimit,
  suppressSamePhotoDerivatives,
} from "../src/identity-audit.mjs";
import { readFile } from "node:fs/promises";

test("untagged audit suppresses weaker duplicate detections before matching", async () => {
  const source = await readFile(
    new URL("../src/identity-audit.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /query_candidates AS MATERIALIZED/);
  assert.match(source, /stronger\.asset_id = candidate\.asset_id/);
  assert.match(
    source,
    /coalesce\(stronger\.detection_confidence, 0\) >\s+coalesce\(candidate\.detection_confidence, 0\)/,
  );
  assert.match(source, /overlap\.intersection[\s\S]*>= 0\.5/);
  assert.match(
    source,
    /least\(candidate\.box_w, stronger\.box_w\)[\s\S]*<= 0\.45/,
  );
});

test("incremental audit carries its completed base and scopes expensive work", async () => {
  const source = await readFile(
    new URL("../src/identity-audit.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /prior\.face_id <> ALL\(\$\{incrementalFaceIds\}\)/);
  assert.match(source, /face\.face_id = ANY\(\$\{incrementalFaceIds\}\)/);
  assert.match(source, /item\.face_id = ANY\(\$\{exactFaceIds\}\)/);
  assert.match(source, /IDENTITY_AUDIT_INCREMENTAL_BASE_STALE/);
  assert.match(source, /result\.detector_config_digest/);
});

test("exact prior dismissals carry forward without broadening identity scope", async () => {
  let query = "";
  let values = [];
  const sql = async (strings, ...parameters) => {
    query = strings.join(" ");
    values = parameters;
    return [];
  };

  await carryForwardIdentityAuditDismissals(sql, {
    kind: "accepted_contradiction",
    runId: "identity-audit.current",
  });

  assert.match(
    query,
    /prior\.suggested_person_id = current\.suggested_person_id/,
  );
  assert.match(
    query,
    /prior\.assigned_person_id IS NOT DISTINCT FROM\s+current\.assigned_person_id/,
  );
  assert.match(query, /prior\.review_state = 'dismissed'/);
  assert.match(query, /prior_run\.state = 'completed'/);
  assert.deepEqual(values, [
    "identity-audit.current",
    "accepted_contradiction",
    "identity-audit.current",
    "accepted_contradiction",
  ]);
});

test("an interrupted audit is failed once when the service resumes", async () => {
  let state = "running";
  let recoveryWrites = 0;
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("UPDATE identity_audit_run")) {
      recoveryWrites += 1;
      state = "failed";
      return [];
    }
    if (query.includes("FROM current_source_pack")) {
      return [{ pack_id: "pack.active" }];
    }
    if (query.includes("SELECT * FROM identity_audit_run")) {
      return [
        {
          accepted_comparable_faces: 0,
          accepted_embedded_faces: 0,
          audit_run_id: "identity-audit.interrupted",
          completed_at: "2026-07-25T00:00:00.000Z",
          contradiction_candidates: 0,
          error_code: "IDENTITY_AUDIT_INTERRUPTED",
          margin_floor: 0.21,
          pack_id: "pack.active",
          policy_version: "cimmich-best-prime-v1",
          score_floor: 0,
          started_at: "2026-07-24T23:59:00.000Z",
          state,
          untagged_candidates: 0,
          untagged_embedded_faces: 0,
        },
      ];
    }
    throw new Error(`Unexpected identity audit query: ${query}`);
  };
  const audit = createIdentityAudit(sql);

  const first = await audit.latest();
  const second = await audit.latest();

  assert.equal(first.state, "failed");
  assert.equal(first.errorCode, "IDENTITY_AUDIT_INTERRUPTED");
  assert.equal(second.state, "failed");
  assert.equal(recoveryWrites, 1);
});

test("a failed interrupted-run reconcile retries instead of pinning every audit call", async () => {
  let updateAttempts = 0;
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("UPDATE identity_audit_run")) {
      updateAttempts += 1;
      if (updateAttempts === 1) throw new Error("connection lost");
      return [];
    }
    if (query.includes("FROM current_source_pack")) {
      return [{ pack_id: "pack.active" }];
    }
    if (query.includes("SELECT * FROM identity_audit_run")) return [];
    throw new Error(`Unexpected identity audit query: ${query}`);
  };
  const audit = createIdentityAudit(sql);

  await assert.rejects(audit.latest(), /connection lost/);
  assert.equal(await audit.latest(), null);
  assert.equal(updateAttempts, 2);

  const source = await readFile(
    new URL("../src/identity-audit.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /WHERE state = 'running'\s+AND started_at < now\(\) - interval '15 minutes'/,
  );
});

test("a completed audit is stale when no passed SourcePack remains active", async () => {
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("UPDATE identity_audit_run")) return [];
    if (query.includes("FROM current_source_pack")) return [];
    if (query.includes("SELECT * FROM identity_audit_run")) {
      return [
        {
          accepted_comparable_faces: 7,
          accepted_embedded_faces: 8,
          audit_run_id: "identity-audit.completed",
          completed_at: "2026-07-25T00:01:00.000Z",
          contradiction_candidates: 1,
          error_code: null,
          margin_floor: 0.21,
          pack_id: "pack.retired",
          policy_version: "cimmich-best-prime-v1",
          score_floor: 0,
          started_at: "2026-07-25T00:00:00.000Z",
          state: "completed",
          untagged_candidates: 2,
          untagged_embedded_faces: 20,
        },
      ];
    }
    throw new Error(`Unexpected identity audit query: ${query}`);
  };

  const result = await createIdentityAudit(sql).latest();

  assert.equal(result.stale, true);
});

test("audit items expose the exact trusted references needed for visual review", async () => {
  const run = {
    accepted_comparable_faces: 7,
    accepted_embedded_faces: 8,
    audit_run_id: "identity-audit.completed",
    completed_at: "2026-07-25T00:01:00.000Z",
    contradiction_candidates: 1,
    error_code: null,
    margin_floor: 0.21,
    pack_id: "pack.active",
    policy_version: "cimmich-best-prime-v1",
    score_floor: 0,
    started_at: "2026-07-25T00:00:00.000Z",
    state: "completed",
    untagged_candidates: 2,
    untagged_embedded_faces: 20,
  };
  let itemQuery = "";
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("UPDATE identity_audit_run")) return [];
    if (
      query.includes("SELECT * FROM identity_audit_run") &&
      query.includes("WHERE state = 'completed'")
    ) {
      return [run];
    }
    if (query.includes("SELECT count(*)::int AS total")) return [{ total: 1 }];
    if (query.includes("SELECT item.*")) {
      itemQuery = query;
      return [
        {
          asset_id: "asset.query",
          assigned_display_name: "Current Person",
          assigned_person_id: "person.current",
          assigned_reference_asset_id: "asset.current-reference",
          assigned_reference_box_h: 0.2,
          assigned_reference_box_w: 0.1,
          assigned_reference_box_x: 0.3,
          assigned_reference_box_y: 0.4,
          assigned_reference_face_id: "face.current-reference",
          assigned_reference_height: 800,
          assigned_reference_score: 0.4,
          assigned_reference_width: 1200,
          box_h: 0.22,
          box_w: 0.11,
          box_x: 0.31,
          box_y: 0.41,
          capture_time: "2025-01-01T00:00:00.000Z",
          comparison_score: 0.4,
          detection_confidence: 0.99,
          face_id: "face.query",
          height: 3000,
          margin: 0.5,
          media_kind: "image",
          quality_measurements: {},
          suggested_display_name: "Suggested Person",
          suggested_person_id: "person.suggested",
          suggested_reference_asset_id: "asset.suggested-reference",
          suggested_reference_box_h: 0.18,
          suggested_reference_box_w: 0.09,
          suggested_reference_box_x: 0.32,
          suggested_reference_box_y: 0.42,
          suggested_reference_face_id: "face.suggested-reference",
          suggested_reference_height: 900,
          suggested_reference_count: 4,
          suggested_reference_score: 0.9,
          suggested_top3_average_score: 0.82,
          suggested_reference_width: 1600,
          suggested_score: 0.9,
          audit_kind: "accepted_contradiction",
          width: 4000,
        },
      ];
    }
    throw new Error(`Unexpected identity audit query: ${query}`);
  };
  const bridgeFields = (assetId) => ({
    filename: `${assetId}.jpg`,
    sourceAssetId: `immich.${assetId}`,
  });

  const result = await createIdentityAudit(sql, { bridgeFields }).items({
    kind: "accepted_contradiction",
    personId: "person.suggested",
  });

  assert.equal(
    result.items[0].assignedPerson.reference.faceId,
    "face.current-reference",
  );
  assert.equal(
    result.items[0].assignedPerson.reference.sourceAssetId,
    "immich.asset.current-reference",
  );
  assert.equal(result.items[0].suggestedPerson.reference.score, 0.9);
  assert.equal(result.items[0].suggestedPerson.confidenceBand, "high");
  assert.deepEqual(result.items[0].suggestedPerson.reviewEvidence, {
    independentReferenceCount: 4,
    top3AverageScore: 0.82,
  });
  assert.equal(
    result.items[0].suggestedPerson.reference.sourceAssetId,
    "immich.asset.suggested-reference",
  );
  assert.match(itemQuery, /source_pack_matching_gallery/);
  assert.match(itemQuery, /current_face_capture_context/);
  assert.match(itemQuery, /item\.suggested_person_id/);
  assert.match(itemQuery, /item\.assigned_person_id/);
  assert.match(itemQuery, /suggested_support\.reference_count/);
  assert.match(itemQuery, /ranked\.evidence_rank <= 3/);
});

test("audit item counts share the row query's guarded predicate", async () => {
  const run = {
    accepted_comparable_faces: 7,
    accepted_embedded_faces: 8,
    audit_run_id: "identity-audit.completed",
    completed_at: "2026-07-25T00:01:00.000Z",
    contradiction_candidates: 1,
    error_code: null,
    margin_floor: 0.21,
    pack_id: "pack.active",
    policy_version: "cimmich-best-prime-v1",
    score_floor: 0,
    started_at: "2026-07-25T00:00:00.000Z",
    state: "completed",
    untagged_candidates: 2,
    untagged_embedded_faces: 20,
  };
  let countQuery = "";
  let itemQuery = "";
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("UPDATE identity_audit_run")) return [];
    if (
      query.includes("SELECT * FROM identity_audit_run") &&
      query.includes("WHERE state = 'completed'")
    ) {
      return [run];
    }
    if (query.includes("SELECT count(*)::int AS total")) {
      countQuery = query;
      return [{ total: 0 }];
    }
    if (query.includes("SELECT item.*")) {
      itemQuery = query;
      return [];
    }
    throw new Error(`Unexpected identity audit query: ${query}`);
  };

  const result = await createIdentityAudit(sql, {
    presentationRank: () => 2,
  }).items({ kind: "untagged_match" });

  assert.equal(result.total, 0);
  assert.equal(result.hasMore, false);
  // A wider count than the guarded rows both leaks hidden-item existence and
  // keeps hasMore true forever ("load more" never terminates). Every guard on
  // the rows must also guard the count.
  for (const guard of [
    /JOIN face_observation face ON face\.face_id = item\.face_id/,
    /JOIN asset ON asset\.asset_id = item\.asset_id/,
    /JOIN face_embedding query_embedding/,
    /JOIN current_person suggested/,
    /face\.state = 'valid'/,
    /asset\.state = 'active'/,
    /cimmich_visibility_asset_rank\(asset\.asset_id\) <=/,
  ]) {
    assert.match(countQuery, guard);
    assert.match(itemQuery, guard);
  }
});

test("audit leads group all open untagged matches by known Person", async () => {
  const run = {
    accepted_comparable_faces: 7,
    accepted_embedded_faces: 8,
    audit_run_id: "identity-audit.completed",
    completed_at: "2026-07-25T00:01:00.000Z",
    contradiction_candidates: 1,
    error_code: null,
    margin_floor: 0.21,
    pack_id: "pack.active",
    policy_version: "cimmich-best-prime-v1",
    score_floor: 0,
    started_at: "2026-07-25T00:00:00.000Z",
    state: "completed",
    untagged_candidates: 7,
    untagged_embedded_faces: 20,
  };
  let leadsQuery = "";
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("UPDATE identity_audit_run")) return [];
    if (
      query.includes("SELECT * FROM identity_audit_run") &&
      query.includes("WHERE state = 'completed'")
    ) {
      return [run];
    }
    if (query.includes("count(*)::int AS suggestion_count")) {
      leadsQuery = query;
      return [
        {
          display_name: "Maya Chen",
          suggested_person_id: "person.vito",
          suggestion_count: 4,
        },
        {
          display_name: "Chili Ctmo",
          suggested_person_id: "person.chili",
          suggestion_count: 3,
        },
      ];
    }
    throw new Error(`Unexpected identity audit query: ${query}`);
  };

  const result = await createIdentityAudit(sql, {
    presentationRank: () => 2,
  }).leads();

  assert.deepEqual(result.items, [
    {
      displayName: "Maya Chen",
      personId: "person.vito",
      suggestionCount: 4,
    },
    {
      displayName: "Chili Ctmo",
      personId: "person.chili",
      suggestionCount: 3,
    },
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.run.stale, false);
  assert.match(leadsQuery, /item\.audit_kind = 'untagged_match'/);
  assert.match(leadsQuery, /item\.review_state = 'open'/);
  assert.match(
    leadsQuery,
    /NOT EXISTS \(\s+SELECT 1 FROM current_face_identity/,
  );
  assert.match(leadsQuery, /ORDER BY suggestion_count DESC/);
});

test("independent evidence suppresses only replay-consistent same-photo candidates", async () => {
  const digest = (character) => character.repeat(64);
  const candidates = [
    {
      asset_id: "asset.same",
      audit_kind: "untagged_match",
      face_id: "face.same",
      query_checksum: digest("1"),
      query_input_revision: digest("2"),
      query_source_asset_id: "immich.same.query",
      reference_asset_id: "asset.same.reference",
      reference_checksum: digest("3"),
      reference_input_revision: digest("4"),
      reference_source_asset_id: "immich.same.reference",
    },
    {
      asset_id: "asset.independent",
      audit_kind: "untagged_match",
      face_id: "face.independent",
      query_checksum: digest("5"),
      query_input_revision: digest("6"),
      query_source_asset_id: "immich.independent.query",
      reference_asset_id: "asset.independent.reference",
      reference_checksum: digest("7"),
      reference_input_revision: digest("8"),
      reference_source_asset_id: "immich.independent.reference",
    },
  ];
  const deleted = [];
  let completed = false;
  let candidateQuery = "";
  const transaction = async (strings, ...values) => {
    const query = strings.join(" ");
    if (query.includes("DELETE FROM identity_audit_item")) {
      deleted.push(values[2]);
      return [];
    }
    if (query.includes("UPDATE identity_audit_run")) {
      completed = true;
      return [];
    }
    throw new Error(`Unexpected transaction query: ${query}`);
  };
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("SELECT item.audit_kind")) {
      candidateQuery = query;
      return candidates;
    }
    throw new Error(`Unexpected identity evidence query: ${query}`);
  };
  sql.begin = async (callback) => callback(transaction);
  const comparisons = [];
  const provider = {
    manifest: { providerConfigDigest: digest("a") },
    compare: async ({ leftBytes, runId }) => {
      comparisons.push(runId);
      return {
        similarity: leftBytes.toString().includes(".same.") ? 1 : 0.5,
      };
    },
  };

  await suppressSamePhotoDerivatives(sql, {
    companion: {
      readAssetImage: async ({ assetId }) => ({
        bytes: Buffer.from(assetId),
      }),
    },
    provider,
    runId: "audit.test",
    sourceId: "legacy-archive-immich",
  });

  assert.deepEqual(deleted, ["face.same"]);
  assert.equal(comparisons.length, 4);
  assert.equal(completed, true);
  assert.match(candidateQuery, /audit_kind = 'accepted_contradiction'/);
  assert.match(candidateQuery, /query_projection\.source_id/);
  assert.match(candidateQuery, /reference_projection\.source_id/);
});

test("full audit bounds both comparison frontiers deterministically and reports truncation", async () => {
  const source = await readFile(
    new URL("../src/identity-audit.mjs", import.meta.url),
    "utf8",
  );
  // Both full-audit statements (untagged_match and accepted_contradiction)
  // rank their eligible queries and cap them with one shared frontier limit.
  assert.equal((source.match(/LIMIT \$\{frontierLimit\}/g) || []).length, 2);
  assert.equal(
    (source.match(/eligible_queries AS MATERIALIZED/g) || []).length,
    2,
  );
  assert.equal(
    (
      source.match(
        /ORDER BY eligible\.quality_score DESC,\s+eligible\.detection_confidence DESC, eligible\.face_id/g,
      ) || []
    ).length,
    2,
  );
  // The frontier is applied after the weaker-duplicate overlap suppression so
  // bounding can never change which detections suppress each other.
  assert.ok(
    source.indexOf("eligible_queries AS MATERIALIZED") <
      source.indexOf("stronger.asset_id = candidate.asset_id"),
  );
  // Truncation is observable, never silent, and the default bound sits far
  // above realistic library sizes so default behavior is unchanged.
  assert.match(source, /IDENTITY_AUDIT_QUERY_FRONTIER_TRUNCATED/);
  assert.ok(identityAuditQueryFrontierLimit >= 50_000);
});

test("independence verification honors the configured bound and concurrency", async () => {
  const digest = (character) => character.repeat(64);
  const candidate = (name, offset) => ({
    asset_id: `asset.${name}`,
    audit_kind: "untagged_match",
    face_id: `face.${name}`,
    query_checksum: digest(String(offset)),
    query_input_revision: digest(String(offset + 1)),
    query_source_asset_id: `immich.${name}.query`,
    reference_asset_id: `asset.${name}.reference`,
    reference_checksum: digest(String(offset + 2)),
    reference_input_revision: digest(String(offset + 3)),
    reference_source_asset_id: `immich.${name}.reference`,
  });
  const candidates = [
    candidate("first", 1),
    candidate("second", 5),
    candidate("third", 9),
  ];
  const transaction = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("UPDATE identity_audit_run")) return [];
    throw new Error(`Unexpected transaction query: ${query}`);
  };
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("SELECT item.audit_kind")) return candidates;
    throw new Error(`Unexpected identity evidence query: ${query}`);
  };
  sql.begin = async (callback) => callback(transaction);
  const comparedRuns = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const provider = {
    manifest: { providerConfigDigest: digest("a") },
    compare: async ({ runId }) => {
      comparedRuns.push(runId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return { similarity: 0.5 };
    },
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    await suppressSamePhotoDerivatives(sql, {
      companion: {
        readAssetImage: async ({ assetId }) => ({
          bytes: Buffer.from(assetId),
        }),
      },
      comparisonConcurrency: 1,
      comparisonLimit: 2,
      provider,
      runId: "audit.test",
    });
  } finally {
    console.warn = originalWarn;
  }

  // Two candidates verified (forward + reverse each), third bounded away.
  assert.equal(comparedRuns.length, 4);
  assert.equal(maxInFlight, 1);
  assert.equal(
    warnings.filter((warning) =>
      warning.includes("IDENTITY_AUDIT_INDEPENDENCE_COMPARISONS_TRUNCATED"),
    ).length,
    1,
  );
});

test("independence replay tolerates last-bit noise without failing the run", async () => {
  const digest = (character) => character.repeat(64);
  const candidates = [
    {
      asset_id: "asset.same",
      audit_kind: "untagged_match",
      face_id: "face.same",
      query_checksum: digest("1"),
      query_input_revision: digest("2"),
      query_source_asset_id: "immich.same.query",
      reference_asset_id: "asset.same.reference",
      reference_checksum: digest("3"),
      reference_input_revision: digest("4"),
      reference_source_asset_id: "immich.same.reference",
    },
    {
      asset_id: "asset.independent",
      audit_kind: "untagged_match",
      face_id: "face.independent",
      query_checksum: digest("5"),
      query_input_revision: digest("6"),
      query_source_asset_id: "immich.independent.query",
      reference_asset_id: "asset.independent.reference",
      reference_checksum: digest("7"),
      reference_input_revision: digest("8"),
      reference_source_asset_id: "immich.independent.reference",
    },
  ];
  const deleted = [];
  const transaction = async (strings, ...values) => {
    const query = strings.join(" ");
    if (query.includes("DELETE FROM identity_audit_item")) {
      deleted.push(values[2]);
      return [];
    }
    if (query.includes("UPDATE identity_audit_run")) return [];
    throw new Error(`Unexpected transaction query: ${query}`);
  };
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("SELECT item.audit_kind")) return candidates;
    throw new Error(`Unexpected identity evidence query: ${query}`);
  };
  sql.begin = async (callback) => callback(transaction);
  const provider = {
    manifest: { providerConfigDigest: digest("a") },
    // Replays of the same byte pair differ in the last float bits: the
    // forward and reverse runs disagree by well under the documented epsilon
    // and must neither fail the run nor change the same-photo decision.
    compare: async ({ leftBytes }) => {
      const marker = leftBytes.toString();
      if (marker.includes(".same.")) {
        return { similarity: marker.includes(".query") ? 1 - 5e-7 : 1 };
      }
      return { similarity: marker.includes(".query") ? 0.5 : 0.5 + 5e-8 };
    },
  };

  await suppressSamePhotoDerivatives(sql, {
    companion: {
      readAssetImage: async ({ assetId }) => ({ bytes: Buffer.from(assetId) }),
    },
    provider,
    runId: "audit.test",
  });

  assert.deepEqual(deleted, ["face.same"]);
});

test("independence replay still rejects a real similarity disagreement", async () => {
  const digest = (character) => character.repeat(64);
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("SELECT item.audit_kind")) {
      return [
        {
          asset_id: "asset.disagreeing",
          audit_kind: "untagged_match",
          face_id: "face.disagreeing",
          query_checksum: digest("1"),
          query_input_revision: digest("2"),
          query_source_asset_id: "immich.disagreeing.query",
          reference_asset_id: "asset.disagreeing.reference",
          reference_checksum: digest("3"),
          reference_input_revision: digest("4"),
          reference_source_asset_id: "immich.disagreeing.reference",
        },
      ];
    }
    throw new Error(`Unexpected identity evidence query: ${query}`);
  };
  sql.begin = async () => {
    throw new Error("A disagreeing replay must never reach the commit");
  };

  await assert.rejects(
    suppressSamePhotoDerivatives(sql, {
      companion: {
        readAssetImage: async ({ assetId }) => ({
          bytes: Buffer.from(assetId),
        }),
      },
      provider: {
        manifest: { providerConfigDigest: digest("a") },
        compare: async ({ leftBytes }) => ({
          similarity: leftBytes.toString().includes(".query") ? 0.5 : 0.7,
        }),
      },
      runId: "audit.test",
    }),
    (error) => error.code === "IDENTITY_AUDIT_INDEPENDENCE_REPLAY_FAILED",
  );
});
