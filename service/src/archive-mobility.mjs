import { createHash } from "node:crypto";

export const archiveMobilityContractVersion =
  "cimmich.hash-linked-archive-mobility.v1";
export const verifiedContentBindingSchemaVersion =
  "cimmich.verified-content-binding.v1";

const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

const boundedText = (value, name, maximum) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw mobilityError(
      "ARCHIVE_VERIFIED_BINDING_INVALID",
      `Verified content binding requires ${name}`,
    );
  }
  return normalized;
};

const strictBase64Bytes = (value) => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
};

export const normalizeContentFingerprint = (value) => {
  const checksum = String(value || "").trim();
  if (!checksum) return null;

  const prefixed = /^(immich|sha1|sha256):([0-9a-f]+)$/i.exec(checksum);
  if (prefixed) {
    const prefix = prefixed[1].toLowerCase();
    const contentDigest = prefixed[2].toLowerCase();
    const hashAlgorithm = prefix === "immich" ? "sha1" : prefix;
    const expectedLength = hashAlgorithm === "sha1" ? 40 : 64;
    return contentDigest.length === expectedLength
      ? { contentDigest, hashAlgorithm }
      : null;
  }

  if (/^[0-9a-f]{40}$/i.test(checksum)) {
    return { contentDigest: checksum.toLowerCase(), hashAlgorithm: "sha1" };
  }
  if (/^[0-9a-f]{64}$/i.test(checksum)) {
    return { contentDigest: checksum.toLowerCase(), hashAlgorithm: "sha256" };
  }

  const bytes = strictBase64Bytes(checksum);
  if (bytes?.length === 20) {
    return { contentDigest: bytes.toString("hex"), hashAlgorithm: "sha1" };
  }
  if (bytes?.length === 32) {
    return { contentDigest: bytes.toString("hex"), hashAlgorithm: "sha256" };
  }
  return null;
};

export const contentIdForFingerprint = ({ contentDigest, hashAlgorithm }) =>
  `media_content_${digest(`${hashAlgorithm}\u001f${contentDigest}`).slice(0, 40)}`;

export const cimmichAssetIdForContent = (fingerprint) =>
  `asset_content_${digest(
    `${fingerprint.hashAlgorithm}\u001f${fingerprint.contentDigest}`,
  ).slice(0, 40)}`;

export const sourceBindingId = ({ externalAssetId, sourceId, sourceKind }) =>
  `source_binding_${digest(
    `${sourceKind}\u001f${sourceId}\u001f${externalAssetId}`,
  ).slice(0, 40)}`;

const mobilityError = (code, message, details) =>
  Object.assign(new Error(message), { code, ...(details ? { details } : {}) });

export const createHashLinkedAssetResolver = ({
  legacyResolver = null,
  sql,
}) => {
  if (
    !sql ||
    (legacyResolver !== null && typeof legacyResolver !== "function")
  ) {
    throw new Error("Hash-linked asset resolver is not configured");
  }

  return async ({ checksum, immichAssetId, sourceId }) => {
    const fingerprint = normalizeContentFingerprint(checksum);
    if (!fingerprint) {
      const legacyAssetId = legacyResolver
        ? await legacyResolver({ immichAssetId, sourceId })
        : null;
      return legacyAssetId ? String(legacyAssetId) : null;
    }

    const rows = await sql`
      SELECT DISTINCT link.asset_id
      FROM media_content_fingerprint fingerprint
      JOIN asset_content_link link
        ON link.content_id = fingerprint.content_id
        AND link.state = 'active'
      JOIN asset ON asset.asset_id = link.asset_id
        AND asset.state = 'active'
      WHERE fingerprint.hash_algorithm = ${fingerprint.hashAlgorithm}
        AND fingerprint.content_digest = ${fingerprint.contentDigest}
      ORDER BY link.asset_id
      LIMIT 2
    `;
    if (rows.length > 1) {
      throw mobilityError(
        "ARCHIVE_CONTENT_IDENTITY_AMBIGUOUS",
        "Exact content fingerprint resolves to multiple Cimmich assets",
        {
          contentDigest: fingerprint.contentDigest,
          hashAlgorithm: fingerprint.hashAlgorithm,
        },
      );
    }
    return rows.length === 1
      ? String(rows[0].asset_id)
      : cimmichAssetIdForContent(fingerprint);
  };
};

export const bindVerifiedContent = async ({
  actorId,
  byteLength,
  commandId,
  contentDigest,
  externalAssetId,
  hashAlgorithm,
  schemaVersion,
  sourceId,
  sourceKind,
  sql,
}) => {
  if (!sql || typeof sql.begin !== "function") {
    throw new Error("Verified content binding requires a Cimmich database");
  }
  const command = {
    actorId: boundedText(actorId, "actorId", 200),
    byteLength: Number(byteLength),
    commandId: boundedText(commandId, "commandId", 200),
    contentDigest: String(contentDigest || "")
      .trim()
      .toLowerCase(),
    externalAssetId: boundedText(externalAssetId, "externalAssetId", 500),
    hashAlgorithm: String(hashAlgorithm || "")
      .trim()
      .toLowerCase(),
    schemaVersion: String(schemaVersion || "").trim(),
    sourceId: boundedText(sourceId, "sourceId", 120),
    sourceKind: String(sourceKind || "").trim(),
  };
  if (command.schemaVersion !== verifiedContentBindingSchemaVersion) {
    throw mobilityError(
      "ARCHIVE_VERIFIED_BINDING_INVALID",
      "Verified content binding schemaVersion is unsupported",
    );
  }
  if (command.sourceKind !== "immich") {
    throw mobilityError(
      "ARCHIVE_VERIFIED_BINDING_INVALID",
      "Verified content binding sourceKind must be immich",
    );
  }
  if (
    command.hashAlgorithm !== "sha256" ||
    !/^[0-9a-f]{64}$/.test(command.contentDigest)
  ) {
    throw mobilityError(
      "ARCHIVE_VERIFIED_BINDING_INVALID",
      "Verified content binding requires a lowercase SHA-256 digest",
    );
  }
  if (!Number.isSafeInteger(command.byteLength) || command.byteLength < 1) {
    throw mobilityError(
      "ARCHIVE_VERIFIED_BINDING_INVALID",
      "Verified content binding byteLength must be a positive safe integer",
    );
  }

  const requestDigest = digest(JSON.stringify(canonicalize(command)));
  const fingerprint = {
    contentDigest: command.contentDigest,
    hashAlgorithm: command.hashAlgorithm,
  };
  const contentId = contentIdForFingerprint(fingerprint);

  return sql.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`verified-content-binding:${command.commandId}`}, 0)
      )
    `;
    const [prior] = await transaction`
      SELECT request_digest, response
      FROM verified_content_binding_command
      WHERE command_id = ${command.commandId}
      FOR UPDATE
    `;
    if (prior) {
      if (prior.request_digest !== requestDigest) {
        throw mobilityError(
          "ARCHIVE_VERIFIED_BINDING_REPLAY_CONFLICT",
          "Verified content binding commandId was reused with different input",
        );
      }
      return { ...prior.response, replayed: true };
    }

    const [binding] = await transaction`
      SELECT binding.binding_id, binding.asset_id, binding.content_id,
        asset.state AS asset_state
      FROM asset_source_binding binding
      JOIN asset ON asset.asset_id = binding.asset_id
      WHERE binding.source_kind = ${command.sourceKind}
        AND binding.source_id = ${command.sourceId}
        AND binding.external_asset_id = ${command.externalAssetId}
        AND binding.state = 'active'
      FOR UPDATE OF binding, asset
    `;
    if (!binding || binding.asset_state !== "active") {
      throw mobilityError(
        "ARCHIVE_SOURCE_BINDING_NOT_FOUND",
        "Active source binding was not found for verified content",
      );
    }

    const currentLinks = await transaction`
      SELECT link.content_id
      FROM asset_content_link link
      WHERE link.asset_id = ${binding.asset_id}
        AND link.state = 'active'
      FOR UPDATE
    `;
    if (
      currentLinks.some((link) => String(link.content_id) !== contentId) ||
      (binding.content_id && String(binding.content_id) !== contentId)
    ) {
      throw mobilityError(
        "ARCHIVE_CONTENT_BINDING_CONFLICT",
        "Asset is already linked to different exact content",
      );
    }

    const otherAssets = await transaction`
      SELECT link.asset_id
      FROM media_content_fingerprint fingerprint
      JOIN asset_content_link link
        ON link.content_id = fingerprint.content_id
        AND link.state = 'active'
      WHERE fingerprint.hash_algorithm = ${command.hashAlgorithm}
        AND fingerprint.content_digest = ${command.contentDigest}
        AND link.asset_id <> ${binding.asset_id}
      LIMIT 1
      FOR SHARE OF fingerprint, link
    `;
    if (otherAssets.length > 0) {
      throw mobilityError(
        "ARCHIVE_CONTENT_IDENTITY_AMBIGUOUS",
        "Verified exact content is already linked to another Cimmich asset",
      );
    }

    const [storedContent] = await transaction`
      INSERT INTO media_content (content_id, byte_length, producer_receipt_id)
      VALUES (
        ${contentId}, ${command.byteLength},
        'receipt_cimmich_verified_content_binding_v1'
      )
      ON CONFLICT (content_id) DO UPDATE SET
        byte_length = coalesce(media_content.byte_length, excluded.byte_length),
        producer_receipt_id = coalesce(
          media_content.producer_receipt_id, excluded.producer_receipt_id
        ),
        updated_at = now()
      WHERE media_content.byte_length IS NULL
        OR media_content.byte_length = excluded.byte_length
      RETURNING content_id
    `;
    if (!storedContent) {
      throw mobilityError(
        "ARCHIVE_CONTENT_BINDING_CONFLICT",
        "Verified exact content has a conflicting byte length",
      );
    }
    await transaction`
      INSERT INTO media_content_fingerprint (
        content_id, hash_algorithm, content_digest, verification,
        producer_receipt_id
      ) VALUES (
        ${contentId}, ${command.hashAlgorithm}, ${command.contentDigest},
        'byte_verified',
        'receipt_cimmich_verified_content_binding_v1'
      )
      ON CONFLICT (hash_algorithm, content_digest) DO UPDATE SET
        verification = 'byte_verified'
    `;
    await transaction`
      INSERT INTO asset_content_link (
        asset_id, content_id, producer_receipt_id
      ) VALUES (
        ${binding.asset_id}, ${contentId},
        'receipt_cimmich_verified_content_binding_v1'
      )
      ON CONFLICT (asset_id, content_id) DO UPDATE SET state = 'active'
    `;
    await transaction`
      UPDATE asset_source_binding
      SET content_id = ${contentId}, last_seen_at = now()
      WHERE binding_id = ${binding.binding_id}
    `;
    await transaction`
      UPDATE asset
      SET content_hash = ${`sha256:${command.contentDigest}`}
      WHERE asset_id = ${binding.asset_id}
    `;

    const response = {
      assetId: String(binding.asset_id),
      bindingId: String(binding.binding_id),
      byteLength: command.byteLength,
      contentId,
      fingerprint: `sha256:${command.contentDigest}`,
      schemaVersion: verifiedContentBindingSchemaVersion,
      verification: "byte_verified",
    };
    await transaction`
      INSERT INTO verified_content_binding_command (
        command_id, actor_id, request_digest, response,
        producer_receipt_id
      ) VALUES (
        ${command.commandId}, ${command.actorId}, ${requestDigest},
        ${transaction.json(response)},
        'receipt_cimmich_verified_content_binding_v1'
      )
    `;
    return { ...response, replayed: false };
  });
};
