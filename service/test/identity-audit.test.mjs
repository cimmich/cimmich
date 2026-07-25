import assert from "node:assert/strict";
import test from "node:test";

import {
  carryForwardIdentityAuditDismissals,
  createIdentityAudit,
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
  assert.match(source, /least\(candidate\.box_w, stronger\.box_w\)[\s\S]*<= 0\.45/);
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

  assert.match(query, /prior\.suggested_person_id = current\.suggested_person_id/);
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
          suggested_reference_score: 0.9,
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
  assert.equal(
    result.items[0].suggestedPerson.reference.sourceAssetId,
    "immich.asset.suggested-reference",
  );
  assert.match(itemQuery, /source_pack_matching_gallery/);
  assert.match(itemQuery, /current_face_capture_context/);
  assert.match(itemQuery, /item\.suggested_person_id/);
  assert.match(itemQuery, /item\.assigned_person_id/);
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
  assert.match(leadsQuery, /NOT EXISTS \(\s+SELECT 1 FROM current_face_identity/);
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
  });

  assert.deepEqual(deleted, ["face.same"]);
  assert.equal(comparisons.length, 4);
  assert.equal(completed, true);
  assert.match(candidateQuery, /audit_kind = 'accepted_contradiction'/);
});
