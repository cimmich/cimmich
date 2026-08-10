import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.asset-labels.v1";
const commandKinds = new Set(["attach", "create", "detach", "undo"]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const cleanBoundedText = (value, label, maximum) => {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) {
    throw typedError(
      `${label} must contain between 1 and ${maximum} characters`,
      400,
      `ASSET_LABEL_${label.toUpperCase().replaceAll(" ", "_")}_INVALID`,
    );
  }
  return text;
};

export const normalizeAssetLabelName = (value) =>
  cleanBoundedText(value, "display name", 120)
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase("en");

const cleanDisplayName = (value) =>
  cleanBoundedText(value, "display name", 120).replaceAll(/\s+/g, " ");

const cleanCommand = (value) => cleanBoundedText(value, "command id", 240);
const cleanActor = (value) => cleanBoundedText(value, "actor id", 200);

const cleanAssetIds = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw typedError(
      "Choose between 1 and 100 stable Cimmich assets",
      400,
      "ASSET_LABEL_ASSET_SELECTION_INVALID",
    );
  }
  const assetIds = value.map((item) => String(item || "").trim());
  if (assetIds.some((assetId) => !assetId || assetId.length > 240)) {
    throw typedError(
      "Every asset label target needs a stable Cimmich asset ID",
      400,
      "ASSET_LABEL_ASSET_SELECTION_INVALID",
    );
  }
  if (new Set(assetIds).size !== assetIds.length) {
    throw typedError(
      "An asset label command cannot repeat an asset",
      400,
      "ASSET_LABEL_ASSET_SELECTION_DUPLICATE",
    );
  }
  return [...assetIds].sort();
};

const cleanLabelId = (value) => {
  const labelId = String(value || "").trim();
  if (!/^label_[0-9a-f]{32}$/.test(labelId)) {
    throw typedError(
      "A stable Cimmich label ID is required",
      400,
      "ASSET_LABEL_ID_INVALID",
    );
  }
  return labelId;
};

const cleanDecisionId = (value) => {
  const decisionId = String(value || "").trim();
  if (!/^label_decision_[0-9a-f]{32}$/.test(decisionId)) {
    throw typedError(
      "A stable asset label decision ID is required",
      400,
      "ASSET_LABEL_DECISION_ID_INVALID",
    );
  }
  return decisionId;
};

const digestRequest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const identifier = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

const replayCommand = async (executor, { commandId, requestDigest }) => {
  const [stored] = await executor`
    SELECT request_digest, response
    FROM asset_label_command
    WHERE command_id = ${commandId}
    LIMIT 1
  `;
  if (!stored) return null;
  if (stored.request_digest !== requestDigest) {
    throw typedError(
      "That asset label command ID was already used for different input",
      409,
      "ASSET_LABEL_COMMAND_CONFLICT",
    );
  }
  return stored.response;
};

const projectLabel = (row) => ({
  assetCount: Number(row.asset_count || 0),
  createdAt: new Date(row.created_at).toISOString(),
  displayName: row.display_name,
  labelId: row.label_id,
  schemaVersion,
  status: row.status,
});

const latestMembershipEvents = async (executor, { assetIds, labelId }) => {
  const rows = await executor`
    SELECT DISTINCT ON (label_id, asset_id)
      event_id, label_id, asset_id, action, decision_id, created_at
    FROM asset_label_membership_event
    WHERE label_id = ${labelId} AND asset_id = ANY(${assetIds})
    ORDER BY label_id, asset_id, created_at DESC, event_id DESC
  `;
  return new Map(rows.map((row) => [row.asset_id, row]));
};

const lockMemberships = async (executor, labelId, assetIds) => {
  for (const assetId of assetIds) {
    await executor`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${labelId}:${assetId}`}, 0))
    `;
  }
};

const insertMembershipEvents = async (
  executor,
  { action, assetIds, decisionId, labelId, latest },
) => {
  for (const assetId of assetIds) {
    await executor`
      INSERT INTO asset_label_membership_event (
        event_id, decision_id, label_id, asset_id, action,
        supersedes_event_id
      ) VALUES (
        ${identifier("label_event")}, ${decisionId}, ${labelId}, ${assetId},
        ${action}, ${latest.get(assetId)?.event_id || null}
      )
    `;
  }
};

export const createAssetLabelStore = (sql, { presentationRank }) => ({
  async assetLabels({ limit = 100, query = "" } = {}) {
    const parsedLimit = Number.parseInt(String(limit || 100), 10);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 250
    ) {
      throw typedError(
        "Label limit must be an integer from 1 to 250",
        400,
        "ASSET_LABEL_LIMIT_INVALID",
      );
    }
    const normalizedQuery = String(query || "").trim();
    if (normalizedQuery.length > 120) {
      throw typedError(
        "Label search is too long",
        400,
        "ASSET_LABEL_QUERY_INVALID",
      );
    }
    const search = `%${normalizedQuery}%`;
    const rows = await sql`
      SELECT label.label_id, label.display_name, label.status,
        label.created_at,
        count(membership.asset_id) FILTER (
          WHERE asset.state = 'active'
            AND cimmich_visibility_asset_rank(asset.asset_id)
              <= ${presentationRank()}
        )::int AS asset_count
      FROM asset_label label
      LEFT JOIN current_asset_label_membership membership
        ON membership.label_id = label.label_id
      LEFT JOIN asset ON asset.asset_id = membership.asset_id
      WHERE label.status = 'active'
        AND (${normalizedQuery} = '' OR label.display_name ILIKE ${search})
      GROUP BY label.label_id
      ORDER BY lower(label.display_name), label.label_id
      LIMIT ${parsedLimit}
    `;
    return { items: rows.map(projectLabel), schemaVersion };
  },

  async createAssetLabel({ actorId, commandId, displayName }) {
    const actor = cleanActor(actorId);
    const command = cleanCommand(commandId);
    const name = cleanDisplayName(displayName);
    const normalizedName = normalizeAssetLabelName(name);
    const requestDigest = digestRequest({
      actor,
      commandKind: "create",
      displayName: name,
      normalizedName,
    });
    return sql.begin(async (tx) => {
      const replayed = await replayCommand(tx, {
        commandId: command,
        requestDigest,
      });
      if (replayed) return replayed;
      const labelId = identifier("label");
      const inserted = await tx`
        INSERT INTO asset_label (
          label_id, display_name, normalized_name, created_by_actor_id
        ) VALUES (${labelId}, ${name}, ${normalizedName}, ${actor})
        ON CONFLICT (normalized_name) DO NOTHING
        RETURNING label_id, display_name, status, created_at
      `;
      const [label] = inserted.length
        ? inserted
        : await tx`
            SELECT label_id, display_name, status, created_at
            FROM asset_label
            WHERE normalized_name = ${normalizedName}
            LIMIT 1
          `;
      const response = {
        changed: inserted.length === 1,
        label: projectLabel({ ...label, asset_count: 0 }),
        schemaVersion,
      };
      await tx`
        INSERT INTO asset_label_command (
          command_id, actor_id, command_kind, request_digest, response
        ) VALUES (
          ${command}, ${actor}, 'create', ${requestDigest}, ${tx.json(response)}
        )
      `;
      return response;
    });
  },

  async changeAssetLabelMembership({
    action,
    actorId,
    assetIds,
    commandId,
    labelId,
  }) {
    if (!commandKinds.has(action) || !["attach", "detach"].includes(action)) {
      throw typedError(
        "Asset label action must be attach or detach",
        400,
        "ASSET_LABEL_ACTION_INVALID",
      );
    }
    const actor = cleanActor(actorId);
    const command = cleanCommand(commandId);
    const id = cleanLabelId(labelId);
    const targets = cleanAssetIds(assetIds);
    const requestDigest = digestRequest({
      action,
      actor,
      assetIds: targets,
      command,
      labelId: id,
    });
    return sql.begin(async (tx) => {
      const replayed = await replayCommand(tx, {
        commandId: command,
        requestDigest,
      });
      if (replayed) return replayed;
      const [label] = await tx`
        SELECT label_id FROM asset_label
        WHERE label_id = ${id} AND status = 'active'
        LIMIT 1
      `;
      if (!label) {
        throw typedError(
          "Cimmich label not found",
          404,
          "ASSET_LABEL_NOT_FOUND",
        );
      }
      await lockMemberships(tx, id, targets);
      const available = await tx`
        SELECT asset_id FROM asset
        WHERE asset_id = ANY(${targets}) AND state = 'active'
          AND cimmich_visibility_asset_rank(asset_id) <= ${presentationRank()}
      `;
      const availableIds = new Set(available.map((row) => row.asset_id));
      const missingAssetIds = targets.filter(
        (assetId) => !availableIds.has(assetId),
      );
      if (missingAssetIds.length) {
        throw typedError(
          "One or more Cimmich assets are unavailable in this viewing mode",
          404,
          "ASSET_LABEL_ASSET_NOT_FOUND",
          { missingAssetIds },
        );
      }
      const latest = await latestMembershipEvents(tx, {
        assetIds: targets,
        labelId: id,
      });
      const changedAssetIds = targets.filter((assetId) =>
        action === "attach"
          ? latest.get(assetId)?.action !== "attach"
          : latest.get(assetId)?.action === "attach",
      );
      const unchangedAssetIds = targets.filter(
        (assetId) => !changedAssetIds.includes(assetId),
      );
      const decisionId = identifier("label_decision");
      const response = {
        action,
        changed: changedAssetIds.length > 0,
        changedAssetIds,
        decisionId,
        labelId: id,
        schemaVersion,
        unchangedAssetIds,
      };
      await tx`
        INSERT INTO asset_label_command (
          command_id, actor_id, command_kind, request_digest, response
        ) VALUES (
          ${command}, ${actor}, ${action}, ${requestDigest}, ${tx.json(response)}
        )
      `;
      await tx`
        INSERT INTO asset_label_decision (
          decision_id, command_id, label_id, action, actor_id
        ) VALUES (${decisionId}, ${command}, ${id}, ${action}, ${actor})
      `;
      await insertMembershipEvents(tx, {
        action,
        assetIds: changedAssetIds,
        decisionId,
        labelId: id,
        latest,
      });
      return response;
    });
  },

  async undoAssetLabelDecision({ actorId, commandId, decisionId }) {
    const actor = cleanActor(actorId);
    const command = cleanCommand(commandId);
    const originalDecisionId = cleanDecisionId(decisionId);
    const requestDigest = digestRequest({
      actor,
      command,
      decisionId: originalDecisionId,
    });
    return sql.begin(async (tx) => {
      const replayed = await replayCommand(tx, {
        commandId: command,
        requestDigest,
      });
      if (replayed) return replayed;
      const [original] = await tx`
        SELECT decision_id, label_id, action
        FROM asset_label_decision
        WHERE decision_id = ${originalDecisionId}
          AND action IN ('attach','detach')
        LIMIT 1
      `;
      if (!original) {
        throw typedError(
          "Asset label decision not found",
          404,
          "ASSET_LABEL_DECISION_NOT_FOUND",
        );
      }
      const originalEvents = await tx`
        SELECT event_id, asset_id, action
        FROM asset_label_membership_event
        WHERE decision_id = ${originalDecisionId}
        ORDER BY asset_id
      `;
      const assetIds = originalEvents.map((event) => event.asset_id);
      await lockMemberships(tx, original.label_id, assetIds);
      const latest = await latestMembershipEvents(tx, {
        assetIds,
        labelId: original.label_id,
      });
      const changedAssetIds = originalEvents
        .filter(
          (event) => latest.get(event.asset_id)?.event_id === event.event_id,
        )
        .map((event) => event.asset_id);
      const skippedAssetIds = assetIds.filter(
        (assetId) => !changedAssetIds.includes(assetId),
      );
      const undoDecisionId = identifier("label_decision");
      const response = {
        changed: changedAssetIds.length > 0,
        changedAssetIds,
        decisionId: undoDecisionId,
        labelId: original.label_id,
        schemaVersion,
        skippedAssetIds,
        undidDecisionId: originalDecisionId,
      };
      await tx`
        INSERT INTO asset_label_command (
          command_id, actor_id, command_kind, request_digest, response
        ) VALUES (
          ${command}, ${actor}, 'undo', ${requestDigest}, ${tx.json(response)}
        )
      `;
      await tx`
        INSERT INTO asset_label_decision (
          decision_id, command_id, label_id, action, actor_id,
          undoes_decision_id
        ) VALUES (
          ${undoDecisionId}, ${command}, ${original.label_id}, 'undo', ${actor},
          ${originalDecisionId}
        )
      `;
      await insertMembershipEvents(tx, {
        action: original.action === "attach" ? "detach" : "attach",
        assetIds: changedAssetIds,
        decisionId: undoDecisionId,
        labelId: original.label_id,
        latest,
      });
      return response;
    });
  },
});

export const assetLabelContract = Object.freeze({ schemaVersion });
