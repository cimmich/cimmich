import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.bulk-album-operation.v1";
const operationStates = new Set([
  "applied",
  "applying",
  "kept",
  "partial",
  "undone",
  "undoing",
]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const cleanText = (value, label, maximum) => {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) {
    throw typedError(
      `${label} must contain between 1 and ${maximum} characters`,
      400,
      "BULK_ALBUM_OPERATION_INPUT_INVALID",
    );
  }
  return text;
};

const cleanDigest = (value) => {
  const digest = String(value || "").trim();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw typedError(
      "A stable folder manifest digest is required",
      400,
      "BULK_ALBUM_OPERATION_DIGEST_INVALID",
    );
  }
  return digest;
};

const cleanManifest = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
    throw typedError(
      "Choose between 1 and 1000 folder albums",
      400,
      "BULK_ALBUM_OPERATION_MANIFEST_INVALID",
    );
  }
  const manifest = value.map((item) => {
    const assetCount = Number(item?.assetCount);
    if (!Number.isSafeInteger(assetCount) || assetCount < 1) {
      throw typedError(
        "Every included folder needs a positive exact asset count",
        400,
        "BULK_ALBUM_OPERATION_MANIFEST_INVALID",
      );
    }
    return {
      assetCount,
      sourcePath: cleanText(item?.sourcePath, "Source path", 2000),
      title: cleanText(item?.title, "Album title", 240),
    };
  });
  const normalizedTitles = manifest.map(({ title }) =>
    title.toLocaleLowerCase("en"),
  );
  if (new Set(normalizedTitles).size !== normalizedTitles.length) {
    throw typedError(
      "Resolve duplicate album titles before applying the manifest",
      409,
      "BULK_ALBUM_OPERATION_TITLE_COLLISION",
    );
  }
  const sourcePaths = manifest.map(({ sourcePath }) => sourcePath);
  if (new Set(sourcePaths).size !== sourcePaths.length) {
    throw typedError(
      "A folder can appear only once in an album manifest",
      400,
      "BULK_ALBUM_OPERATION_FOLDER_DUPLICATE",
    );
  }
  return manifest.sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath),
  );
};

const cleanAssetIds = (value, { albumCreated = false } = {}) => {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    (value.length < 1 && !albumCreated)
  ) {
    throw typedError(
      "An album checkpoint needs between 1 and 100 changed assets",
      400,
      "BULK_ALBUM_CHECKPOINT_ASSETS_INVALID",
    );
  }
  const assetIds = value.map((item) => cleanText(item, "Asset ID", 240));
  if (new Set(assetIds).size !== assetIds.length) {
    throw typedError(
      "An album checkpoint cannot repeat an asset",
      400,
      "BULK_ALBUM_CHECKPOINT_ASSETS_DUPLICATE",
    );
  }
  return [...assetIds].sort();
};

const digestRequest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const replayCommand = async (executor, { commandId, requestDigest }) => {
  const [stored] = await executor`
    SELECT request_digest, response
    FROM bulk_album_operation_command
    WHERE command_id = ${commandId}
    LIMIT 1
  `;
  if (!stored) return null;
  if (stored.request_digest !== requestDigest) {
    throw typedError(
      "That album-operation command ID was already used for different input",
      409,
      "BULK_ALBUM_OPERATION_COMMAND_CONFLICT",
    );
  }
  return stored.response;
};

const projectOperation = (row, checkpoints = []) => ({
  albumCount: Number(row.album_count),
  assetCount: Number(row.asset_count),
  checkpoints: checkpoints.map((checkpoint) => ({
    albumCreated: checkpoint.album_created,
    albumId: checkpoint.album_id,
    albumName: checkpoint.album_name,
    assetIds: checkpoint.asset_ids,
    batchSequence: Number(checkpoint.batch_sequence),
    checkpointId: checkpoint.checkpoint_id,
    sourcePath: checkpoint.source_path,
    state: checkpoint.state,
  })),
  completedAt: row.completed_at
    ? new Date(row.completed_at).toISOString()
    : null,
  createdAt: new Date(row.created_at).toISOString(),
  manifest: row.manifest,
  operationId: row.operation_id,
  schemaVersion,
  snapshotDigest: row.snapshot_digest,
  sourcePath: row.source_path,
  state: row.state,
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const createBulkAlbumOperationStore = (sql) => {
  const readOperation = async (executor, operationId) => {
    const [operation] = await executor`
      SELECT * FROM bulk_album_operation
      WHERE operation_id = ${operationId}
      LIMIT 1
    `;
    if (!operation) {
      throw typedError(
        "Folder-to-album operation not found",
        404,
        "BULK_ALBUM_OPERATION_NOT_FOUND",
      );
    }
    const checkpoints = await executor`
      SELECT * FROM bulk_album_operation_checkpoint
      WHERE operation_id = ${operationId}
      ORDER BY batch_sequence
    `;
    return projectOperation(operation, checkpoints);
  };

  return {
    async bulkAlbumOperation({ operationId }) {
      return readOperation(sql, cleanText(operationId, "Operation ID", 240));
    },

    async activeBulkAlbumOperation() {
      const [operation] = await sql`
        SELECT operation_id FROM bulk_album_operation
        WHERE state IN ('applying','applied','partial','undoing')
        ORDER BY updated_at DESC, operation_id DESC
        LIMIT 1
      `;
      return operation
        ? readOperation(sql, operation.operation_id)
        : { operation: null, schemaVersion };
    },

    async createBulkAlbumOperation({
      actorId,
      manifest,
      operationId,
      snapshotDigest,
      sourcePath,
    }) {
      const actor = cleanText(actorId, "Actor ID", 200);
      const id = cleanText(operationId, "Operation ID", 240);
      const path = cleanText(sourcePath, "Source path", 2000);
      const digest = cleanDigest(snapshotDigest);
      const cleanedManifest = cleanManifest(manifest);
      const assetCount = cleanedManifest.reduce(
        (sum, item) => sum + item.assetCount,
        0,
      );
      return sql.begin(async (tx) => {
        const [existing] = await tx`
          SELECT * FROM bulk_album_operation
          WHERE operation_id = ${id}
          FOR UPDATE
        `;
        if (existing) {
          if (
            existing.actor_id !== actor ||
            existing.source_path !== path ||
            existing.snapshot_digest !== digest
          ) {
            throw typedError(
              "That operation ID already belongs to a different folder manifest",
              409,
              "BULK_ALBUM_OPERATION_CONFLICT",
            );
          }
          return readOperation(tx, id);
        }
        await tx`
          INSERT INTO bulk_album_operation (
            operation_id, actor_id, source_path, snapshot_digest, manifest,
            album_count, asset_count
          ) VALUES (
            ${id}, ${actor}, ${path}, ${digest}, ${tx.json(cleanedManifest)},
            ${cleanedManifest.length}, ${assetCount}
          )
        `;
        return readOperation(tx, id);
      });
    },

    async checkpointBulkAlbumOperation({
      actorId,
      albumCreated,
      albumId,
      albumName,
      assetIds,
      batchSequence,
      commandId,
      operationId,
      sourcePath,
    }) {
      const actor = cleanText(actorId, "Actor ID", 200);
      const command = cleanText(commandId, "Command ID", 240);
      const id = cleanText(operationId, "Operation ID", 240);
      const sequence = Number(batchSequence);
      if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw typedError(
          "Album checkpoint sequence is invalid",
          400,
          "BULK_ALBUM_CHECKPOINT_SEQUENCE_INVALID",
        );
      }
      const input = {
        actor,
        albumCreated: albumCreated === true,
        albumId: cleanText(albumId, "Album ID", 240),
        albumName: cleanText(albumName, "Album name", 240),
        assetIds: cleanAssetIds(assetIds, {
          albumCreated: albumCreated === true,
        }),
        batchSequence: sequence,
        operationId: id,
        sourcePath: cleanText(sourcePath, "Source path", 2000),
      };
      const requestDigest = digestRequest(input);
      return sql.begin(async (tx) => {
        const replayed = await replayCommand(tx, {
          commandId: command,
          requestDigest,
        });
        if (replayed) return replayed;
        const [operation] = await tx`
          SELECT operation_id, state FROM bulk_album_operation
          WHERE operation_id = ${id}
          FOR UPDATE
        `;
        if (!operation || operation.state !== "applying") {
          throw typedError(
            "Only an applying folder-to-album operation accepts checkpoints",
            409,
            "BULK_ALBUM_OPERATION_NOT_APPLYING",
          );
        }
        const checkpointId = `album_checkpoint_${randomUUID().replaceAll("-", "")}`;
        const response = {
          ...input,
          checkpointId,
          schemaVersion,
          state: "applied",
        };
        await tx`
          INSERT INTO bulk_album_operation_command (
            command_id, operation_id, actor_id, command_kind,
            request_digest, response
          ) VALUES (
            ${command}, ${id}, ${actor}, 'checkpoint', ${requestDigest},
            ${tx.json(response)}
          )
        `;
        await tx`
          INSERT INTO bulk_album_operation_checkpoint (
            checkpoint_id, operation_id, command_id, batch_sequence,
            source_path, album_id, album_name, album_created, asset_ids
          ) VALUES (
            ${checkpointId}, ${id}, ${command}, ${sequence},
            ${input.sourcePath}, ${input.albumId}, ${input.albumName},
            ${input.albumCreated}, ${input.assetIds}
          )
        `;
        await tx`
          UPDATE bulk_album_operation SET updated_at = now()
          WHERE operation_id = ${id}
        `;
        return response;
      });
    },

    async setBulkAlbumOperationState({
      actorId,
      commandId,
      operationId,
      state,
    }) {
      const actor = cleanText(actorId, "Actor ID", 200);
      const command = cleanText(commandId, "Command ID", 240);
      const id = cleanText(operationId, "Operation ID", 240);
      const nextState = String(state || "").trim();
      if (!operationStates.has(nextState) || nextState === "applying") {
        throw typedError(
          "Album operation state is invalid",
          400,
          "BULK_ALBUM_OPERATION_STATE_INVALID",
        );
      }
      const requestDigest = digestRequest({
        actor,
        operationId: id,
        state: nextState,
      });
      return sql.begin(async (tx) => {
        const replayed = await replayCommand(tx, {
          commandId: command,
          requestDigest,
        });
        if (replayed) return replayed;
        const [operation] = await tx`
          SELECT state FROM bulk_album_operation
          WHERE operation_id = ${id}
          FOR UPDATE
        `;
        if (!operation) {
          throw typedError(
            "Folder-to-album operation not found",
            404,
            "BULK_ALBUM_OPERATION_NOT_FOUND",
          );
        }
        const allowed =
          (operation.state === "applying" &&
            ["applied", "partial"].includes(nextState)) ||
          (["applied", "partial"].includes(operation.state) &&
            ["kept", "undoing"].includes(nextState)) ||
          (operation.state === "undoing" && nextState === "undone") ||
          operation.state === nextState;
        if (!allowed) {
          throw typedError(
            `Album operation cannot move from ${operation.state} to ${nextState}`,
            409,
            "BULK_ALBUM_OPERATION_STATE_CONFLICT",
          );
        }
        const response = { operationId: id, schemaVersion, state: nextState };
        await tx`
          INSERT INTO bulk_album_operation_command (
            command_id, operation_id, actor_id, command_kind,
            request_digest, response
          ) VALUES (
            ${command}, ${id}, ${actor}, 'state', ${requestDigest},
            ${tx.json(response)}
          )
        `;
        await tx`
          UPDATE bulk_album_operation SET state = ${nextState}, updated_at = now(),
            completed_at = CASE
              WHEN ${nextState} IN ('applied','partial','undone','kept') THEN now()
              ELSE completed_at
            END
          WHERE operation_id = ${id}
        `;
        return response;
      });
    },

    async undoBulkAlbumCheckpoint({ actorId, checkpointId, commandId }) {
      const actor = cleanText(actorId, "Actor ID", 200);
      const command = cleanText(commandId, "Command ID", 240);
      const id = cleanText(checkpointId, "Checkpoint ID", 240);
      const requestDigest = digestRequest({ actor, checkpointId: id });
      return sql.begin(async (tx) => {
        const replayed = await replayCommand(tx, {
          commandId: command,
          requestDigest,
        });
        if (replayed) return replayed;
        const [checkpoint] = await tx`
          SELECT checkpoint_id, operation_id, state
          FROM bulk_album_operation_checkpoint
          WHERE checkpoint_id = ${id}
          FOR UPDATE
        `;
        if (!checkpoint) {
          throw typedError(
            "Album checkpoint not found",
            404,
            "BULK_ALBUM_CHECKPOINT_NOT_FOUND",
          );
        }
        const response = {
          changed: checkpoint.state !== "undone",
          checkpointId: id,
          operationId: checkpoint.operation_id,
          schemaVersion,
          state: "undone",
        };
        await tx`
          INSERT INTO bulk_album_operation_command (
            command_id, operation_id, actor_id, command_kind,
            request_digest, response
          ) VALUES (
            ${command}, ${checkpoint.operation_id}, ${actor}, 'checkpoint_undo',
            ${requestDigest}, ${tx.json(response)}
          )
        `;
        await tx`
          UPDATE bulk_album_operation_checkpoint
          SET state = 'undone', undone_at = coalesce(undone_at, now())
          WHERE checkpoint_id = ${id}
        `;
        await tx`
          UPDATE bulk_album_operation SET updated_at = now()
          WHERE operation_id = ${checkpoint.operation_id}
        `;
        return response;
      });
    },
  };
};

export const bulkAlbumOperationContract = Object.freeze({ schemaVersion });
