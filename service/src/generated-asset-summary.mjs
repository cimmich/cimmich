import { createHash } from "node:crypto";

const receiptId = "receipt_cimmich_generated_asset_summary_v1";
const tierSet = new Set(["smart", "enhanced"]);
const digestPattern = /^[0-9a-f]{64}$/;

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const cleanText = (value, label, maximum) => {
  const text = String(value || "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (
    !text ||
    text.length > maximum ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)
  ) {
    throw typedError(
      `${label} is invalid`,
      400,
      "GENERATED_SUMMARY_INPUT_INVALID",
    );
  }
  return text;
};

const cleanStringList = (value, label, maximumItems, maximumLength = 240) => {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw typedError(
      `${label} is invalid`,
      400,
      "GENERATED_SUMMARY_INPUT_INVALID",
    );
  }
  return [
    ...new Set(value.map((item) => cleanText(item, label, maximumLength))),
  ];
};

export const normalizeGeneratedVisualFacts = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "visual facts are invalid",
      400,
      "GENERATED_SUMMARY_INPUT_INVALID",
    );
  }
  const peopleCountEstimate = Number(value.peopleCountEstimate);
  if (
    !Number.isInteger(peopleCountEstimate) ||
    peopleCountEstimate < 0 ||
    peopleCountEstimate > 100
  ) {
    throw typedError(
      "people count is invalid",
      400,
      "GENERATED_SUMMARY_INPUT_INVALID",
    );
  }
  return {
    activities: cleanStringList(value.activities, "activities", 12),
    objects: cleanStringList(value.objects, "objects", 24),
    peopleCountEstimate,
    qualityFlags: cleanStringList(value.qualityFlags, "quality flags", 12),
    scene: cleanText(value.scene, "scene", 500),
    summary: cleanText(value.summary, "summary", 1200),
    visibleText: cleanStringList(value.visibleText, "visible text", 30, 500),
  };
};

const exactCommit = (input) => {
  const tier = String(input?.tier || "").trim();
  if (!tierSet.has(tier)) {
    throw typedError(
      "summary tier is invalid",
      400,
      "GENERATED_SUMMARY_TIER_INVALID",
    );
  }
  const sourceAssetId = cleanText(input?.sourceAssetId, "source asset", 120);
  const sourceContentDigest = String(input?.sourceContentDigest || "").trim();
  const configDigest = String(input?.configDigest || "").trim();
  const proposalDigest = String(input?.proposalDigest || "").trim();
  if (
    ![sourceContentDigest, configDigest, proposalDigest].every((value) =>
      digestPattern.test(value),
    )
  ) {
    throw typedError(
      "summary lineage is invalid",
      400,
      "GENERATED_SUMMARY_LINEAGE_INVALID",
    );
  }
  return {
    configDigest,
    modelDigest: cleanText(input?.modelDigest, "model digest", 240),
    modelName: cleanText(input?.modelName, "model name", 240),
    proposalDigest,
    providerId: cleanText(input?.providerId, "provider", 160),
    sourceAssetId,
    sourceContentDigest,
    tier,
    visualFacts: normalizeGeneratedVisualFacts(input?.visualFacts),
  };
};

const stableId = (input) =>
  `summaryanalysis_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32)}`;

const projectRow = (row, currentInputRevision) => ({
  analysisId: row.summary_analysis_id,
  configDigest: row.config_digest,
  createdAt: new Date(row.created_at).toISOString(),
  current: row.asset_input_revision === currentInputRevision,
  model: {
    digest: row.model_digest,
    name: row.model_name,
    providerId: row.provider_id,
  },
  proposalDigest: row.proposal_digest,
  sourceContentDigest: row.source_content_digest,
  tier: row.tier,
  visualFacts: row.visual_facts,
});

export const createGeneratedAssetSummaryStore = (
  sql,
  { resolveVisibleAssetDisplay },
) => ({
  async commitFromLocalAi(input) {
    const normalized = exactCommit(input);
    const linked = await resolveVisibleAssetDisplay(normalized.sourceAssetId);
    const [projection] = await sql`
      SELECT input_revision
      FROM immich_asset_projection
      WHERE cimmich_asset_id = ${linked.assetId} AND state = 'active'
      LIMIT 1
    `;
    if (!projection) {
      throw typedError(
        "Cimmich asset projection not found",
        404,
        "GENERATED_SUMMARY_ASSET_NOT_FOUND",
      );
    }
    const summaryAnalysisId = stableId({
      assetId: linked.assetId,
      assetInputRevision: projection.input_revision,
      proposalDigest: normalized.proposalDigest,
      tier: normalized.tier,
    });
    const [same] = await sql`
      SELECT summary_analysis_id
      FROM current_generated_asset_summary_analysis
      WHERE asset_id = ${linked.assetId} AND tier = ${normalized.tier}
        AND asset_input_revision = ${projection.input_revision}
        AND proposal_digest = ${normalized.proposalDigest}
      LIMIT 1
    `;
    if (same)
      return { changed: false, summaryAnalysisId: same.summary_analysis_id };

    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE generated_asset_summary_analysis
        SET state = 'superseded'
        WHERE asset_id = ${linked.assetId} AND tier = ${normalized.tier}
          AND state = 'current'
      `;
      await transaction`
        INSERT INTO generated_asset_summary_analysis (
          summary_analysis_id, asset_id, asset_input_revision, tier, visual_facts,
          source_content_digest, provider_id, model_name, model_digest,
          config_digest, proposal_digest, provenance, state, producer_receipt_id
        ) VALUES (
          ${summaryAnalysisId}, ${linked.assetId}, ${projection.input_revision},
          ${normalized.tier}, ${transaction.json(normalized.visualFacts)},
          ${normalized.sourceContentDigest}, ${normalized.providerId},
          ${normalized.modelName}, ${normalized.modelDigest}, ${normalized.configDigest},
          ${normalized.proposalDigest}, 'local_model', 'current', ${receiptId}
        )
        ON CONFLICT (summary_analysis_id) DO UPDATE SET state = 'current'
      `;
    });
    return { changed: true, summaryAnalysisId };
  },

  async projectCurrentAsset({ assetId, inputRevision }) {
    const rows = await sql`
      SELECT summary_analysis_id, asset_input_revision, tier, visual_facts,
        source_content_digest, provider_id, model_name, model_digest,
        config_digest, proposal_digest, created_at
      FROM current_generated_asset_summary_analysis
      WHERE asset_id = ${assetId}
      ORDER BY tier
    `;
    return {
      enhanced: rows.find((row) => row.tier === "enhanced")
        ? projectRow(
            rows.find((row) => row.tier === "enhanced"),
            inputRevision,
          )
        : null,
      schemaVersion: "cimmich.generated-asset-summary.v1",
      smart: rows.find((row) => row.tier === "smart")
        ? projectRow(
            rows.find((row) => row.tier === "smart"),
            inputRevision,
          )
        : null,
    };
  },
});
