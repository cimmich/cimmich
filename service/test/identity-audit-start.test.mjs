import assert from "node:assert/strict";
import test from "node:test";

import {
  createIdentityAudit,
  identityAuditInterruptThresholdMs,
  identityAuditTransactionTimeoutMs,
  suppressSamePhotoDerivatives,
} from "../src/identity-audit.mjs";

// start() drives the audit lifecycle: reconcile, incremental gating, the
// concurrent-start race and the failure path. These tests pin that behavior
// through a scripted sql mock instead of regexing the source.

const digest = (character) => character.repeat(64);

const packRow = {
  margin_floor: 0.21,
  pack_id: "pack.active",
  policy_version: "cimmich-best-prime-v1",
  score_floor: 0.5,
};

const runRow = (overrides = {}) => ({
  accepted_comparable_faces: 0,
  accepted_embedded_faces: 0,
  audit_run_id: "identity-audit.existing",
  completed_at: null,
  contradiction_candidates: 0,
  error_code: null,
  margin_floor: 0.21,
  pack_id: "pack.active",
  policy_version: "cimmich-best-prime-v1",
  score_floor: 0.5,
  started_at: "2026-07-30T00:00:00.000Z",
  state: "running",
  untagged_candidates: 0,
  untagged_embedded_faces: 0,
  ...overrides,
});

test("the reconcile sweep thresholds on last progress, derived from the transaction bound", async () => {
  let reconcileQuery = "";
  let reconcileValues = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("IDENTITY_AUDIT_INTERRUPTED")) {
      reconcileQuery = query;
      reconcileValues = values;
      return [];
    }
    if (query.includes("FROM current_source_pack")) return [];
    if (query.includes("SELECT * FROM identity_audit_run")) return [];
    throw new Error(`Unexpected query: ${query}`);
  };
  const audit = createIdentityAudit(sql);

  await audit.latest();

  // A run is only dead once its last recorded progress - not its start - is
  // older than one full transaction bound plus margin. A threshold below the
  // transaction bound failed legitimate long runs and discarded their output.
  assert.match(
    reconcileQuery,
    /coalesce\(last_progress_at, started_at\)\s+< now\(\) - make_interval/,
  );
  assert.deepEqual(reconcileValues, [identityAuditInterruptThresholdMs / 1000]);
  assert.ok(identityAuditInterruptThresholdMs > identityAuditTransactionTimeoutMs);
});

test("the reconcile sweep re-arms after its cadence instead of memoizing forever", async () => {
  let sweeps = 0;
  const sql = async (strings) => {
    const query = strings.join("?");
    if (query.includes("IDENTITY_AUDIT_INTERRUPTED")) {
      sweeps += 1;
      return [];
    }
    if (query.includes("FROM current_source_pack")) return [];
    if (query.includes("SELECT * FROM identity_audit_run")) return [];
    throw new Error(`Unexpected query: ${query}`);
  };
  const audit = createIdentityAudit(sql);
  const realNow = Date.now;
  try {
    let now = realNow();
    Date.now = () => now;
    await audit.latest();
    await audit.latest();
    assert.equal(sweeps, 1);
    now += 16 * 60 * 1000;
    await audit.latest();
    assert.equal(sweeps, 2);
  } finally {
    Date.now = realNow;
  }
});

test("incremental start gates staleness on the base run's start, inclusively", async () => {
  let probeQuery = "";
  let probeValues = [];
  const baseStartedAt = "2026-07-30T01:00:00.000Z";
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("IDENTITY_AUDIT_INTERRUPTED")) return [];
    if (query.includes("matcherPolicy")) return [packRow];
    if (query.includes("FROM current_source_pack")) {
      return [{ pack_id: "pack.active" }];
    }
    if (query.includes("SELECT * FROM identity_audit_run")) {
      return [runRow({ state: "completed", completed_at: "2026-07-30T03:00:00.000Z" })];
    }
    if (query.includes("WHERE state = 'completed'")) {
      return [
        runRow({
          completed_at: "2026-07-30T03:00:00.000Z",
          started_at: baseStartedAt,
          state: "completed",
        }),
      ];
    }
    if (query.includes("FROM identity_claim")) {
      probeQuery = query;
      probeValues = values;
      return [{ present: 1 }];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  const audit = createIdentityAudit(sql);

  await assert.rejects(
    audit.start({ detectorConfigDigest: digest("d") }),
    (error) => error.code === "IDENTITY_AUDIT_INCREMENTAL_BASE_STALE",
  );

  // The base snapshot is taken at ~started_at, not completed_at: claims
  // accepted while the base ran were never audited by it, and an exact-tie
  // timestamp must also invalidate the base.
  assert.match(probeQuery, /created_at >= /);
  assert.deepEqual(probeValues, [baseStartedAt]);
});

test("a concurrent start returns the winning run instead of a raw unique violation", async () => {
  let insertAttempts = 0;
  const sql = async (strings) => {
    const query = strings.join("?");
    if (query.includes("IDENTITY_AUDIT_INTERRUPTED")) return [];
    if (query.includes("matcherPolicy")) return [packRow];
    if (query.includes("FROM current_source_pack")) {
      return [{ pack_id: "pack.active" }];
    }
    if (query.includes("INSERT INTO identity_audit_run")) {
      insertAttempts += 1;
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    if (query.includes("SELECT * FROM identity_audit_run")) {
      // The first latest() sees no run (both starters pass the check); after
      // the losing INSERT the winner's run is visible.
      return insertAttempts === 0 ? [] : [runRow()];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  const audit = createIdentityAudit(sql);

  const result = await audit.start();

  assert.equal(insertAttempts, 1);
  assert.equal(result.state, "running");
  assert.equal(result.auditRunId, "identity-audit.existing");
});

test("an audit failure stores a stable label, logs the error, and guards its recovery write", async () => {
  let recoveryValues = null;
  let recoveryQuery = "";
  let inserted = false;
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("IDENTITY_AUDIT_INTERRUPTED")) return [];
    if (query.includes("matcherPolicy")) return [packRow];
    if (query.includes("FROM current_source_pack")) {
      return [{ pack_id: "pack.active" }];
    }
    if (query.includes("INSERT INTO identity_audit_run")) {
      inserted = true;
      return [];
    }
    if (query.includes("SELECT * FROM identity_audit_run")) {
      return inserted ? [runRow()] : [];
    }
    if (query.includes("SET state = 'failed'")) {
      recoveryQuery = query;
      recoveryValues = values;
      return [];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  // The audit's first transaction dies with a raw driver code; the stored
  // label must stay stable while the log keeps the raw code.
  sql.begin = async () => {
    throw Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
  };
  const logged = [];
  const realError = console.error;
  console.error = (...parts) => logged.push(parts);
  try {
    const audit = createIdentityAudit(sql);
    await audit.start();
    for (let attempt = 0; attempt < 100 && !recoveryValues; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    console.error = realError;
  }

  assert.ok(recoveryValues, "recovery UPDATE never ran");
  assert.match(recoveryQuery, /WHERE audit_run_id = /);
  assert.equal(recoveryValues[0], "IDENTITY_AUDIT_FAILED");
  assert.ok(
    logged.some(
      (parts) =>
        parts[0] === "Cimmich identity audit run failed" &&
        parts[1]?.code === "57014" &&
        String(parts[1]?.message).includes("statement timeout"),
    ),
  );
});

test("a failing recovery write is contained instead of escaping the process", async () => {
  let recoveryAttempted = false;
  let inserted = false;
  const sql = async (strings) => {
    const query = strings.join("?");
    if (query.includes("IDENTITY_AUDIT_INTERRUPTED")) return [];
    if (query.includes("matcherPolicy")) return [packRow];
    if (query.includes("FROM current_source_pack")) {
      return [{ pack_id: "pack.active" }];
    }
    if (query.includes("INSERT INTO identity_audit_run")) {
      inserted = true;
      return [];
    }
    if (query.includes("SELECT * FROM identity_audit_run")) {
      return inserted ? [runRow()] : [];
    }
    if (query.includes("SET state = 'failed'")) {
      recoveryAttempted = true;
      throw new Error("connection lost");
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  sql.begin = async () => {
    throw new Error("database unreachable");
  };
  const logged = [];
  const realError = console.error;
  console.error = (...parts) => logged.push(parts);
  try {
    const audit = createIdentityAudit(sql);
    await audit.start();
    for (
      let attempt = 0;
      attempt < 100 &&
      !logged.some(
        (parts) => parts[0] === "Cimmich identity audit failure recovery failed",
      );
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    console.error = realError;
  }

  assert.equal(recoveryAttempted, true);
  assert.ok(
    logged.some(
      (parts) =>
        parts[0] === "Cimmich identity audit failure recovery failed" &&
        String(parts[1]?.message).includes("connection lost"),
    ),
  );
});

test("the provider phase heartbeats run liveness on its own cadence", async () => {
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
  const heartbeats = [];
  const transaction = async (strings) => {
    const query = strings.join("?");
    if (query.includes("UPDATE identity_audit_run")) return [];
    throw new Error(`Unexpected transaction query: ${query}`);
  };
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("SELECT item.audit_kind")) {
      return [candidate("first", 1), candidate("second", 5)];
    }
    if (query.includes("SET last_progress_at = now()")) {
      heartbeats.push(values);
      return [];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  sql.begin = async (callback) => callback(transaction);
  const realNow = Date.now;
  try {
    let now = realNow();
    Date.now = () => now;
    await suppressSamePhotoDerivatives(sql, {
      companion: {
        readAssetImage: async ({ assetId }) => ({
          bytes: Buffer.from(assetId),
        }),
      },
      comparisonConcurrency: 1,
      provider: {
        manifest: { providerConfigDigest: digest("a") },
        compare: async () => {
          // A slow comparison pushes the loop past the heartbeat cadence, so
          // the next candidate must first refresh last_progress_at.
          now += 61_000;
          return { similarity: 0.5 };
        },
      },
      runId: "audit.heartbeat",
    });
  } finally {
    Date.now = realNow;
  }

  assert.equal(heartbeats.length, 1);
  assert.deepEqual(heartbeats[0], ["audit.heartbeat"]);
});
