import { digestValue } from "./source-pack.mjs";

export const sourcePackGateSchemaVersion =
  "cimmich.source-pack-gate-evaluation.v1";
export const sourcePackLifecycleVersion = "cimmich-source-pack-lifecycle-v1";
export const sourcePackMatcherPolicyVersion = "cimmich-best-prime-v1";
export const sourcePackConditionRejectionVersion =
  "cimmich-source-pack-condition-rejection-v1";

const sha256Pattern = /^[0-9a-f]{64}$/;

const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
};

const percentage = (value, label) => {
  const number = finite(value, label);
  if (number < 0 || number > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
  return number;
};

const integer = (value, label, { minimum = 0 } = {}) => {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
  return number;
};

export const validateSourcePackGateReceipt = (receipt, expectedPackId = "") => {
  if (receipt?.schemaVersion !== sourcePackGateSchemaVersion) {
    throw new Error(
      `SourcePack gate schema must be ${sourcePackGateSchemaVersion}`,
    );
  }
  const packId = String(receipt.packId || "").trim();
  if (!packId || (expectedPackId && packId !== expectedPackId)) {
    throw new Error("SourcePack gate receipt targets the wrong pack");
  }
  if (!sha256Pattern.test(String(receipt.cohortDigest || ""))) {
    throw new Error("SourcePack gate receipt requires a SHA-256 cohort digest");
  }
  if (receipt.authorityScope !== "human-review") {
    throw new Error(
      "Automatic identity authority is not supported by this gate",
    );
  }
  if (!new Set(["failed", "passed"]).has(receipt.status)) {
    throw new Error("SourcePack gate status must be passed or failed");
  }
  if (
    receipt?.leakage?.passed !== true ||
    Number(receipt?.leakage?.queryReferenceOverlap) !== 0
  ) {
    throw new Error("SourcePack gate receipt is not leakage-safe");
  }
  const metrics = {
    decisionPrecisionPercent: percentage(
      receipt?.metrics?.decisionPrecisionPercent,
      "metrics.decisionPrecisionPercent",
    ),
    knownCorrectCoveragePercent: percentage(
      receipt?.metrics?.knownCorrectCoveragePercent,
      "metrics.knownCorrectCoveragePercent",
    ),
    unknownFalseAcceptRatePercent: percentage(
      receipt?.metrics?.unknownFalseAcceptRatePercent,
      "metrics.unknownFalseAcceptRatePercent",
    ),
    verifiedUnknowns: integer(
      receipt?.metrics?.verifiedUnknowns,
      "metrics.verifiedUnknowns",
    ),
  };
  const thresholds = {
    minimumDecisionPrecisionPercent: percentage(
      receipt?.thresholds?.minimumDecisionPrecisionPercent,
      "thresholds.minimumDecisionPrecisionPercent",
    ),
    maximumUnknownFalseAcceptRatePercent: percentage(
      receipt?.thresholds?.maximumUnknownFalseAcceptRatePercent,
      "thresholds.maximumUnknownFalseAcceptRatePercent",
    ),
    minimumVerifiedUnknowns: integer(
      receipt?.thresholds?.minimumVerifiedUnknowns,
      "thresholds.minimumVerifiedUnknowns",
      { minimum: 1 },
    ),
  };
  const passed =
    metrics.decisionPrecisionPercent >=
      thresholds.minimumDecisionPrecisionPercent &&
    metrics.unknownFalseAcceptRatePercent <=
      thresholds.maximumUnknownFalseAcceptRatePercent &&
    metrics.verifiedUnknowns >= thresholds.minimumVerifiedUnknowns;
  if ((receipt.status === "passed") !== passed) {
    throw new Error("SourcePack gate status contradicts its frozen thresholds");
  }
  let matcherPolicy = null;
  if (receipt.status === "passed") {
    if (
      receipt?.matcherPolicy?.policyVersion !==
        sourcePackMatcherPolicyVersion ||
      receipt?.matcherPolicy?.scorer !== "best_individual_prime"
    ) {
      throw new Error(
        "Passed SourcePack gate requires the supported matcher policy",
      );
    }
    matcherPolicy = {
      marginFloor: finite(
        receipt.matcherPolicy.marginFloor,
        "matcherPolicy.marginFloor",
      ),
      policyVersion: sourcePackMatcherPolicyVersion,
      scoreFloor: finite(
        receipt.matcherPolicy.scoreFloor,
        "matcherPolicy.scoreFloor",
      ),
      scorer: "best_individual_prime",
    };
    if (
      matcherPolicy.marginFloor < 0 ||
      matcherPolicy.marginFloor > 1 ||
      matcherPolicy.scoreFloor < 0 ||
      matcherPolicy.scoreFloor > 1
    ) {
      throw new Error("SourcePack matcher policy floors must be in [0, 1]");
    }
  }
  return {
    authorityScope: receipt.authorityScope,
    cohortDigest: receipt.cohortDigest,
    leakage: {
      ...(receipt.leakage || {}),
      passed: true,
      queryReferenceOverlap: 0,
    },
    metrics,
    matcherPolicy,
    packId,
    schemaVersion: sourcePackGateSchemaVersion,
    split: receipt.split || {},
    status: passed ? "passed" : "failed",
    thresholds,
  };
};

export const validateSourcePackConditionRejection = (receipt) => {
  if (
    receipt?.schemaVersion !==
    "cimmich.provider-condition-consensus-evaluation.v1"
  ) {
    throw new Error("Condition rejection receipt has the wrong schema");
  }
  const sourcePackId = String(receipt.sourcePackId || "");
  if (!/^[a-z0-9_]{1,96}$/.test(sourcePackId)) {
    throw new Error("Condition rejection requires a bounded SourcePack ID");
  }
  for (const [label, value] of [
    ["receiptDigest", receipt.receiptDigest],
    ["opportunityCohortDigest", receipt.opportunityCohortDigest],
    ["frozenPolicyReceiptDigest", receipt.frozenPolicyReceiptDigest],
  ]) {
    if (!sha256Pattern.test(String(value || ""))) {
      throw new Error(`Condition rejection ${label} must be SHA-256`);
    }
  }
  const core = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receiptDigest"),
  );
  if (digestValue(core) !== receipt.receiptDigest) {
    throw new Error(
      "Condition rejection receipt digest does not match payload",
    );
  }
  if (
    receipt.gate !== "rejected" ||
    receipt.candidatePolicyCount !== 0 ||
    receipt?.selection?.policySelection !==
      "frozen_receipt_replay_without_retuning"
  ) {
    throw new Error("Condition rejection must be a frozen no-retune replay");
  }
  if (
    receipt?.leakage?.passed !== true ||
    receipt?.leakage?.queryReferenceOverlap !== 0
  ) {
    throw new Error("Condition rejection must retain zero-overlap proof");
  }
  if (
    receipt?.authority?.activation !== "none" ||
    receipt?.authority?.automaticIdentityAuthority !== "none" ||
    receipt?.authority?.persistence !== "none" ||
    receipt?.authority?.recommendation !== "none" ||
    receipt?.authority?.training !== "none"
  ) {
    throw new Error("Condition rejection cannot carry matching authority");
  }
  const calibration = receipt.calibration || {};
  const holdout = receipt.untouchedHoldout || {};
  const wouldPass =
    integer(calibration.rescues, "calibration.rescues") >= 2 &&
    integer(calibration.falseFlips, "calibration.falseFlips") === 0 &&
    integer(calibration.independentPairs, "calibration.independentPairs") >=
      2 &&
    finite(holdout.netGain, "untouchedHoldout.netGain") >= 1 &&
    integer(holdout.falseFlips, "untouchedHoldout.falseFlips") === 0 &&
    integer(holdout.changedWinners, "untouchedHoldout.changedWinners") > 0;
  if (wouldPass) {
    throw new Error("Condition rejection contradicts the frozen gate metrics");
  }
  return {
    calibration,
    frozenBaselinePolicyId: String(receipt.frozenBaselinePolicyId || ""),
    frozenPolicyReceiptDigest: receipt.frozenPolicyReceiptDigest,
    leakage: receipt.leakage,
    opportunityCohortDigest: receipt.opportunityCohortDigest,
    policy: receipt.policy,
    receiptDigest: receipt.receiptDigest,
    sourcePackId,
    untouchedHoldout: holdout,
  };
};

export const retireRejectedConditionPolicy = async (
  sql,
  receiptInput,
  { execute = false } = {},
) => {
  const receipt = validateSourcePackConditionRejection(receiptInput);
  const evaluationId = `evaluation_${digestValue({
    kind: sourcePackConditionRejectionVersion,
    receiptDigest: receipt.receiptDigest,
    sourcePackId: receipt.sourcePackId,
  }).slice(0, 32)}`;
  if (!execute) {
    return { changed: false, evaluationId, execute, receipt };
  }
  return sql.begin(async (tx) => {
    const [pack] = await tx`
      SELECT pack_id, pack_digest, state, evaluation_status
      FROM source_pack WHERE pack_id = ${receipt.sourcePackId} FOR UPDATE
    `;
    if (!pack) throw new Error(`SourcePack not found: ${receipt.sourcePackId}`);
    if (!new Set(["active", "retired"]).has(pack.state)) {
      throw new Error(
        `Condition rejection cannot retire SourcePack state ${pack.state}`,
      );
    }
    if (
      receipt.frozenBaselinePolicyId !==
      `sourcepack-${String(pack.pack_digest).slice(0, 16)}`
    ) {
      throw new Error("Condition rejection targets different pack evidence");
    }
    const now = new Date();
    const receiptId = "receipt_cimmich_source_pack_condition_rejection_v1";
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, result_digest, privacy_class
      ) VALUES (
        ${receiptId}, 'system', 'cimmich-source-pack-condition-rejection', 'v1',
        ${now}, ${now}, ${receipt.receiptDigest}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO UPDATE
        SET completed_at = excluded.completed_at,
            result_digest = excluded.result_digest
    `;
    const inserted = await tx`
      INSERT INTO source_pack_evaluation (
        evaluation_id, pack_id, evaluator_version, split_definition,
        cohort_digest, leakage_assertions, metrics, status,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${evaluationId}, ${receipt.sourcePackId},
        ${sourcePackConditionRejectionVersion},
        ${tx.json({ policySelection: "frozen_receipt_replay_without_retuning" })},
        ${receipt.opportunityCohortDigest}, ${tx.json(receipt.leakage)},
        ${tx.json({
          calibration: receipt.calibration,
          frozenPolicyReceiptDigest: receipt.frozenPolicyReceiptDigest,
          policy: receipt.policy,
          receiptDigest: receipt.receiptDigest,
          untouchedHoldout: receipt.untouchedHoldout,
        })},
        'failed', ${receiptId}, 'private'
      ) ON CONFLICT (evaluation_id) DO NOTHING
      RETURNING evaluation_id
    `;
    const changed =
      pack.state !== "retired" || pack.evaluation_status !== "failed";
    await tx`
      UPDATE source_pack
      SET state = 'retired', evaluation_status = 'failed',
          evaluation_summary = ${tx.json({
            evaluationId,
            gate: "rejected",
            opportunityCohortDigest: receipt.opportunityCohortDigest,
            receiptDigest: receipt.receiptDigest,
          })}
      WHERE pack_id = ${receipt.sourcePackId}
    `;
    return {
      changed,
      created: inserted.length === 1,
      evaluationId,
      execute,
      packId: receipt.sourcePackId,
      state: "retired",
      status: "failed",
    };
  });
};

export const persistSourcePackGateReceipt = async (
  sql,
  receiptInput,
  { execute = false } = {},
) => {
  const receipt = validateSourcePackGateReceipt(receiptInput);
  const evaluationId = `evaluation_${digestValue(receipt).slice(0, 32)}`;
  if (!execute) {
    return { created: false, evaluationId, execute, receipt };
  }
  const receiptId = "receipt_cimmich_source_pack_gate_v1";
  return sql.begin(async (tx) => {
    const [pack] = await tx`
      SELECT pack_id, state FROM source_pack WHERE pack_id = ${receipt.packId} FOR UPDATE
    `;
    if (!pack) throw new Error(`SourcePack not found: ${receipt.packId}`);
    if (!["proposed", "shadow"].includes(pack.state)) {
      throw new Error(`SourcePack gate cannot rewrite state ${pack.state}`);
    }
    const now = new Date();
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, privacy_class
      ) VALUES (
        ${receiptId}, 'system', 'cimmich-source-pack-gate', 'v1', ${now}, ${now}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
    `;
    const inserted = await tx`
      INSERT INTO source_pack_evaluation (
        evaluation_id, pack_id, evaluator_version, split_definition,
        cohort_digest, leakage_assertions, metrics, status,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${evaluationId}, ${receipt.packId}, ${sourcePackLifecycleVersion},
        ${tx.json(receipt.split)}, ${receipt.cohortDigest},
        ${tx.json(receipt.leakage)},
        ${tx.json({
          authorityScope: receipt.authorityScope,
          ...receipt.metrics,
          thresholds: receipt.thresholds,
        })},
        ${receipt.status}, ${receiptId}, 'private'
      ) ON CONFLICT (evaluation_id) DO NOTHING
      RETURNING evaluation_id
    `;
    await tx`
      UPDATE source_pack
      SET evaluation_status = ${receipt.status},
          evaluation_summary = ${tx.json({ evaluationId, ...receipt })}
      WHERE pack_id = ${receipt.packId}
    `;
    return {
      created: inserted.length === 1,
      evaluationId,
      execute,
      receipt,
    };
  });
};

export const activateSourcePack = async (
  sql,
  packId,
  { execute = false } = {},
) => {
  if (!execute) return { activated: false, execute, packId };
  return sql.begin(async (tx) => {
    const [candidate] = await tx`
      SELECT pack_id, model_family, model_version, config_digest, state,
        evaluation_status, evaluation_summary
      FROM source_pack WHERE pack_id = ${packId} FOR UPDATE
    `;
    if (!candidate) throw new Error(`SourcePack not found: ${packId}`);
    if (!["proposed", "shadow", "retired"].includes(candidate.state)) {
      throw new Error(
        `SourcePack state ${candidate.state} cannot be activated`,
      );
    }
    if (candidate.evaluation_status !== "passed") {
      throw new Error("SourcePack activation requires a passed gate receipt");
    }
    validateSourcePackGateReceipt(candidate.evaluation_summary, packId);
    const active = await tx`
      SELECT pack_id FROM source_pack
      WHERE state = 'active' AND model_family = ${candidate.model_family}
        AND model_version = ${candidate.model_version}
        AND config_digest = ${candidate.config_digest}
      FOR UPDATE
    `;
    for (const row of active) {
      if (row.pack_id !== packId) {
        await tx`UPDATE source_pack SET state = 'retired' WHERE pack_id = ${row.pack_id}`;
      }
    }
    await tx`UPDATE source_pack SET state = 'active' WHERE pack_id = ${packId}`;
    return {
      activated: true,
      execute,
      packId,
      retiredPackIds: active
        .map((row) => row.pack_id)
        .filter((activePackId) => activePackId !== packId),
    };
  });
};

export const rollbackSourcePack = async (
  sql,
  packId,
  { execute = false } = {},
) => {
  if (!execute) return { execute, packId, rolledBack: false };
  return sql.begin(async (tx) => {
    const [active] = await tx`
      SELECT pack_id, predecessor_pack_id, state
      FROM source_pack WHERE pack_id = ${packId} FOR UPDATE
    `;
    if (!active || active.state !== "active" || !active.predecessor_pack_id) {
      throw new Error(
        "SourcePack rollback requires an active pack with a predecessor",
      );
    }
    const [predecessor] = await tx`
      SELECT pack_id, state, evaluation_status, evaluation_summary
      FROM source_pack WHERE pack_id = ${active.predecessor_pack_id} FOR UPDATE
    `;
    if (!predecessor || predecessor.evaluation_status !== "passed") {
      throw new Error("SourcePack predecessor is not rollback-eligible");
    }
    validateSourcePackGateReceipt(
      predecessor.evaluation_summary,
      predecessor.pack_id,
    );
    await tx`UPDATE source_pack SET state = 'retired' WHERE pack_id = ${packId}`;
    await tx`
      UPDATE source_pack SET state = 'active'
      WHERE pack_id = ${predecessor.pack_id}
    `;
    return {
      execute,
      packId,
      restoredPackId: predecessor.pack_id,
      rolledBack: true,
    };
  });
};
