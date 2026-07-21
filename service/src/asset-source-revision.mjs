import { createHash } from "node:crypto";

export const assetSourceRevisionSchemaVersion =
  "cimmich.asset-source-revision.v1";
export const assetSourceRevisionReceiptSchemaVersion =
  "cimmich.asset-source-revision-receipt.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const privateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const sourceAccessValues = new Set([
  "immich_api_read_only",
  "operator_local_read_only",
]);
const preparedReads = new WeakSet();
const preparedBindings = new WeakMap();
const validatedReads = new WeakSet();
const validatedBindings = new WeakMap();

const typedError = (code, message, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const requiredPrivateId = (value, label) => {
  if (typeof value !== "string" || !privateIdPattern.test(value)) {
    throw typedError(
      "ASSET_SOURCE_REVISION_INPUT_INVALID",
      `${label} is invalid`,
    );
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(
      "ASSET_SOURCE_REVISION_INPUT_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
};

const requiredSourceAccess = (value) => {
  if (!sourceAccessValues.has(value)) {
    throw typedError(
      "ASSET_SOURCE_REVISION_INPUT_INVALID",
      "sourceAccess is invalid",
    );
  }
  return value;
};

const canonicalDigest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const issuePreparedRead = ({
  assetId,
  expectedRevisionId,
  sourceAccess,
  sourceBindingDigest,
}) => {
  const core = {
    assetId,
    expectedRevisionId,
    schemaVersion: assetSourceRevisionSchemaVersion,
    sourceAccess,
    sourceBindingDigest,
  };
  const prepared = deepFreeze({
    ...core,
    preparationDigest: canonicalDigest(core),
  });
  preparedBindings.set(prepared, deepFreeze(core));
  preparedReads.add(prepared);
  return prepared;
};

const consumePrepared = (value) => {
  if (!preparedReads.has(value) || !preparedBindings.has(value)) {
    throw typedError(
      "ASSET_SOURCE_REVISION_ENVELOPE_INVALID",
      "An exact prepared source-read envelope is required",
    );
  }
  return preparedBindings.get(value);
};

export const completeAssetSourceRead = ({ bytes, prepared }) => {
  const binding = consumePrepared(prepared);
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1024 ** 3) {
    throw typedError(
      "ASSET_SOURCE_REVISION_INPUT_INVALID",
      "source bytes must be a non-empty Buffer no larger than 1 GiB",
    );
  }
  const sourceContentDigest = createHash("sha256").update(bytes).digest("hex");
  const inputRevision = canonicalDigest({
    assetId: binding.assetId,
    byteLength: bytes.length,
    schemaVersion: assetSourceRevisionSchemaVersion,
    sourceAccess: binding.sourceAccess,
    sourceBindingDigest: binding.sourceBindingDigest,
    sourceContentDigest,
  });
  const revisionId = `source_revision_${canonicalDigest({
    assetId: binding.assetId,
    inputRevision,
    sourceAccess: binding.sourceAccess,
    sourceBindingDigest: binding.sourceBindingDigest,
  }).slice(0, 40)}`;
  const core = {
    assetId: binding.assetId,
    byteLength: bytes.length,
    expectedRevisionId: binding.expectedRevisionId,
    inputRevision,
    revisionId,
    schemaVersion: assetSourceRevisionSchemaVersion,
    sourceAccess: binding.sourceAccess,
    sourceBindingDigest: binding.sourceBindingDigest,
    sourceContentDigest,
  };
  const envelope = deepFreeze({
    ...core,
    validationDigest: canonicalDigest(core),
  });
  validatedBindings.set(envelope, deepFreeze(core));
  validatedReads.add(envelope);
  return envelope;
};

export const consumeValidatedAssetSourceRead = (value) => {
  if (!validatedReads.has(value) || !validatedBindings.has(value)) {
    throw typedError(
      "ASSET_SOURCE_REVISION_ENVELOPE_INVALID",
      "An exact validated source-read envelope is required",
    );
  }
  return validatedBindings.get(value);
};

export const createAssetSourceRevisionReceipt = (value) => {
  const binding = consumeValidatedAssetSourceRead(value);
  const core = {
    authority: {
      databaseWrite: "none",
      identity: "none",
      providerExecution: "none",
    },
    boundary: {
      currentStateMeaning: "current_at_last_validated_read",
      immichWrite: "none",
      mediaWrite: "none",
      sourceAccess: binding.sourceAccess,
    },
    inputRevision: binding.inputRevision,
    revisionId: binding.revisionId,
    schemaVersion: assetSourceRevisionReceiptSchemaVersion,
    validationDigest: value.validationDigest,
  };
  return deepFreeze({ ...core, receiptDigest: canonicalDigest(core) });
};

export const createAssetSourceRevisionRepository = (
  sql,
  { presentationRank },
) => {
  if (typeof sql !== "function" || typeof presentationRank !== "function") {
    throw new TypeError(
      "Asset source revision requires SQL and visibility rank",
    );
  }
  return Object.freeze({
    async prepare({
      assetId: assetIdInput,
      sourceAccess,
      sourceBindingDigest,
    }) {
      const assetId = requiredPrivateId(assetIdInput, "assetId");
      const access = requiredSourceAccess(sourceAccess);
      const bindingDigest = requiredDigest(
        sourceBindingDigest,
        "sourceBindingDigest",
      );
      const visibleRank = presentationRank();
      if (
        !Number.isSafeInteger(visibleRank) ||
        visibleRank < 0 ||
        visibleRank > 2
      ) {
        throw typedError(
          "ASSET_SOURCE_REVISION_INPUT_INVALID",
          "presentation rank is invalid",
        );
      }
      const rows = await sql`
        SELECT asset.asset_id, head.revision_id
        FROM asset
        LEFT JOIN asset_source_revision_head head
          ON head.asset_id = asset.asset_id
          AND head.source_access = ${access}
          AND head.source_binding_digest = ${bindingDigest}
        WHERE asset.asset_id = ${assetId} AND asset.state = 'active'
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
      `;
      if (rows.length !== 1) {
        throw typedError(
          "ASSET_SOURCE_REVISION_UNAVAILABLE",
          "Visible active asset source is unavailable",
          404,
        );
      }
      return issuePreparedRead({
        assetId,
        expectedRevisionId: rows[0].revision_id || null,
        sourceAccess: access,
        sourceBindingDigest: bindingDigest,
      });
    },
  });
};

export const commitValidatedAssetSourceRead = async (
  tx,
  { presentationRank, sourceRead },
) => {
  const binding = consumeValidatedAssetSourceRead(sourceRead);
  const visibleRank = presentationRank();
  if (
    !Number.isSafeInteger(visibleRank) ||
    visibleRank < 0 ||
    visibleRank > 2
  ) {
    throw typedError(
      "ASSET_SOURCE_REVISION_INPUT_INVALID",
      "presentation rank is invalid",
    );
  }
  const assets = await tx`
    SELECT asset_id FROM asset
    WHERE asset_id = ${binding.assetId} AND state = 'active'
      AND cimmich_visibility_asset_rank(asset_id) <= ${visibleRank}
    FOR SHARE
  `;
  if (assets.length !== 1) {
    throw typedError(
      "ASSET_SOURCE_REVISION_STALE",
      "Visible active asset source is unavailable",
      409,
    );
  }
  const heads = await tx`
    SELECT revision_id FROM asset_source_revision_head
    WHERE asset_id = ${binding.assetId}
      AND source_access = ${binding.sourceAccess}
      AND source_binding_digest = ${binding.sourceBindingDigest}
    FOR UPDATE
  `;
  if (heads.length > 1) {
    throw typedError(
      "ASSET_SOURCE_REVISION_CONFLICT",
      "Asset source head is ambiguous",
      409,
    );
  }
  const currentRevisionId = heads[0]?.revision_id || null;
  if (
    currentRevisionId !== binding.revisionId &&
    currentRevisionId !== binding.expectedRevisionId
  ) {
    throw typedError(
      "ASSET_SOURCE_REVISION_STALE",
      "Asset source head changed after preparation",
      409,
    );
  }
  await tx`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      config_digest, started_at, completed_at, result_digest, privacy_class
    ) VALUES (
      ${`receipt_${binding.revisionId}`}, 'system',
      'cimmich-asset-source-read', 'v1', ${binding.sourceBindingDigest},
      now(), now(), ${sourceRead.validationDigest}, 'private'
    ) ON CONFLICT (producer_receipt_id) DO NOTHING
  `;
  await tx`
    INSERT INTO asset_source_revision (
      revision_id, asset_id, source_access, source_binding_digest,
      input_revision, source_content_digest, byte_length, producer_receipt_id
    ) VALUES (
      ${binding.revisionId}, ${binding.assetId}, ${binding.sourceAccess},
      ${binding.sourceBindingDigest}, ${binding.inputRevision},
      ${binding.sourceContentDigest}, ${binding.byteLength},
      ${`receipt_${binding.revisionId}`}
    ) ON CONFLICT (revision_id) DO NOTHING
  `;
  const revisions = await tx`
    SELECT asset_id, source_access, source_binding_digest, input_revision,
      source_content_digest, byte_length
    FROM asset_source_revision WHERE revision_id = ${binding.revisionId}
  `;
  if (
    revisions.length !== 1 ||
    revisions[0].asset_id !== binding.assetId ||
    revisions[0].source_access !== binding.sourceAccess ||
    revisions[0].source_binding_digest !== binding.sourceBindingDigest ||
    revisions[0].input_revision !== binding.inputRevision ||
    revisions[0].source_content_digest !== binding.sourceContentDigest ||
    Number(revisions[0].byte_length) !== binding.byteLength
  ) {
    throw typedError(
      "ASSET_SOURCE_REVISION_CONFLICT",
      "Stable asset source revision conflicts",
      409,
    );
  }
  if (currentRevisionId !== binding.revisionId) {
    await tx`
      INSERT INTO asset_source_revision_head (
        asset_id, source_access, source_binding_digest, revision_id
      ) VALUES (
        ${binding.assetId}, ${binding.sourceAccess},
        ${binding.sourceBindingDigest}, ${binding.revisionId}
      ) ON CONFLICT (asset_id, source_access, source_binding_digest)
      DO UPDATE SET revision_id = excluded.revision_id, updated_at = now()
    `;
  }
  return binding;
};
