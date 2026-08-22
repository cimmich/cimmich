import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.connection-facts.v4";

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "CONNECTION_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanActor = (value) =>
  String(value || "local-operator")
    .trim()
    .slice(0, 120) || "local-operator";

const cleanId = (value, field) => {
  const id = String(value || "").trim();
  if (!id || id.length > 160) {
    throw typedError(
      `${field} is required`,
      400,
      "CONNECTION_ENDPOINT_INVALID",
    );
  }
  return id;
};

const cleanLabel = (value, field, maximum) => {
  const label = String(value || "")
    .trim()
    .replaceAll(/\s+/g, " ");
  if (!label || label.length > maximum) {
    throw typedError(
      `${field} must contain 1 to ${maximum} characters`,
      400,
      "CONNECTION_TYPE_LABEL_INVALID",
    );
  }
  return label;
};

const cleanDate = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const date = String(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date
  ) {
    throw typedError(
      `${field} must be an ISO date`,
      400,
      "CONNECTION_DATE_INVALID",
    );
  }
  return date;
};

const cleanOptionalText = (value, maximum, field) => {
  if (value === undefined || value === null || String(value).trim() === "")
    return null;
  const text = String(value).trim().replaceAll(/\s+/g, " ");
  if (text.length > maximum) {
    throw typedError(
      `${field} must contain at most ${maximum} characters`,
      400,
      "CONNECTION_TEXT_INVALID",
    );
  }
  return text;
};

const cleanModifierIds = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw typedError(
      "modifierIds must contain at most 12 connection modifiers",
      400,
      "CONNECTION_MODIFIERS_INVALID",
    );
  }
  const modifierIds = [
    ...new Set(value.map((item) => String(item || "").trim())),
  ];
  if (
    modifierIds.some(
      (modifierId) => !/^connectionmodifier_[a-z0-9_]{2,80}$/.test(modifierId),
    )
  ) {
    throw typedError(
      "modifierIds contains an invalid connection modifier",
      400,
      "CONNECTION_MODIFIERS_INVALID",
    );
  }
  return modifierIds;
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

export const createConnectionHubRecorder = ({ presentationRank, sql }) =>
  async function recordHub({ actorId, commandId, input }) {
    const command = cleanCommandId(commandId);
    const actor = cleanActor(actorId);
    const hubKind = String(input?.hubKind || "").trim();
    const hubContract = {
      employer: { entityKind: "object", typeKind: "organisation" },
      group: { entityKind: "object", typeKind: "group" },
      home: { entityKind: "place", typeKind: "unlocated" },
    }[hubKind];
    if (!hubContract) {
      throw typedError(
        "hubKind must be home, employer, or group",
        400,
        "CONNECTION_HUB_KIND_INVALID",
      );
    }
    const createHub = !String(input?.hubEntityId || "").trim();
    const hubEntityId = createHub
      ? null
      : cleanId(input.hubEntityId, "hubEntityId");
    const displayName = createHub
      ? cleanLabel(input?.displayName, "displayName", 160)
      : null;
    if (
      !Array.isArray(input?.members) ||
      input.members.length < 2 ||
      input.members.length > 50
    ) {
      throw typedError(
        "members must contain 2 to 50 people",
        400,
        "CONNECTION_HUB_MEMBERS_INVALID",
      );
    }
    const members = input.members.map((member, index) => {
      const dateStart = cleanDate(
        member?.dateStart,
        `members[${index}].dateStart`,
      );
      const dateEnd = cleanDate(member?.dateEnd, `members[${index}].dateEnd`);
      if (dateStart && dateEnd && dateEnd < dateStart) {
        throw typedError(
          "A member end date must not be before its start date",
          400,
          "CONNECTION_DATE_ORDER_INVALID",
        );
      }
      return {
        dateEnd,
        dateStart,
        modifierIds: cleanModifierIds(member?.modifierIds),
        note: cleanOptionalText(member?.note, 500, `members[${index}].note`),
        personId: cleanId(member?.personId, `members[${index}].personId`),
        typeId: cleanId(member?.typeId, `members[${index}].typeId`),
        validity: member?.validity === "past" ? "past" : "current",
      };
    });
    if (
      new Set(members.map(({ personId }) => personId)).size !== members.length
    ) {
      throw typedError(
        "Each Person may appear only once in a hub command",
        400,
        "CONNECTION_HUB_MEMBERS_INVALID",
      );
    }
    const payload = { displayName, hubEntityId, hubKind, members };
    const requestDigest = digest(payload);

    return sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${command}, 0))`;
      const [previousCommand] = await tx`
        SELECT actor_id, request_digest, response
        FROM connection_hub_command WHERE command_id = ${command}
      `;
      if (previousCommand) {
        if (
          previousCommand.actor_id !== actor ||
          previousCommand.request_digest !== requestDigest
        ) {
          throw typedError(
            "commandId was already used for a different hub command",
            409,
            "CONNECTION_COMMAND_CONFLICT",
          );
        }
        return { ...previousCommand.response, replayed: true };
      }

      let target;
      if (createHub) {
        const entityId = `${hubContract.entityKind}_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO context_entity (
            entity_id, entity_kind, place_kind, object_kind, event_kind,
            display_name, date_precision, source_folders, status,
            directory_visibility, place_role
          ) VALUES (
            ${entityId}, ${hubContract.entityKind},
            ${hubContract.entityKind === "place" ? hubContract.typeKind : null},
            ${hubContract.entityKind === "object" ? hubContract.typeKind : null},
            NULL, ${displayName}, 'unknown', ${tx.json([])}, 'active', 'listed',
            ${hubContract.entityKind === "place" ? "location" : null}
          )
        `;
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${decisionId}, 'context_entity', ${entityId}, 'create', 'user', ${actor},
            'connection_hub_create', ${`Create ${hubKind} connection hub`},
            'receipt_cimmich_connection_hub_v1', 'private'
          )
        `;
        target = {
          displayName,
          entityId,
          entityKind: hubContract.entityKind,
          typeKind: hubContract.typeKind,
        };
      } else {
        const [existingHub] = await tx`
          SELECT entity_id, entity_kind, display_name,
            coalesce(place_kind, object_kind) AS type_kind
          FROM context_entity
          WHERE entity_id = ${hubEntityId} AND entity_kind = ${hubContract.entityKind}
            AND status = 'active'
            AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
          LIMIT 1 FOR UPDATE
        `;
        if (
          !existingHub ||
          (hubKind !== "home" && existingHub.type_kind !== hubContract.typeKind)
        ) {
          throw typedError(
            "The selected connection hub is unavailable",
            404,
            "CONNECTION_HUB_NOT_FOUND",
          );
        }
        target = {
          displayName: existingHub.display_name,
          entityId: existingHub.entity_id,
          entityKind: existingHub.entity_kind,
          typeKind: existingHub.type_kind,
        };
      }

      const personIds = members.map(({ personId }) => personId).sort();
      const visiblePeople = await tx`
        SELECT person_id, display_name FROM person
        WHERE person_id = ANY(${personIds}) AND subject_kind = 'person' AND status = 'active'
          AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
        ORDER BY person_id FOR UPDATE
      `;
      if (visiblePeople.length !== personIds.length) {
        throw typedError(
          "One or more selected People are unavailable",
          404,
          "PERSON_NOT_FOUND",
        );
      }
      const typeIds = [...new Set(members.map(({ typeId }) => typeId))];
      const types = await tx`
        SELECT * FROM connection_type
        WHERE type_id = ANY(${typeIds}) AND target_kind = ${hubContract.entityKind}
          AND source_kind = 'person' AND state = 'active'
      `;
      if (types.length !== typeIds.length) {
        throw typedError(
          "One or more hub roles are unavailable",
          400,
          "CONNECTION_TYPE_INVALID",
        );
      }
      const typeById = new Map(types.map((type) => [type.type_id, type]));
      const requestedModifierIds = [
        ...new Set(members.flatMap(({ modifierIds }) => modifierIds)),
      ];
      const modifiers = requestedModifierIds.length
        ? await tx`
            SELECT * FROM connection_modifier
            WHERE modifier_id = ANY(${requestedModifierIds}) AND state = 'active'
          `
        : [];
      if (modifiers.length !== requestedModifierIds.length) {
        throw typedError(
          "One or more connection modifiers are unavailable",
          400,
          "CONNECTION_MODIFIER_INVALID",
        );
      }
      const modifierById = new Map(
        modifiers.map((modifier) => [modifier.modifier_id, modifier]),
      );
      if (modifiers.some(({ behavior }) => behavior === "historical")) {
        throw typedError(
          "Use the member Former switch for a past hub role",
          400,
          "CONNECTION_MODIFIER_SCOPE_INVALID",
        );
      }

      const results = [];
      for (const [index, member] of members.entries()) {
        const type = typeById.get(member.typeId);
        const validity =
          type.temporal_mode === "current_or_past"
            ? member.validity
            : "timeless";
        const lockKey = `connection-fact:${member.typeId}:${member.personId}:${target.entityId}`;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const [existing] = await tx`
          SELECT * FROM current_connection_fact
          WHERE type_id = ${member.typeId} AND source_id = ${member.personId}
            AND target_kind = ${hubContract.entityKind} AND target_id = ${target.entityId}
          LIMIT 1
        `;
        const factId =
          existing?.fact_id ||
          `connectionfact_${randomUUID().replaceAll("-", "")}`;
        const eventId = `connectionevent_${randomUUID().replaceAll("-", "")}`;
        const memberCommandId = `${command.slice(0, 72)}.member.${index}.${digest(
          [member.personId, member.typeId],
        ).slice(0, 10)}`;
        await tx`
          INSERT INTO connection_fact_event (
            event_id, fact_id, action, source_kind, source_id, target_kind,
            target_id, type_id, validity, date_start, date_end, note,
            command_id, actor_id, supersedes_event_id
          ) VALUES (
            ${eventId}, ${factId}, 'record', 'person', ${member.personId},
            ${hubContract.entityKind}, ${target.entityId}, ${member.typeId}, ${validity},
            ${member.dateStart}, ${member.dateEnd}, ${member.note}, ${memberCommandId},
            ${actor}, ${existing?.event_id || null}
          )
        `;
        for (const modifierId of member.modifierIds) {
          await tx`
            INSERT INTO connection_fact_event_modifier (event_id, modifier_id)
            VALUES (${eventId}, ${modifierById.get(modifierId).modifier_id})
          `;
        }
        results.push({
          displayName:
            visiblePeople.find(({ person_id }) => person_id === member.personId)
              ?.display_name || "",
          factId,
          personId: member.personId,
          typeId: member.typeId,
          validity,
        });
      }
      const response = {
        createdHub: createHub,
        hub: target,
        members: results,
        replayed: false,
        schemaVersion,
      };
      await tx`
        INSERT INTO connection_hub_command (
          command_id, actor_id, request_digest, hub_kind, hub_entity_id,
          created_hub, response
        ) VALUES (
          ${command}, ${actor}, ${requestDigest}, ${hubKind}, ${target.entityId},
          ${createHub}, ${tx.json(response)}
        )
      `;
      return response;
    });
  };
