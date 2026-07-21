import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const schemaVersion = "cimmich.document.v1";
const receiptId = "receipt_cimmich_document_v1";
const documentKinds = new Set([
  "veterinary",
  "vaccination",
  "registration",
  "insurance",
  "adoption",
  "receipt",
  "care",
  "identity",
  "lease",
  "contract",
  "certificate",
  "correspondence",
  "financial",
  "booking",
  "manual",
  "other",
]);
const subjectKinds = new Set(["person", "pet", "place", "object", "event"]);
const relationKinds = new Set([
  "about",
  "belongs_to",
  "issued_to",
  "applies_to",
  "related",
]);
const safeInlineMimeTypes = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
};
const digest = (value) =>
  createHash("sha256")
    .update(
      Buffer.isBuffer(value)
        ? value
        : typeof value === "string"
          ? value
          : JSON.stringify(canonical(value)),
    )
    .digest("hex");
const stableId = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor is required",
      400,
      "DOCUMENT_ACTOR_REQUIRED",
    );
  }
  return actor;
};
const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "DOCUMENT_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};
const cleanDocumentId = (value) => {
  const id = String(value || "").trim();
  if (!/^document_[0-9a-f]{32}$/.test(id)) {
    throw typedError(
      "A stable Document ID is required",
      400,
      "DOCUMENT_ID_INVALID",
    );
  }
  return id;
};
const cleanText = (value, field, maximum, { nullable = false } = {}) => {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw typedError(`${field} is required`, 400, "DOCUMENT_FIELD_INVALID", {
      field,
    });
  }
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text || text.length > maximum) {
    throw typedError(`${field} is invalid`, 400, "DOCUMENT_FIELD_INVALID", {
      field,
    });
  }
  return text;
};
const cleanKind = (value) => {
  const kind = String(value || "").trim();
  if (!documentKinds.has(kind)) {
    throw typedError(
      "documentKind is not supported",
      400,
      "DOCUMENT_KIND_INVALID",
    );
  }
  return kind;
};
const cleanDate = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  const text =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).trim();
  const parsed = new Date(`${text}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    throw typedError(
      `${field} must be an ISO date`,
      400,
      "DOCUMENT_DATE_INVALID",
      {
        field,
      },
    );
  }
  return text;
};
const cleanMetadata = (input = {}) => {
  const issuedOn = cleanDate(input.issuedOn, "issuedOn");
  const expiresOn = cleanDate(input.expiresOn, "expiresOn");
  if (issuedOn && expiresOn && expiresOn < issuedOn) {
    throw typedError(
      "expiresOn cannot be before issuedOn",
      400,
      "DOCUMENT_DATE_INVALID",
    );
  }
  const documentKind = cleanKind(input.documentKind);
  const documentLabel = cleanText(input.documentLabel, "documentLabel", 120, {
    nullable: true,
  });
  if (documentKind === "other" && !documentLabel) {
    throw typedError(
      "documentLabel is required for Other",
      400,
      "DOCUMENT_KIND_INVALID",
    );
  }
  return {
    displayTitle: cleanText(input.displayTitle, "displayTitle", 240),
    documentKind,
    documentLabel,
    expiresOn,
    issuedOn,
  };
};
const cleanFilename = (value) => {
  const filename = cleanText(value, "sourceFilename", 255);
  if (
    filename === "." ||
    filename === ".." ||
    /[\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw typedError(
      "sourceFilename is invalid",
      400,
      "DOCUMENT_FILENAME_INVALID",
    );
  }
  return filename.replaceAll("/", "_").replaceAll("\\", "_");
};
const cleanMimeType = (value) => {
  const mime = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(
      mime,
    )
  ) {
    throw typedError("mimeType is invalid", 400, "DOCUMENT_MIME_INVALID");
  }
  return mime;
};
const cleanStatus = (value) => {
  const status = String(value || "").trim();
  if (!new Set(["active", "archived"]).has(status)) {
    throw typedError("status is invalid", 400, "DOCUMENT_STATUS_INVALID");
  }
  return status;
};
const cleanVisibilityTier = (value) => {
  const tier = String(value || "standard").trim();
  if (!new Set(["standard", "personal", "private"]).has(tier)) {
    throw typedError(
      "visibilityTier is invalid",
      400,
      "DOCUMENT_VISIBILITY_INVALID",
    );
  }
  return tier;
};
const cleanOptionalDocumentId = (value, field = "supersedesDocumentId") => {
  if (value === null || value === undefined || value === "") return null;
  try {
    return cleanDocumentId(value);
  } catch {
    throw typedError(`${field} is invalid`, 400, "DOCUMENT_VERSION_INVALID", {
      field,
    });
  }
};
const cleanLink = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "A typed Document link is required",
      400,
      "DOCUMENT_LINK_INVALID",
    );
  }
  const subjectKind = String(value.subjectKind || "").trim();
  const relationKind = String(value.relationKind || "").trim();
  const subjectId = String(value.subjectId || "").trim();
  if (!subjectKinds.has(subjectKind) || !relationKinds.has(relationKind)) {
    throw typedError(
      "Document link kind is invalid",
      400,
      "DOCUMENT_LINK_INVALID",
    );
  }
  if (!subjectId || subjectId.length > 160) {
    throw typedError(
      "Document link subject is invalid",
      400,
      "DOCUMENT_LINK_INVALID",
    );
  }
  return { relationKind, subjectId, subjectKind };
};
const cleanLinks = (values) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw typedError(
      "links must contain 1 to 100 items",
      400,
      "DOCUMENT_LINK_INVALID",
    );
  }
  const links = values
    .map(cleanLink)
    .sort((left, right) =>
      `${left.subjectKind}:${left.subjectId}:${left.relationKind}`.localeCompare(
        `${right.subjectKind}:${right.subjectId}:${right.relationKind}`,
      ),
    );
  const keys = new Set();
  for (const link of links) {
    const key = `${link.subjectKind}:${link.subjectId}:${link.relationKind}`;
    if (keys.has(key)) {
      throw typedError(
        "Document links cannot repeat",
        400,
        "DOCUMENT_LINK_INVALID",
      );
    }
    keys.add(key);
  }
  return links;
};

const previewFor = (sourceKind, mimeType) => ({
  available: sourceKind === "immich_asset" || safeInlineMimeTypes.has(mimeType),
  disposition:
    sourceKind === "immich_asset"
      ? "immich"
      : safeInlineMimeTypes.has(mimeType)
        ? "inline"
        : "download",
  mimeType,
});

export const projectDocumentRow = (row, links = undefined) => ({
  documentId: row.document_id,
  documentKind: row.document_kind,
  documentLabel: row.document_label || null,
  displayTitle: row.display_title,
  effectiveVisibilityTier: ["standard", "personal", "private"][
    Number(row.effective_visibility_rank || 0)
  ],
  expiresOn: cleanDate(row.expires_on, "expiresOn"),
  issuedOn: cleanDate(row.issued_on, "issuedOn"),
  ...(links ? { links } : {}),
  preview: previewFor(row.source_kind, row.mime_type),
  revision: Number(row.revision),
  source: {
    assetId: row.immich_asset_id || row.source_asset_id || null,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    cimmichAssetId:
      row.source_kind === "immich_asset" ? row.source_asset_id || null : null,
    contentSha256: row.content_sha256 || null,
    filename: row.source_filename,
    kind: row.source_kind,
    mimeType: row.mime_type,
    sourceContentHash: row.source_content_hash || null,
  },
  status: row.status,
  subjectCount: Number(row.subject_count || 0),
  supersededByDocumentId: row.superseded_by_document_id || null,
  supersedesDocumentId: row.supersedes_document_id || null,
  updatedAt:
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at,
  visibilityTier: row.visibility_tier || "standard",
});
const rowToDocument = projectDocumentRow;

export const createDocumentStore = (
  sql,
  {
    presentationRank = () => 0,
    storeRoot = "",
    maxFileBytes = 25 * 1024 * 1024,
    maxStoreBytes = 10 * 1024 * 1024 * 1024,
  } = {},
) => {
  const root = storeRoot ? resolve(storeRoot) : "";
  const maximum = Math.min(
    25 * 1024 * 1024,
    Math.max(1, Number(maxFileBytes) || 1),
  );
  const storeMaximum = Math.min(
    1024 * 1024 * 1024 * 1024,
    Math.max(maximum, Number(maxStoreBytes) || maximum),
  );
  let importQueue = Promise.resolve();

  const withImportLock = (work) => {
    const result = importQueue.then(work, work);
    importQueue = result.catch(() => {});
    return result;
  };

  const storeUsage = async (executor, contentSha256 = null) => {
    const [usage] = await executor`
      SELECT coalesce(sum(content.byte_size), 0)::bigint AS bytes
      FROM (
        SELECT content_sha256, max(byte_size)::bigint AS byte_size
        FROM cimmich_document
        WHERE source_kind = 'cimmich_file'
        GROUP BY content_sha256
      ) content
    `;
    const duplicate = contentSha256
      ? await executor`
          SELECT 1 FROM cimmich_document
          WHERE source_kind = 'cimmich_file'
            AND content_sha256 = ${contentSha256}
          LIMIT 1
        `
      : [];
    return {
      duplicate: Boolean(duplicate[0]),
      usedBytes: Number(usage?.bytes || 0),
    };
  };

  const command = async (
    executor,
    { actorId, commandId, commandKind, payload },
  ) => {
    const actor = cleanActor(actorId);
    const id = cleanCommandId(commandId);
    const requestDigest = digest({ commandKind, payload });
    await executor`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const [existing] = await executor`
      SELECT command_kind, request_digest, response_body, state
      FROM cimmich_document_command WHERE command_id = ${id}
    `;
    if (existing) {
      if (
        existing.command_kind !== commandKind ||
        existing.request_digest !== requestDigest
      ) {
        throw typedError(
          "commandId was already used for different Document input",
          409,
          "DOCUMENT_COMMAND_CONFLICT",
        );
      }
      if (existing.state !== "completed") {
        throw typedError(
          "Document command is still incomplete",
          409,
          "DOCUMENT_COMMAND_IN_PROGRESS",
        );
      }
      return { actor, id, replay: existing.response_body, requestDigest };
    }
    await executor`
      INSERT INTO cimmich_document_command (
        command_id, actor_id, command_kind, request_digest, state
      ) VALUES (${id}, ${actor}, ${commandKind}, ${requestDigest}, 'started')
    `;
    return { actor, id, replay: null, requestDigest };
  };

  const complete = async (tx, prepared, decisionId, response) => {
    await tx`
      UPDATE cimmich_document_command SET
        decision_id = ${decisionId}, response_body = ${tx.json(response)},
        state = 'completed', completed_at = now()
      WHERE command_id = ${prepared.id}
    `;
    return response;
  };

  const decision = async (
    tx,
    { action = "accept", actor, documentId, note, supersedes = null },
  ) => {
    const decisionId = stableId("decision");
    await tx`
      INSERT INTO decision (
        decision_id, subject_type, subject_id, action, actor_kind, actor_id,
        reason_code, note, supersedes_decision_id, producer_receipt_id, privacy_class
      ) VALUES (
        ${decisionId}, 'document', ${documentId}, ${action}, 'user', ${actor},
        'document_manual', ${note}, ${supersedes}, ${receiptId}, 'private'
      )
    `;
    return decisionId;
  };

  const rawDocument = async (executor, documentId, { lock = false } = {}) => {
    const id = cleanDocumentId(documentId);
    const [row] = await executor`
      SELECT * FROM cimmich_document WHERE document_id = ${id}
      ${lock ? executor`FOR UPDATE` : executor``}
    `;
    if (!row) throw typedError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    return row;
  };

  const rawLinks = async (executor, documentId) => executor`
    SELECT link_id, subject_kind, subject_id, relation_kind, decision_id
    FROM current_cimmich_document_link WHERE document_id = ${documentId}
    ORDER BY subject_kind, subject_id, relation_kind
  `;

  const requireVisibleLinkTargets = async (executor, links) => {
    for (const link of links) {
      if (["person", "pet"].includes(link.subjectKind)) {
        const [target] = await executor`
          SELECT person_id FROM current_person
          WHERE person_id = ${link.subjectId}
            AND subject_kind = ${link.subjectKind}
            AND cimmich_visibility_subject_rank(subject_kind, person_id)
              <= ${presentationRank()}
          LIMIT 1
        `;
        if (!target) {
          throw typedError(
            "Document link target was not found in the current viewing mode",
            404,
            "DOCUMENT_LINK_TARGET_NOT_VISIBLE",
          );
        }
      }
    }
  };

  const visibleRow = async (executor, documentId) => {
    const id = cleanDocumentId(documentId);
    const [row] = await executor`
      SELECT document.*,
        projection.immich_asset_id,
        coalesce(visibility.visibility_tier, document.visibility_tier) AS visibility_tier,
        cimmich_visibility_document_rank(document.document_id) AS effective_visibility_rank,
        (SELECT successor.document_id FROM cimmich_document successor
          WHERE successor.supersedes_document_id = document.document_id
          LIMIT 1) AS superseded_by_document_id,
        (SELECT count(*)::int FROM current_cimmich_document_link link
          WHERE link.document_id = document.document_id
            AND (link.subject_kind NOT IN ('person','pet')
              OR cimmich_visibility_subject_rank(
                link.subject_kind, link.subject_id
              ) <= ${presentationRank()})
            AND (link.subject_kind NOT IN ('place','object','event')
              OR cimmich_visibility_context_entity_rank(link.subject_id) <= ${presentationRank()})) AS subject_count
      FROM cimmich_document document
      LEFT JOIN cimmich_visibility_object visibility
        ON visibility.object_scope = 'document'
       AND visibility.object_id = document.document_id
      LEFT JOIN LATERAL (
        SELECT current.immich_asset_id
        FROM immich_asset_projection current
        WHERE document.source_kind = 'immich_asset'
          AND current.cimmich_asset_id = document.source_asset_id
          AND current.state = 'active'
        ORDER BY current.last_seen_at DESC, current.source_id
        LIMIT 1
      ) projection ON true
      WHERE document.document_id = ${id}
        AND cimmich_visibility_document_rank(document.document_id) <= ${presentationRank()}
    `;
    if (!row) throw typedError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    return row;
  };

  const projectedLinks = async (executor, documentId) => {
    const rows = await executor`
      SELECT link.subject_kind, link.subject_id, link.relation_kind,
        CASE
          WHEN link.subject_kind IN ('person','pet') THEN person.display_name
          ELSE entity.display_name
        END AS display_name
      FROM current_cimmich_document_link link
      LEFT JOIN current_person person
        ON link.subject_kind IN ('person','pet') AND person.person_id = link.subject_id
      LEFT JOIN context_entity entity
        ON link.subject_kind IN ('place','object','event') AND entity.entity_id = link.subject_id
      WHERE link.document_id = ${documentId}
        AND (link.subject_kind NOT IN ('person','pet')
          OR cimmich_visibility_subject_rank(
            link.subject_kind, link.subject_id
          ) <= ${presentationRank()})
        AND (link.subject_kind NOT IN ('place','object','event')
          OR cimmich_visibility_context_entity_rank(link.subject_id) <= ${presentationRank()})
      ORDER BY link.subject_kind, coalesce(person.display_name, entity.display_name), link.subject_id
    `;
    return rows.map((row) => ({
      displayName: row.display_name || row.subject_id,
      relationKind: row.relation_kind,
      subjectId: row.subject_id,
      subjectKind: row.subject_kind,
    }));
  };

  const operation = async (
    tx,
    {
      affectedLinkKeys = [],
      beforeState,
      commandId,
      decisionId,
      documentId,
      kind,
      afterState,
      supersedes = null,
    },
  ) => {
    const operationId = stableId("document_operation");
    await tx`
      INSERT INTO cimmich_document_operation (
        operation_id, command_id, decision_id, document_id, operation_kind,
        before_state, after_state, affected_link_keys, state, supersedes_operation_id
      ) VALUES (
        ${operationId}, ${commandId}, ${decisionId}, ${documentId}, ${kind},
        ${tx.json(beforeState)}, ${tx.json(afterState)}, ${tx.json(affectedLinkKeys)},
        'active', ${supersedes}
      )
    `;
    return operationId;
  };

  const createRecord = async ({
    actorId,
    beforeInsert = null,
    commandId,
    commandKind,
    record,
  }) =>
    sql.begin(async (tx) => {
      const prepared = await command(tx, {
        actorId,
        commandId,
        commandKind,
        payload: record,
      });
      if (prepared.replay) return { ...prepared.replay, replayed: true };
      if (commandKind === "import") {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
        const usage = await storeUsage(tx, record.contentSha256);
        const projectedBytes =
          usage.usedBytes + (usage.duplicate ? 0 : record.byteSize);
        if (projectedBytes > storeMaximum) {
          throw typedError(
            "Cimmich Document storage quota would be exceeded",
            413,
            "DOCUMENT_STORE_QUOTA_EXCEEDED",
            { maxStoreBytes: storeMaximum },
          );
        }
      }
      if (record.supersedesDocumentId) {
        const [predecessor] = await tx`
          SELECT document.document_id,
            EXISTS (
              SELECT 1 FROM cimmich_document successor
              WHERE successor.supersedes_document_id = document.document_id
            ) AS already_superseded
          FROM cimmich_document document
          WHERE document.document_id = ${record.supersedesDocumentId}
            AND cimmich_visibility_document_rank(document.document_id) <= ${presentationRank()}
          FOR UPDATE
        `;
        if (!predecessor) {
          throw typedError(
            "Predecessor Document not found",
            404,
            "DOCUMENT_VERSION_NOT_FOUND",
          );
        }
        if (predecessor.already_superseded) {
          throw typedError(
            "Predecessor Document already has a direct successor",
            409,
            "DOCUMENT_VERSION_CONFLICT",
          );
        }
      }
      if (commandKind === "import" && beforeInsert) await beforeInsert();
      const documentId = stableId("document");
      const decisionId = await decision(tx, {
        actor: prepared.actor,
        documentId,
        note:
          commandKind === "import" ? "Import Document" : "Reference Document",
      });
      await tx`
        INSERT INTO cimmich_document (
          document_id, source_kind, source_asset_id, storage_key,
          source_filename, mime_type, byte_size, content_sha256,
          source_content_hash, supersedes_document_id,
          display_title, document_kind, document_label,
          issued_on, expires_on, status, visibility_tier, created_by
        ) VALUES (
          ${documentId}, ${record.sourceKind}, ${record.sourceAssetId},
          ${record.storageKey}, ${record.sourceFilename}, ${record.mimeType},
          ${record.byteSize}, ${record.contentSha256}, ${record.sourceContentHash},
          ${record.supersedesDocumentId},
          ${record.displayTitle}, ${record.documentKind}, ${record.documentLabel},
          ${record.issuedOn}, ${record.expiresOn}, 'active',
          ${record.visibilityTier}, ${prepared.actor}
        )
      `;
      const response = {
        changed: true,
        decisionId,
        documentId,
        replayed: false,
        schemaVersion,
      };
      await operation(tx, {
        afterState: { status: "active" },
        beforeState: { document: null },
        commandId: prepared.id,
        decisionId,
        documentId,
        kind: commandKind,
      });
      return complete(tx, prepared, decisionId, response);
    });

  const reference = async ({ actorId, assetId, commandId, ...input }) => {
    const metadata = cleanMetadata(input);
    const stableCommandId = cleanCommandId(commandId);
    const stableAssetId = String(assetId || "").trim();
    if (!stableAssetId || stableAssetId.length > 200) {
      throw typedError(
        "A stable Cimmich assetId is required",
        400,
        "DOCUMENT_SOURCE_INVALID",
      );
    }
    const [asset] = await sql`
      SELECT asset.asset_id, asset.content_hash, asset.mime_type, asset.media_kind,
        EXISTS (
          SELECT 1 FROM cimmich_document document
          WHERE document.source_kind = 'immich_asset'
            AND document.source_asset_id = asset.asset_id
        ) AS already_referenced
      FROM asset WHERE asset.asset_id = ${stableAssetId} AND asset.state = 'active'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
    `;
    if (!asset)
      throw typedError(
        "Source asset not found",
        404,
        "DOCUMENT_SOURCE_NOT_FOUND",
      );
    const [priorCommand] = await sql`
      SELECT command_id FROM cimmich_document_command
      WHERE command_id = ${stableCommandId}
    `;
    if (asset.already_referenced && !priorCommand) {
      throw typedError(
        "This source asset already has a Document record",
        409,
        "DOCUMENT_SOURCE_ALREADY_REFERENCED",
      );
    }
    return createRecord({
      actorId,
      commandId: stableCommandId,
      commandKind: "reference",
      record: {
        ...metadata,
        byteSize: null,
        contentSha256: /^[0-9a-f]{64}$/.test(asset.content_hash || "")
          ? asset.content_hash
          : null,
        mimeType: cleanMimeType(asset.mime_type),
        sourceAssetId: asset.asset_id,
        sourceContentHash: asset.content_hash || null,
        sourceFilename: cleanFilename(
          input.sourceFilename || `${asset.asset_id}.${asset.media_kind}`,
        ),
        sourceKind: "immich_asset",
        storageKey: null,
        supersedesDocumentId: cleanOptionalDocumentId(
          input.supersedesDocumentId,
        ),
        visibilityTier: cleanVisibilityTier(input.visibilityTier),
      },
    });
  };

  const writeBlob = async (bytes, sha256) => {
    if (!root) {
      throw typedError(
        "Cimmich local Document storage is not configured",
        503,
        "DOCUMENT_STORE_NOT_CONFIGURED",
      );
    }
    const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
    const absolute = resolve(root, storageKey);
    if (!absolute.startsWith(`${root}${sep}`)) {
      throw typedError(
        "Document storage key is invalid",
        500,
        "DOCUMENT_STORE_ISOLATION_FAILURE",
      );
    }
    await mkdir(dirname(absolute), { recursive: true });
    try {
      const existing = await stat(absolute);
      if (existing.size !== bytes.length) {
        throw typedError(
          "Stored Document digest collision",
          500,
          "DOCUMENT_STORE_ISOLATION_FAILURE",
        );
      }
      if (digest(await readFile(absolute)) !== sha256) {
        throw typedError(
          "Stored Document content failed integrity verification",
          500,
          "DOCUMENT_CONTENT_INTEGRITY_FAILED",
        );
      }
      return storageKey;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const temporary = `${absolute}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, absolute);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return storageKey;
  };

  const importFileUnlocked = async ({
    actorId,
    bytes,
    commandId,
    mimeType,
    sourceFilename,
    ...input
  }) => {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximum) {
      throw typedError(
        `Document content must contain 1 to ${maximum} bytes`,
        bytes?.length > maximum ? 413 : 400,
        bytes?.length > maximum
          ? "DOCUMENT_TOO_LARGE"
          : "DOCUMENT_CONTENT_INVALID",
      );
    }
    const metadata = cleanMetadata(input);
    const sha256 = digest(bytes);
    const record = {
      ...metadata,
      byteSize: bytes.length,
      contentSha256: sha256,
      mimeType: cleanMimeType(mimeType),
      sourceAssetId: null,
      sourceContentHash: null,
      sourceFilename: cleanFilename(sourceFilename),
      sourceKind: "cimmich_file",
      storageKey: `${sha256.slice(0, 2)}/${sha256}`,
      supersedesDocumentId: cleanOptionalDocumentId(input.supersedesDocumentId),
      visibilityTier: cleanVisibilityTier(input.visibilityTier),
    };
    const existing = await sql`
      SELECT command_kind, request_digest, response_body, state
      FROM cimmich_document_command WHERE command_id = ${cleanCommandId(commandId)}
    `;
    if (existing[0]) {
      const expected = digest({ commandKind: "import", payload: record });
      if (
        existing[0].command_kind !== "import" ||
        existing[0].request_digest !== expected
      ) {
        throw typedError(
          "commandId was already used for different Document input",
          409,
          "DOCUMENT_COMMAND_CONFLICT",
        );
      }
      if (existing[0].state !== "completed") {
        throw typedError(
          "Document command is still incomplete",
          409,
          "DOCUMENT_COMMAND_IN_PROGRESS",
        );
      }
      return { ...existing[0].response_body, replayed: true };
    }
    let blobPrepared = false;
    try {
      return await createRecord({
        actorId,
        beforeInsert: async () => {
          await writeBlob(bytes, sha256);
          blobPrepared = true;
        },
        commandId,
        commandKind: "import",
        record,
      });
    } catch (error) {
      if (blobPrepared) {
        await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
          const [reference] = await tx`
            SELECT count(*)::int AS count FROM cimmich_document
            WHERE source_kind = 'cimmich_file' AND content_sha256 = ${sha256}
          `;
          if (Number(reference?.count || 0) === 0) {
            await rm(join(root, record.storageKey), { force: true }).catch(
              () => {},
            );
          }
        });
      }
      throw error;
    }
  };
  const importFile = (input) => withImportLock(() => importFileUnlocked(input));

  const list = async ({
    documentKind = "",
    includeArchived = false,
    limit = 100,
    query = "",
    subjectId = "",
    subjectKind = "",
  } = {}) => {
    const normalizedQuery = String(query || "").trim();
    if (normalizedQuery.length > 200) {
      throw typedError(
        "Document query is limited to 200 characters",
        400,
        "DOCUMENT_QUERY_INVALID",
      );
    }
    const kind = String(documentKind || "").trim();
    if (kind && !documentKinds.has(kind)) {
      throw typedError(
        "documentKind is not supported",
        400,
        "DOCUMENT_KIND_INVALID",
      );
    }
    const scopedSubjectKind = String(subjectKind || "").trim();
    const scopedSubjectId = String(subjectId || "").trim();
    if (
      Boolean(scopedSubjectKind) !== Boolean(scopedSubjectId) ||
      (scopedSubjectKind && !subjectKinds.has(scopedSubjectKind))
    ) {
      throw typedError(
        "Both valid subjectKind and subjectId are required",
        400,
        "DOCUMENT_LINK_INVALID",
      );
    }
    if (["person", "pet"].includes(scopedSubjectKind)) {
      await requireVisibleLinkTargets(sql, [
        { subjectId: scopedSubjectId, subjectKind: scopedSubjectKind },
      ]);
    }
    const parsedLimit = Number.parseInt(String(limit ?? 100), 10);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 200
    ) {
      throw typedError(
        "Document limit must be between 1 and 200",
        400,
        "DOCUMENT_LIMIT_INVALID",
      );
    }
    const boundedLimit = parsedLimit;
    const search = `%${normalizedQuery}%`;
    const rows = await sql`
      SELECT document.*,
        projection.immich_asset_id,
        coalesce(visibility.visibility_tier, document.visibility_tier) AS visibility_tier,
        cimmich_visibility_document_rank(document.document_id) AS effective_visibility_rank,
        (SELECT successor.document_id FROM cimmich_document successor
          WHERE successor.supersedes_document_id = document.document_id
          LIMIT 1) AS superseded_by_document_id,
        (SELECT count(*)::int FROM current_cimmich_document_link link
          WHERE link.document_id = document.document_id
            AND (link.subject_kind NOT IN ('person','pet')
              OR cimmich_visibility_subject_rank(
                link.subject_kind, link.subject_id
              ) <= ${presentationRank()})
            AND (link.subject_kind NOT IN ('place','object','event')
              OR cimmich_visibility_context_entity_rank(link.subject_id) <= ${presentationRank()})) AS subject_count
      FROM cimmich_document document
      LEFT JOIN cimmich_visibility_object visibility
        ON visibility.object_scope = 'document' AND visibility.object_id = document.document_id
      LEFT JOIN LATERAL (
        SELECT current.immich_asset_id
        FROM immich_asset_projection current
        WHERE document.source_kind = 'immich_asset'
          AND current.cimmich_asset_id = document.source_asset_id
          AND current.state = 'active'
        ORDER BY current.last_seen_at DESC, current.source_id
        LIMIT 1
      ) projection ON true
      WHERE (${Boolean(includeArchived)} OR document.status = 'active')
        AND (${kind} = '' OR document.document_kind = ${kind})
        AND (
          ${normalizedQuery} = '' OR document.display_title ILIKE ${search}
          OR document.source_filename ILIKE ${search}
          OR coalesce(document.document_label, '') ILIKE ${search}
        )
        AND (
          ${scopedSubjectKind} = '' OR EXISTS (
            SELECT 1 FROM current_cimmich_document_link link
            WHERE link.document_id = document.document_id
              AND link.subject_kind = ${scopedSubjectKind}
              AND link.subject_id = ${scopedSubjectId}
          )
        )
        AND cimmich_visibility_document_rank(document.document_id) <= ${presentationRank()}
      ORDER BY coalesce(document.issued_on, document.created_at::date) DESC,
        lower(document.display_title), document.document_id
      LIMIT ${boundedLimit}
    `;
    return { items: rows.map((row) => rowToDocument(row)), schemaVersion };
  };

  const get = async ({ documentId }) => {
    const row = await visibleRow(sql, documentId);
    return {
      ...rowToDocument(row, await projectedLinks(sql, row.document_id)),
      schemaVersion,
    };
  };

  const update = async ({ actorId, commandId, documentId, ...input }) => {
    const id = cleanDocumentId(documentId);
    const allowedKeys = new Set([
      "displayTitle",
      "documentKind",
      "documentLabel",
      "issuedOn",
      "expiresOn",
      "status",
    ]);
    const unknown = Object.keys(input).filter((key) => !allowedKeys.has(key));
    if (unknown.length) {
      throw typedError(
        "Document update contains unsupported fields",
        400,
        "DOCUMENT_FIELD_INVALID",
        { fields: unknown },
      );
    }
    return sql.begin(async (tx) => {
      const current = await rawDocument(tx, id, { lock: true });
      const requested = {
        displayTitle: input.displayTitle ?? current.display_title,
        documentKind: input.documentKind ?? current.document_kind,
        documentLabel: Object.hasOwn(input, "documentLabel")
          ? input.documentLabel
          : current.document_label,
        expiresOn: Object.hasOwn(input, "expiresOn")
          ? input.expiresOn
          : current.expires_on,
        issuedOn: Object.hasOwn(input, "issuedOn")
          ? input.issuedOn
          : current.issued_on,
      };
      const metadata = cleanMetadata(requested);
      const status = Object.hasOwn(input, "status")
        ? cleanStatus(input.status)
        : current.status;
      const payload = { ...metadata, documentId: id, status };
      const prepared = await command(tx, {
        actorId,
        commandId,
        commandKind: "update",
        payload,
      });
      if (prepared.replay) return { ...prepared.replay, replayed: true };
      const changed =
        current.display_title !== metadata.displayTitle ||
        current.document_kind !== metadata.documentKind ||
        (current.document_label || null) !== metadata.documentLabel ||
        cleanDate(current.issued_on, "issuedOn") !== metadata.issuedOn ||
        cleanDate(current.expires_on, "expiresOn") !== metadata.expiresOn ||
        current.status !== status;
      if (!changed) {
        const response = {
          changed: false,
          decisionId: null,
          documentId: id,
          replayed: false,
          schemaVersion,
        };
        return complete(tx, prepared, null, response);
      }
      const decisionId = await decision(tx, {
        action: status === "archived" ? "reject" : "accept",
        actor: prepared.actor,
        documentId: id,
        note: status === "archived" ? "Archive Document" : "Update Document",
      });
      await tx`
        UPDATE cimmich_document SET
          display_title = ${metadata.displayTitle}, document_kind = ${metadata.documentKind},
          document_label = ${metadata.documentLabel}, issued_on = ${metadata.issuedOn},
          expires_on = ${metadata.expiresOn}, status = ${status},
          revision = revision + 1, updated_at = now()
        WHERE document_id = ${id}
      `;
      const response = {
        changed: true,
        decisionId,
        documentId: id,
        replayed: false,
        schemaVersion,
      };
      await operation(tx, {
        afterState: { document: { ...metadata, status } },
        beforeState: {
          document: {
            displayTitle: current.display_title,
            documentKind: current.document_kind,
            documentLabel: current.document_label,
            expiresOn: cleanDate(current.expires_on, "expiresOn"),
            issuedOn: cleanDate(current.issued_on, "issuedOn"),
            status: current.status,
          },
        },
        commandId: prepared.id,
        decisionId,
        documentId: id,
        kind: "update",
      });
      return complete(tx, prepared, decisionId, response);
    });
  };

  const modifyLinks = async ({
    actorId,
    commandId,
    documentId,
    links,
    selected,
  }) => {
    const id = cleanDocumentId(documentId);
    const requested = cleanLinks(links);
    const commandKind = selected ? "link_attach" : "link_detach";
    return sql.begin(async (tx) => {
      await rawDocument(tx, id, { lock: true });
      if (selected) await requireVisibleLinkTargets(tx, requested);
      const prepared = await command(tx, {
        actorId,
        commandId,
        commandKind,
        payload: { documentId: id, links: requested },
      });
      if (prepared.replay) return { ...prepared.replay, replayed: true };
      const currentRows = await rawLinks(tx, id);
      const currentByKey = new Map(
        currentRows.map((row) => [
          `${row.subject_kind}:${row.subject_id}:${row.relation_kind}`,
          row,
        ]),
      );
      const affected = requested.filter((link) =>
        selected
          ? !currentByKey.has(
              `${link.subjectKind}:${link.subjectId}:${link.relationKind}`,
            )
          : currentByKey.has(
              `${link.subjectKind}:${link.subjectId}:${link.relationKind}`,
            ),
      );
      if (!affected.length) {
        const response = {
          changed: false,
          decisionId: null,
          documentId: id,
          replayed: false,
          schemaVersion,
        };
        return complete(tx, prepared, null, response);
      }
      const decisionId = await decision(tx, {
        action: selected ? "accept" : "reject",
        actor: prepared.actor,
        documentId: id,
        note: selected ? "Attach Document links" : "Detach Document links",
      });
      const beforeLinks = [];
      for (const link of affected) {
        const key = `${link.subjectKind}:${link.subjectId}:${link.relationKind}`;
        const previous = currentByKey.get(key);
        if (previous) {
          beforeLinks.push({
            relationKind: previous.relation_kind,
            subjectId: previous.subject_id,
            subjectKind: previous.subject_kind,
          });
          await tx`UPDATE cimmich_document_link SET state = 'superseded' WHERE link_id = ${previous.link_id}`;
        }
        if (selected) {
          await tx`
            INSERT INTO cimmich_document_link (
              link_id, document_id, subject_kind, subject_id, relation_kind,
              state, decision_id, supersedes_link_id
            ) VALUES (
              ${stableId("document_link")}, ${id}, ${link.subjectKind}, ${link.subjectId},
              ${link.relationKind}, 'current', ${decisionId}, ${previous?.link_id || null}
            )
          `;
        }
      }
      await tx`UPDATE cimmich_document SET revision = revision + 1, updated_at = now() WHERE document_id = ${id}`;
      const response = {
        changed: true,
        decisionId,
        documentId: id,
        linkCount: affected.length,
        replayed: false,
        schemaVersion,
      };
      await operation(tx, {
        affectedLinkKeys: affected,
        afterState: { links: selected ? affected : [] },
        beforeState: { links: beforeLinks },
        commandId: prepared.id,
        decisionId,
        documentId: id,
        kind: commandKind,
      });
      return complete(tx, prepared, decisionId, response);
    });
  };

  const undo = async ({ actorId, commandId, decisionId }) => {
    const originalDecisionId = String(decisionId || "").trim();
    if (!originalDecisionId || originalDecisionId.length > 120) {
      throw typedError(
        "A Document decisionId is required",
        400,
        "DOCUMENT_DECISION_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const [original] = await tx`
        SELECT * FROM cimmich_document_operation
        WHERE decision_id = ${originalDecisionId} FOR UPDATE
      `;
      if (!original)
        throw typedError(
          "Document decision not found",
          404,
          "DOCUMENT_DECISION_NOT_FOUND",
        );
      if (original.operation_kind === "undo") {
        throw typedError(
          "An undo receipt cannot itself be undone",
          409,
          "DOCUMENT_UNDO_STALE",
        );
      }
      if (original.state !== "active") {
        throw typedError(
          "Document decision was already undone",
          409,
          "DOCUMENT_UNDO_STALE",
        );
      }
      const prepared = await command(tx, {
        actorId,
        commandId,
        commandKind: "undo",
        payload: { decisionId: originalDecisionId },
      });
      if (prepared.replay) return { ...prepared.replay, replayed: true };
      const document = await rawDocument(tx, original.document_id, {
        lock: true,
      });
      const undoDecisionId = await decision(tx, {
        action: "restore",
        actor: prepared.actor,
        documentId: original.document_id,
        note: "Undo Document decision",
        supersedes: originalDecisionId,
      });
      if (original.before_state?.document === null) {
        await tx`
          UPDATE cimmich_document SET status = 'archived', revision = revision + 1,
            updated_at = now() WHERE document_id = ${original.document_id}
        `;
      } else if (original.before_state?.document) {
        const restored = cleanMetadata(original.before_state.document);
        const status = cleanStatus(original.before_state.document.status);
        await tx`
          UPDATE cimmich_document SET
            display_title = ${restored.displayTitle}, document_kind = ${restored.documentKind},
            document_label = ${restored.documentLabel}, issued_on = ${restored.issuedOn},
            expires_on = ${restored.expiresOn}, status = ${status},
            revision = revision + 1, updated_at = now()
          WHERE document_id = ${original.document_id}
        `;
      }
      const keys = Array.isArray(original.affected_link_keys)
        ? original.affected_link_keys
        : [];
      const beforeLinks = Array.isArray(original.before_state?.links)
        ? original.before_state.links
        : [];
      for (const key of keys) {
        const link = cleanLink(key);
        await tx`
          UPDATE cimmich_document_link SET state = 'superseded'
          WHERE document_id = ${original.document_id}
            AND subject_kind = ${link.subjectKind} AND subject_id = ${link.subjectId}
            AND relation_kind = ${link.relationKind} AND state = 'current'
        `;
      }
      for (const linkValue of beforeLinks) {
        const link = cleanLink(linkValue);
        await tx`
          INSERT INTO cimmich_document_link (
            link_id, document_id, subject_kind, subject_id, relation_kind,
            state, decision_id
          ) VALUES (
            ${stableId("document_link")}, ${original.document_id}, ${link.subjectKind},
            ${link.subjectId}, ${link.relationKind}, 'current', ${undoDecisionId}
          )
        `;
      }
      if (keys.length && !original.before_state?.document) {
        await tx`UPDATE cimmich_document SET revision = revision + 1, updated_at = now() WHERE document_id = ${original.document_id}`;
      }
      const response = {
        changed: true,
        decisionId: undoDecisionId,
        documentId: original.document_id,
        replayed: false,
        schemaVersion,
        undoneDecisionId: originalDecisionId,
      };
      const undoOperationId = await operation(tx, {
        afterState: original.before_state,
        beforeState: { document: { status: document.status } },
        commandId: prepared.id,
        decisionId: undoDecisionId,
        documentId: original.document_id,
        kind: "undo",
        supersedes: original.operation_id,
      });
      await tx`
        UPDATE cimmich_document_operation SET
          state = 'undone', undone_by_operation_id = ${undoOperationId}
        WHERE operation_id = ${original.operation_id}
      `;
      return complete(tx, prepared, undoDecisionId, response);
    });
  };

  const content = async ({ documentId }) => {
    const row = await visibleRow(sql, documentId);
    if (row.source_kind !== "cimmich_file") {
      throw typedError(
        "This Document is presented by its Immich source asset",
        409,
        "DOCUMENT_CONTENT_IMMICH_OWNED",
        {
          assetId: row.immich_asset_id || row.source_asset_id,
          cimmichAssetId: row.source_asset_id,
        },
      );
    }
    if (!root)
      throw typedError(
        "Cimmich local Document storage is not configured",
        503,
        "DOCUMENT_STORE_NOT_CONFIGURED",
      );
    const absolute = resolve(root, row.storage_key);
    if (!absolute.startsWith(`${root}${sep}`)) {
      throw typedError(
        "Document storage boundary failed",
        500,
        "DOCUMENT_STORE_ISOLATION_FAILURE",
      );
    }
    let bytes;
    try {
      bytes = await readFile(absolute);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw typedError(
          "Document content is missing",
          410,
          "DOCUMENT_CONTENT_MISSING",
        );
      }
      throw error;
    }
    if (
      bytes.length !== Number(row.byte_size) ||
      digest(bytes) !== row.content_sha256
    ) {
      throw typedError(
        "Document content failed integrity verification",
        500,
        "DOCUMENT_CONTENT_INTEGRITY_FAILED",
      );
    }
    return {
      bytes,
      filename: row.source_filename,
      mimeType: row.mime_type,
      previewDisposition: safeInlineMimeTypes.has(row.mime_type)
        ? "inline"
        : "attachment",
    };
  };

  const status = async () => {
    const { usedBytes } = await storeUsage(sql);
    if (!root) {
      return {
        configured: false,
        maxFileBytes: maximum,
        maxStoreBytes: storeMaximum,
        usedBytes,
        writable: false,
      };
    }
    try {
      await mkdir(root, { recursive: true });
      const details = await stat(root);
      await access(root, fsConstants.R_OK | fsConstants.W_OK);
      return {
        configured: true,
        maxFileBytes: maximum,
        maxStoreBytes: storeMaximum,
        usedBytes,
        writable: details.isDirectory(),
      };
    } catch {
      return {
        configured: true,
        maxFileBytes: maximum,
        maxStoreBytes: storeMaximum,
        usedBytes,
        writable: false,
      };
    }
  };

  return {
    attachLinks: (input) => modifyLinks({ ...input, selected: true }),
    content,
    documentKinds: [...documentKinds],
    get,
    importFile,
    list,
    reference,
    schemaVersion,
    status,
    detachLinks: (input) => modifyLinks({ ...input, selected: false }),
    undo,
    update,
  };
};

export const documentContract = Object.freeze({
  documentKinds: [...documentKinds],
  maxFileBytes: 25 * 1024 * 1024,
  defaultMaxStoreBytes: 10 * 1024 * 1024 * 1024,
  relationKinds: [...relationKinds],
  safeInlineMimeTypes: [...safeInlineMimeTypes],
  schemaVersion,
  sourceKinds: ["immich_asset", "cimmich_file"],
  subjectKinds: [...subjectKinds],
});
