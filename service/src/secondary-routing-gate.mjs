import { digestValue } from "./source-pack.mjs";

export const secondaryRoutingGateSchemaVersion =
  "cimmich.secondary-routing-gate.v1";
export const secondaryRoutingGateVersion = "cimmich-secondary-routing-gate-v1";

const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
};

const integer = (value, label, minimum = 0) => {
  const number = finite(value, label);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}`);
  }
  return number;
};

const percentage = (value, label) => {
  const number = finite(value, label);
  if (number < 0 || number > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
  return number;
};

const text = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const normalizeMetrics = (metrics = {}) => {
  const normalized = {
    baselineCorrect: integer(
      metrics.baselineCorrect,
      "metrics.baselineCorrect",
    ),
    changedWinners: integer(metrics.changedWinners, "metrics.changedWinners"),
    conditionedCorrect: integer(
      metrics.conditionedCorrect,
      "metrics.conditionedCorrect",
    ),
    falseFlips: integer(metrics.falseFlips, "metrics.falseFlips"),
    ordinaryBaselineCorrect: integer(
      metrics.ordinaryBaselineCorrect,
      "metrics.ordinaryBaselineCorrect",
    ),
    ordinaryConditionedCorrect: integer(
      metrics.ordinaryConditionedCorrect,
      "metrics.ordinaryConditionedCorrect",
    ),
    ordinaryQueries: integer(
      metrics.ordinaryQueries,
      "metrics.ordinaryQueries",
      1,
    ),
    queries: integer(metrics.queries, "metrics.queries", 1),
    rescues: integer(metrics.rescues, "metrics.rescues"),
    secondaryRouted: integer(
      metrics.secondaryRouted,
      "metrics.secondaryRouted",
    ),
  };
  for (const key of [
    "baselineCorrect",
    "changedWinners",
    "conditionedCorrect",
    "falseFlips",
    "rescues",
    "secondaryRouted",
  ]) {
    if (normalized[key] > normalized.queries) {
      throw new Error(`metrics.${key} cannot exceed metrics.queries`);
    }
  }
  for (const key of ["ordinaryBaselineCorrect", "ordinaryConditionedCorrect"]) {
    if (normalized[key] > normalized.ordinaryQueries) {
      throw new Error(`metrics.${key} cannot exceed metrics.ordinaryQueries`);
    }
  }
  if (
    normalized.conditionedCorrect - normalized.baselineCorrect !==
    normalized.rescues - normalized.falseFlips
  ) {
    throw new Error("Secondary transition counts contradict correct totals");
  }
  return {
    ...normalized,
    falseFlipRatePercent: (100 * normalized.falseFlips) / normalized.queries,
    netGain: normalized.rescues - normalized.falseFlips,
    ordinaryAccuracyDeltaPoints:
      (100 *
        (normalized.ordinaryConditionedCorrect -
          normalized.ordinaryBaselineCorrect)) /
      normalized.ordinaryQueries,
  };
};

export const validateSecondaryRoutingGateReceipt = (
  receipt,
  expectedPackId = "",
) => {
  if (receipt?.schemaVersion !== secondaryRoutingGateSchemaVersion) {
    throw new Error(
      `Secondary gate schema must be ${secondaryRoutingGateSchemaVersion}`,
    );
  }
  const packId = text(receipt.packId, "packId");
  if (expectedPackId && packId !== expectedPackId) {
    throw new Error("Secondary gate receipt targets the wrong pack");
  }
  if (!/^[0-9a-f]{64}$/.test(String(receipt.cohortDigest || ""))) {
    throw new Error("Secondary gate receipt requires a SHA-256 cohort digest");
  }
  if (receipt.authorityScope !== "human-review") {
    throw new Error(
      "Secondary routing cannot grant automatic identity authority",
    );
  }
  if (
    receipt?.leakage?.passed !== true ||
    Number(receipt?.leakage?.queryReferenceOverlap) !== 0
  ) {
    throw new Error("Secondary routing receipt is not leakage-safe");
  }
  const policy = {
    policyVersion: text(receipt?.policy?.policyVersion, "policy.policyVersion"),
    threshold: finite(receipt?.policy?.threshold, "policy.threshold"),
    weight: finite(receipt?.policy?.weight, "policy.weight"),
  };
  if (
    policy.threshold < 0 ||
    policy.threshold > 1 ||
    policy.weight < 0 ||
    policy.weight > 1
  ) {
    throw new Error(
      "Secondary routing policy values must be between zero and one",
    );
  }
  const metrics = normalizeMetrics(receipt.metrics);
  const thresholds = {
    maximumFalseFlipRatePercent: percentage(
      receipt?.thresholds?.maximumFalseFlipRatePercent,
      "thresholds.maximumFalseFlipRatePercent",
    ),
    maximumOrdinaryAccuracyDropPoints: percentage(
      receipt?.thresholds?.maximumOrdinaryAccuracyDropPoints,
      "thresholds.maximumOrdinaryAccuracyDropPoints",
    ),
    minimumNetGain: integer(
      receipt?.thresholds?.minimumNetGain,
      "thresholds.minimumNetGain",
    ),
    minimumQueries: integer(
      receipt?.thresholds?.minimumQueries,
      "thresholds.minimumQueries",
      1,
    ),
  };
  const passed =
    metrics.queries >= thresholds.minimumQueries &&
    metrics.netGain >= thresholds.minimumNetGain &&
    metrics.falseFlipRatePercent <= thresholds.maximumFalseFlipRatePercent &&
    metrics.ordinaryAccuracyDeltaPoints >=
      -thresholds.maximumOrdinaryAccuracyDropPoints;
  if (!new Set(["failed", "passed"]).has(receipt.status)) {
    throw new Error("Secondary gate status must be passed or failed");
  }
  if ((receipt.status === "passed") !== passed) {
    throw new Error("Secondary gate status contradicts its frozen thresholds");
  }
  return {
    authorityScope: "human-review",
    cohortDigest: receipt.cohortDigest,
    leakage: { ...receipt.leakage, passed: true, queryReferenceOverlap: 0 },
    metrics,
    packId,
    policy,
    schemaVersion: secondaryRoutingGateSchemaVersion,
    split: receipt.split || {},
    status: passed ? "passed" : "failed",
    thresholds,
  };
};

export const persistSecondaryRoutingGateReceipt = async (
  sql,
  receiptInput,
  { execute = false } = {},
) => {
  const receipt = validateSecondaryRoutingGateReceipt(receiptInput);
  const evaluationId = `evaluation_${digestValue(receipt).slice(0, 32)}`;
  if (!execute) return { created: false, evaluationId, execute, receipt };
  return sql.begin(async (tx) => {
    const [pack] = await tx`
      SELECT pack_id, state FROM source_pack WHERE pack_id = ${receipt.packId} FOR UPDATE
    `;
    if (!pack) throw new Error(`SourcePack not found: ${receipt.packId}`);
    if (!new Set(["proposed", "shadow"]).has(pack.state)) {
      throw new Error(`Secondary gate cannot rewrite state ${pack.state}`);
    }
    const now = new Date();
    const producerReceiptId = "receipt_cimmich_secondary_routing_gate_v1";
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, privacy_class
      ) VALUES (
        ${producerReceiptId}, 'system', 'cimmich-secondary-routing-gate', 'v1',
        ${now}, ${now}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
    `;
    const inserted = await tx`
      INSERT INTO source_pack_evaluation (
        evaluation_id, pack_id, evaluator_version, split_definition,
        cohort_digest, leakage_assertions, metrics, status,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${evaluationId}, ${receipt.packId}, ${secondaryRoutingGateVersion},
        ${tx.json(receipt.split)}, ${receipt.cohortDigest},
        ${tx.json(receipt.leakage)},
        ${tx.json({
          authorityScope: receipt.authorityScope,
          metrics: receipt.metrics,
          policy: receipt.policy,
          thresholds: receipt.thresholds,
        })},
        ${receipt.status}, ${producerReceiptId}, 'private'
      ) ON CONFLICT (evaluation_id) DO NOTHING
      RETURNING evaluation_id
    `;
    return { created: inserted.length === 1, evaluationId, execute, receipt };
  });
};
