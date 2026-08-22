import { createHash, randomUUID } from "node:crypto";
import {
  claimConnectionCommand,
  completeConnectionCommand,
} from "./connection-command-ledger.mjs";
import { createConnectionHubRecorder } from "./connection-hubs.mjs";

export const connectionFactSchemaVersion = "cimmich.connection-facts.v4";

const formerModifierId = "connectionmodifier_former";

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

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

const cleanLabel = (value, field = "label", maximum = 80) => {
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

const slugFor = (label) => {
  const base = label
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 52)
    .replaceAll(/_+$/g, "");
  return /^[a-z]/.test(base)
    ? base
    : `custom_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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
  if (value === undefined || value === null) return null;
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

const cleanContextIds = (value) => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 12) {
    throw typedError(
      "contextIds must contain at most 12 relationship contexts",
      400,
      "CONNECTION_CONTEXTS_INVALID",
    );
  }
  const contextIds = [
    ...new Set(value.map((item) => String(item || "").trim())),
  ];
  if (
    contextIds.some(
      (contextId) => !/^(event|object|place)_[0-9a-f]{32}$/.test(contextId),
    )
  ) {
    throw typedError(
      "contextIds contains an invalid relationship context",
      400,
      "CONNECTION_CONTEXTS_INVALID",
    );
  }
  return contextIds;
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

const projectDate = (value) => {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
};

const projectType = (row) => ({
  inverseLabel: row.inverse_label,
  inversePastLabel: row.inverse_past_label || null,
  label: row.label,
  ownerCreated: !row.is_system_seed,
  pastLabel: row.past_label || null,
  semanticKind: row.semantic_kind,
  sourceKind: row.source_kind,
  symmetric: Boolean(row.is_symmetric),
  targetKind: row.target_kind,
  temporalMode: row.temporal_mode,
  typeId: row.type_id,
});

const projectModifier = (row) => ({
  behavior: row.behavior,
  label: row.label,
  modifierId: row.modifier_id,
  ownerCreated: !row.is_system_seed,
});

const rowModifiers = (row) =>
  Array.isArray(row.modifiers)
    ? row.modifiers.map((modifier) => ({
        behavior: modifier.behavior,
        label: modifier.label,
        modifierId: modifier.modifierId,
        ownerCreated: Boolean(modifier.ownerCreated),
      }))
    : [];

const rowContexts = (row) =>
  Array.isArray(row.contexts)
    ? row.contexts.map((context) => ({
        displayName: context.displayName,
        id: context.id,
        kind: context.kind,
        typeKind: context.typeKind,
      }))
    : [];

export const displayedConnectionFactLabel = (row, modifiers) => {
  const inverse = row.direction === "incoming";
  const hasHistoricalModifier = modifiers.some(
    ({ behavior }) => behavior === "historical",
  );
  const base =
    row.validity === "past" && !hasHistoricalModifier
      ? inverse
        ? row.inverse_past_label || row.inverse_label
        : row.past_label || row.label
      : inverse
        ? row.inverse_label
        : row.label;
  const modifierLabels = modifiers.map(({ label }) => label);
  return modifierLabels.length
    ? `${base} (${modifierLabels.join(", ")})`
    : base;
};

const projectFact = (row) => {
  const modifiers = rowModifiers(row);
  return {
    contexts: rowContexts(row),
    dateEnd: projectDate(row.date_end),
    dateStart: projectDate(row.date_start),
    direction: row.direction,
    displayLabel: displayedConnectionFactLabel(row, modifiers),
    factId: row.fact_id,
    modifiers,
    note: row.note || null,
    other: {
      displayName: row.other_name || "",
      id: row.other_id,
      kind: row.other_kind,
      typeKind: row.other_type_kind || null,
    },
    semanticKind: row.semantic_kind,
    typeId: row.type_id,
    validity: row.validity,
  };
};

const suggestionKey = (parts) =>
  `connection-suggestion:${createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 40)}`;

export const createConnectionFactStore = ({ presentationRank, sql }) => {
  const recordHub = createConnectionHubRecorder({ presentationRank, sql });
  const listModifiers = async () => {
    const rows = await sql`
      SELECT * FROM connection_modifier WHERE state = 'active'
      ORDER BY is_system_seed DESC, lower(label), modifier_id
    `;
    return rows.map(projectModifier);
  };

  const listTypes = async ({ targetKind = "" } = {}) => {
    const kind = String(targetKind || "").trim();
    if (kind && !["person", "place", "object"].includes(kind)) {
      throw typedError(
        "targetKind must be person, place, or object",
        400,
        "CONNECTION_TARGET_KIND_INVALID",
      );
    }
    const rows = kind
      ? await sql`
          SELECT * FROM connection_type
          WHERE source_kind = 'person' AND target_kind = ${kind} AND state = 'active'
          ORDER BY is_system_seed DESC, lower(label), type_id
        `
      : await sql`
          SELECT * FROM connection_type
          WHERE source_kind = 'person' AND state = 'active'
          ORDER BY target_kind, is_system_seed DESC, lower(label), type_id
        `;
    return rows.map(projectType);
  };

  const requireVisiblePerson = async (executor, personId) => {
    const [person] = await executor`
      SELECT person_id, display_name FROM current_person
      WHERE person_id = ${personId} AND subject_kind = 'person' AND status = 'active'
        AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
      LIMIT 1
    `;
    if (!person) {
      throw typedError("Cimmich person not found", 404, "PERSON_NOT_FOUND");
    }
    return person;
  };

  const readFacts = async (executor, personId) => {
    const rows = await executor`
      SELECT fact.fact_id, fact.type_id, fact.validity, fact.date_start,
        fact.date_end, fact.note, type.label, type.past_label,
        type.inverse_label, type.inverse_past_label, type.semantic_kind,
        coalesce(modifiers.items, '[]'::jsonb) AS modifiers,
        coalesce(contexts.items, '[]'::jsonb) AS contexts,
        CASE WHEN fact.source_id = ${personId} THEN 'outgoing' ELSE 'incoming' END AS direction,
        CASE WHEN fact.source_id = ${personId} THEN fact.target_kind ELSE 'person' END AS other_kind,
        CASE WHEN fact.source_id = ${personId} THEN fact.target_id ELSE fact.source_id END AS other_id,
        CASE WHEN fact.source_id = ${personId}
          THEN coalesce(target_person.display_name, target_context.display_name)
          ELSE source_person.display_name END AS other_name,
        CASE WHEN fact.source_id = ${personId}
          THEN coalesce(target_context.place_kind, target_context.object_kind) ELSE NULL END AS other_type_kind
      FROM current_connection_fact fact
      JOIN connection_type type ON type.type_id = fact.type_id AND type.state = 'active'
      JOIN current_person source_person ON source_person.person_id = fact.source_id
        AND source_person.subject_kind = 'person' AND source_person.status = 'active'
      LEFT JOIN current_person target_person ON fact.target_kind = 'person'
        AND target_person.person_id = fact.target_id
        AND target_person.subject_kind = 'person' AND target_person.status = 'active'
      LEFT JOIN context_entity target_context ON fact.target_kind IN ('place','object')
        AND target_context.entity_id = fact.target_id
        AND target_context.entity_kind = fact.target_kind AND target_context.status = 'active'
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'behavior', modifier.behavior,
          'label', modifier.label,
          'modifierId', modifier.modifier_id,
          'ownerCreated', NOT modifier.is_system_seed
        ) ORDER BY (modifier.behavior = 'historical') DESC, lower(modifier.label), modifier.modifier_id) AS items
        FROM (
          SELECT modifier.*
          FROM connection_fact_event_modifier event_modifier
          JOIN connection_modifier modifier USING (modifier_id)
          WHERE event_modifier.event_id = fact.event_id AND modifier.state = 'active'
          UNION ALL
          SELECT modifier.* FROM connection_modifier modifier
          WHERE modifier.modifier_id = ${formerModifierId}
            AND fact.target_kind = 'person' AND fact.validity = 'past'
            AND NOT EXISTS (
              SELECT 1 FROM connection_fact_event_modifier event_modifier
              WHERE event_modifier.event_id = fact.event_id
                AND event_modifier.modifier_id = modifier.modifier_id
            )
        ) modifier
      ) modifiers ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'displayName', context.display_name,
          'id', context.entity_id,
          'kind', context.entity_kind,
          'typeKind', coalesce(context.place_kind, context.object_kind, context.event_kind)
        ) ORDER BY context.entity_kind, lower(context.display_name), context.entity_id) AS items
        FROM current_connection_fact_context fact_context
        JOIN context_entity context ON context.entity_id = fact_context.context_entity_id
          AND context.status IN ('active','hidden')
        WHERE fact_context.fact_id = fact.fact_id
          AND cimmich_visibility_context_entity_rank(context.entity_id) <= ${presentationRank()}
      ) contexts ON true
      WHERE (fact.source_id = ${personId}
          OR (fact.target_kind = 'person' AND fact.target_id = ${personId}))
        AND cimmich_visibility_person_rank(source_person.person_id) <= ${presentationRank()}
        AND ((fact.target_kind = 'person' AND target_person.person_id IS NOT NULL
              AND cimmich_visibility_person_rank(target_person.person_id) <= ${presentationRank()})
          OR (fact.target_kind IN ('place','object') AND target_context.entity_id IS NOT NULL
              AND cimmich_visibility_context_entity_rank(target_context.entity_id) <= ${presentationRank()}))
      ORDER BY other_kind, lower(CASE WHEN fact.source_id = ${personId}
        THEN coalesce(target_person.display_name, target_context.display_name)
        ELSE source_person.display_name END), lower(type.label), fact.fact_id
    `;
    return rows.map(projectFact);
  };

  const readSuggestions = async (personId, facts) => {
    const rows = await sql`
      WITH coworkers AS (
        SELECT coworker.fact_id AS coworker_fact_id,
          CASE WHEN coworker.source_id = ${personId}
            THEN coworker.target_id ELSE coworker.source_id END AS coworker_id
        FROM current_connection_fact coworker
        JOIN connection_type coworker_type ON coworker_type.type_id = coworker.type_id
          AND coworker_type.semantic_kind = 'coworker'
        WHERE coworker.target_kind = 'person'
          AND (coworker.source_id = ${personId} OR coworker.target_id = ${personId})
      )
      SELECT coworkers.coworker_fact_id, coworker.person_id AS coworker_id,
        coworker.display_name AS coworker_name, workplace.fact_id AS evidence_fact_id,
        workplace.target_id AS place_id, place.display_name AS place_name,
        workplace.validity, workplace.date_start, workplace.date_end,
        workplace_type.type_id, workplace_type.label, workplace_type.past_label,
        workplace_type.semantic_kind
      FROM coworkers
      JOIN current_person coworker ON coworker.person_id = coworkers.coworker_id
        AND coworker.subject_kind = 'person' AND coworker.status = 'active'
      JOIN current_connection_fact workplace ON workplace.source_id = coworker.person_id
        AND workplace.target_kind = 'place'
      JOIN connection_type workplace_type ON workplace_type.type_id = workplace.type_id
        AND workplace_type.semantic_kind = 'works_at'
      JOIN context_entity place ON place.entity_id = workplace.target_id
        AND place.entity_kind = 'place' AND place.status = 'active'
      WHERE cimmich_visibility_person_rank(coworker.person_id) <= ${presentationRank()}
        AND cimmich_visibility_context_entity_rank(place.entity_id) <= ${presentationRank()}
      ORDER BY lower(place.display_name), lower(coworker.display_name), workplace.fact_id
      LIMIT 24
    `;
    if (!rows.length) return [];
    const decisions = await sql`
      SELECT suggestion_key FROM connection_suggestion_decision
      WHERE person_id = ${personId}
    `;
    const decided = new Set(decisions.map((row) => row.suggestion_key));
    const existing = new Set(
      facts
        .filter(
          ({ semanticKind, other }) =>
            semanticKind === "works_at" && other.kind === "place",
        )
        .map(({ other }) => other.id),
    );
    const suggestions = [];
    const seenPlaces = new Set();
    for (const row of rows) {
      if (existing.has(row.place_id) || seenPlaces.has(row.place_id)) continue;
      const key = suggestionKey([
        personId,
        row.coworker_fact_id,
        row.evidence_fact_id,
        row.place_id,
        row.validity,
      ]);
      if (decided.has(key)) continue;
      seenPlaces.add(row.place_id);
      suggestions.push({
        candidate: {
          dateEnd: projectDate(row.date_end),
          dateStart: projectDate(row.date_start),
          targetId: row.place_id,
          targetKind: "place",
          typeId: row.type_id,
          validity: row.validity,
        },
        confidence: row.date_start || row.date_end ? "stronger" : "possible",
        displayLabel:
          row.validity === "past" ? row.past_label || row.label : row.label,
        evidence: {
          coworkerFactId: row.coworker_fact_id,
          coworkerId: row.coworker_id,
          coworkerName: row.coworker_name,
          workplaceFactId: row.evidence_fact_id,
        },
        explanation: `${row.coworker_name} is recorded as a co-worker and ${
          row.validity === "past" ? "worked" : "works"
        } at ${row.place_name}. This is a lead, not a recorded fact.`,
        suggestionKey: key,
        target: {
          displayName: row.place_name,
          id: row.place_id,
          kind: "place",
        },
      });
    }
    return suggestions;
  };

  const readPerson = async ({ personId }) => {
    const id = cleanId(personId, "personId");
    await requireVisiblePerson(sql, id);
    const facts = await readFacts(sql, id);
    return {
      facts,
      schemaVersion: connectionFactSchemaVersion,
      suggestions: await readSuggestions(id, facts),
    };
  };

  const createType = async ({ actorId, commandId, input }) => {
    const command = cleanCommandId(commandId);
    const actor = cleanActor(actorId);
    const label = cleanLabel(input?.label);
    const inverseLabel = cleanLabel(
      input?.inverseLabel || label,
      "inverseLabel",
    );
    const targetKind = String(input?.targetKind || "person");
    if (!["person", "place", "object"].includes(targetKind)) {
      throw typedError(
        "targetKind must be person, place, or object",
        400,
        "CONNECTION_TARGET_KIND_INVALID",
      );
    }
    const temporalMode =
      targetKind === "person" || input?.temporalMode === "current_or_past"
        ? "current_or_past"
        : "none";
    const pastLabel =
      temporalMode === "current_or_past"
        ? cleanLabel(
            input?.pastLabel ||
              (targetKind === "person" ? `${label} (Former)` : ""),
            "pastLabel",
            96,
          )
        : null;
    const inversePastLabel =
      temporalMode === "current_or_past"
        ? cleanLabel(
            input?.inversePastLabel ||
              (targetKind === "person"
                ? `${inverseLabel} (Former)`
                : pastLabel),
            "inversePastLabel",
            96,
          )
        : null;
    const symmetric = targetKind === "person" && Boolean(input?.symmetric);
    if (
      symmetric &&
      (label !== inverseLabel || pastLabel !== inversePastLabel)
    ) {
      throw typedError(
        "Symmetric connection labels must match from both sides",
        400,
        "CONNECTION_TYPE_SYMMETRY_INVALID",
      );
    }
    return sql.begin(async (tx) => {
      const claim = await claimConnectionCommand(tx, {
        actorId: actor,
        commandId: command,
        operation: "connection.create_type",
        payload: {
          inverseLabel,
          inversePastLabel,
          label,
          pastLabel,
          symmetric,
          targetKind,
          temporalMode,
        },
      });
      if (claim.response) return claim.response;
      const baseSlug = slugFor(label);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`connection-type:${baseSlug}`}, 0))`;
      const [existing] = await tx`
        SELECT * FROM connection_type WHERE source_kind = 'person' AND target_kind = ${targetKind}
          AND lower(label) = lower(${label}) AND state = 'active' LIMIT 1
      `;
      if (existing) {
        const response = {
          replayed: true,
          schemaVersion: connectionFactSchemaVersion,
          type: projectType(existing),
        };
        return completeConnectionCommand(tx, {
          commandId: command,
          response,
        });
      }
      const [collision] =
        await tx`SELECT 1 FROM connection_type WHERE slug = ${baseSlug}`;
      const slug = collision
        ? `${baseSlug.slice(0, 48)}_${randomUUID().replaceAll("-", "").slice(0, 8)}`
        : baseSlug;
      const typeId = `connectiontype_custom_${randomUUID().replaceAll("-", "")}`;
      const [created] = await tx`
        INSERT INTO connection_type (type_id, slug, label, past_label, inverse_label,
          inverse_past_label, source_kind, target_kind, is_symmetric, temporal_mode,
          semantic_kind, is_system_seed, command_id, actor_id)
        VALUES (${typeId}, ${slug}, ${label}, ${pastLabel}, ${inverseLabel},
          ${inversePastLabel}, 'person', ${targetKind}, ${symmetric}, ${temporalMode},
          ${slug}, false, ${command}, ${actor}) RETURNING *
      `;
      const response = {
        replayed: false,
        schemaVersion: connectionFactSchemaVersion,
        type: projectType(created),
      };
      return completeConnectionCommand(tx, { commandId: command, response });
    });
  };

  const createModifier = async ({ actorId, commandId, input }) => {
    const command = cleanCommandId(commandId);
    const actor = cleanActor(actorId);
    const label = cleanLabel(input?.label, "label", 64);
    return sql.begin(async (tx) => {
      const claim = await claimConnectionCommand(tx, {
        actorId: actor,
        commandId: command,
        operation: "connection.create_modifier",
        payload: { label },
      });
      if (claim.response) return claim.response;
      const baseSlug = slugFor(label);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`connection-modifier:${baseSlug}`}, 0))`;
      const [existing] = await tx`
        SELECT * FROM connection_modifier
        WHERE lower(label) = lower(${label}) AND state = 'active' LIMIT 1
      `;
      if (existing) {
        const response = {
          modifier: projectModifier(existing),
          replayed: true,
          schemaVersion: connectionFactSchemaVersion,
        };
        return completeConnectionCommand(tx, {
          commandId: command,
          response,
        });
      }
      const [collision] =
        await tx`SELECT 1 FROM connection_modifier WHERE slug = ${baseSlug}`;
      const slug = collision
        ? `${baseSlug.slice(0, 48)}_${randomUUID().replaceAll("-", "").slice(0, 8)}`
        : baseSlug;
      const modifierId = `connectionmodifier_custom_${randomUUID().replaceAll("-", "")}`;
      const [created] = await tx`
        INSERT INTO connection_modifier (
          modifier_id, slug, label, behavior, is_system_seed, command_id, actor_id
        ) VALUES (
          ${modifierId}, ${slug}, ${label}, 'qualifier', false, ${command}, ${actor}
        ) RETURNING *
      `;
      const response = {
        modifier: projectModifier(created),
        replayed: false,
        schemaVersion: connectionFactSchemaVersion,
      };
      return completeConnectionCommand(tx, { commandId: command, response });
    });
  };

  const record = async ({ actorId, commandId, input, personId }) => {
    const command = cleanCommandId(commandId);
    const actor = cleanActor(actorId);
    const sourceId = cleanId(personId || input?.sourceId, "sourceId");
    const targetId = cleanId(input?.targetId, "targetId");
    const targetKind = String(input?.targetKind || "");
    if (!["person", "place", "object"].includes(targetKind)) {
      throw typedError(
        "targetKind must be person, place, or object",
        400,
        "CONNECTION_TARGET_KIND_INVALID",
      );
    }
    const typeId = cleanId(input?.typeId, "typeId");
    const dateStart = cleanDate(input?.dateStart, "dateStart");
    const dateEnd = cleanDate(input?.dateEnd, "dateEnd");
    if (dateStart && dateEnd && dateEnd < dateStart) {
      throw typedError(
        "dateEnd must not be before dateStart",
        400,
        "CONNECTION_DATE_ORDER_INVALID",
      );
    }
    const note = cleanOptionalText(input?.note, 500, "note");
    const suppliedModifierIds = cleanModifierIds(input?.modifierIds);
    const suppliedContextIds = cleanContextIds(input?.contextIds);
    const suppliedSuggestionKey = cleanOptionalText(
      input?.suggestionKey,
      160,
      "suggestionKey",
    );
    return sql.begin(async (tx) => {
      const claim = await claimConnectionCommand(tx, {
        actorId: actor,
        commandId: command,
        operation: "connection.record_fact",
        payload: {
          contextIds: suppliedContextIds?.toSorted() ?? null,
          dateEnd,
          dateStart,
          modifierIds: suppliedModifierIds?.toSorted() ?? null,
          note,
          sourceId,
          suggestionKey: suppliedSuggestionKey,
          targetId,
          targetKind,
          typeId,
          validity: String(input?.validity || ""),
        },
      });
      if (claim.response) return claim.response;
      await requireVisiblePerson(tx, sourceId);
      const [type] =
        await tx`SELECT * FROM connection_type WHERE type_id = ${typeId} AND state = 'active'`;
      if (!type || type.target_kind !== targetKind) {
        throw typedError(
          "Connection type does not match the selected connection",
          400,
          "CONNECTION_TYPE_INVALID",
        );
      }
      const requestedModifierIds =
        suppliedModifierIds ??
        (targetKind === "person" && input?.validity === "past"
          ? [formerModifierId]
          : []);
      const modifiers = requestedModifierIds.length
        ? await tx`
            SELECT * FROM connection_modifier
            WHERE modifier_id = ANY(${requestedModifierIds}::text[]) AND state = 'active'
          `
        : [];
      if (modifiers.length !== requestedModifierIds.length) {
        throw typedError(
          "One or more connection modifiers are unavailable",
          400,
          "CONNECTION_MODIFIER_INVALID",
        );
      }
      const hasFormer = modifiers.some(
        ({ behavior }) => behavior === "historical",
      );
      if (hasFormer && targetKind !== "person") {
        throw typedError(
          "Former applies only to Person relationships",
          400,
          "CONNECTION_MODIFIER_SCOPE_INVALID",
        );
      }
      const validity =
        targetKind === "person"
          ? hasFormer
            ? "past"
            : "current"
          : type.temporal_mode === "current_or_past"
            ? input?.validity === "past"
              ? "past"
              : "current"
            : "timeless";
      const pairLock =
        type.is_symmetric && targetKind === "person"
          ? [sourceId, targetId].sort().join(":")
          : `${sourceId}:${targetId}`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`connection-fact:${typeId}:${pairLock}`}, 0))`;
      const [existing] =
        type.is_symmetric && targetKind === "person"
          ? await tx`
            SELECT fact.* FROM current_connection_fact fact
            WHERE fact.type_id = ${typeId} AND fact.target_kind = 'person'
              AND ((fact.source_id = ${sourceId} AND fact.target_id = ${targetId})
                OR (fact.source_id = ${targetId} AND fact.target_id = ${sourceId}))
            LIMIT 1
          `
          : await tx`
            SELECT fact.* FROM current_connection_fact fact
            WHERE fact.type_id = ${typeId} AND fact.source_id = ${sourceId}
              AND fact.target_kind = ${targetKind} AND fact.target_id = ${targetId}
            LIMIT 1
          `;
      const factId =
        existing?.fact_id ||
        `connectionfact_${randomUUID().replaceAll("-", "")}`;
      const currentContexts = existing
        ? await tx`
            SELECT * FROM current_connection_fact_context
            WHERE fact_id = ${factId}
          `
        : [];
      const requestedContextIds =
        suppliedContextIds ??
        currentContexts.map(({ context_entity_id }) => context_entity_id);
      const relationshipContexts = requestedContextIds.length
        ? await tx`
            SELECT entity_id FROM context_entity
            WHERE entity_id = ANY(${requestedContextIds}::text[])
              AND status IN ('active','hidden')
              AND cimmich_visibility_context_entity_rank(entity_id) <= ${presentationRank()}
          `
        : [];
      if (relationshipContexts.length !== requestedContextIds.length) {
        throw typedError(
          "One or more relationship contexts are unavailable",
          400,
          "CONNECTION_CONTEXT_INVALID",
        );
      }
      const eventId = `connectionevent_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO connection_fact_event (event_id, fact_id, action, source_kind,
          source_id, target_kind, target_id, type_id, validity, date_start, date_end,
          note, command_id, actor_id, suggestion_key, supersedes_event_id)
        VALUES (${eventId}, ${factId}, 'record', 'person', ${sourceId}, ${targetKind},
          ${targetId}, ${typeId}, ${validity}, ${dateStart}, ${dateEnd}, ${note},
          ${command}, ${actor}, ${suppliedSuggestionKey}, ${existing?.event_id || null})
      `;
      for (const modifier of modifiers) {
        await tx`
          INSERT INTO connection_fact_event_modifier (event_id, modifier_id)
          VALUES (${eventId}, ${modifier.modifier_id})
        `;
      }
      const requestedContextSet = new Set(requestedContextIds);
      const currentContextById = new Map(
        currentContexts.map((context) => [context.context_entity_id, context]),
      );
      for (const contextId of requestedContextIds) {
        if (currentContextById.has(contextId)) continue;
        await tx`
          INSERT INTO connection_fact_context_event (
            context_event_id, link_id, fact_id, context_entity_id, action,
            command_id, actor_id
          ) VALUES (
            ${`connectioncontextevent_${randomUUID().replaceAll("-", "")}`},
            ${`connectioncontextlink_${randomUUID().replaceAll("-", "")}`},
            ${factId}, ${contextId}, 'attach', ${command}, ${actor}
          )
        `;
      }
      for (const context of currentContexts) {
        if (requestedContextSet.has(context.context_entity_id)) continue;
        await tx`
          INSERT INTO connection_fact_context_event (
            context_event_id, link_id, fact_id, context_entity_id, action,
            command_id, actor_id, supersedes_event_id
          ) VALUES (
            ${`connectioncontextevent_${randomUUID().replaceAll("-", "")}`},
            ${context.link_id}, ${factId}, ${context.context_entity_id}, 'detach',
            ${command}, ${actor}, ${context.context_event_id}
          )
        `;
      }
      if (suppliedSuggestionKey) {
        await tx`
          INSERT INTO connection_suggestion_decision
            (suggestion_key, person_id, state, command_id, actor_id)
          VALUES (${suppliedSuggestionKey}, ${sourceId}, 'confirmed', ${command}, ${actor})
          ON CONFLICT (suggestion_key) DO NOTHING
        `;
      }
      const facts = await readFacts(tx, sourceId);
      const response = {
        fact: facts.find(({ factId: id }) => id === factId) || null,
        replayed: false,
        schemaVersion: connectionFactSchemaVersion,
      };
      return completeConnectionCommand(tx, { commandId: command, response });
    });
  };

  const retract = async ({ actorId, commandId, factId, personId }) => {
    const command = cleanCommandId(commandId);
    const actor = cleanActor(actorId);
    const id = cleanId(factId, "factId");
    const sourcePersonId = cleanId(personId, "personId");
    return sql.begin(async (tx) => {
      const claim = await claimConnectionCommand(tx, {
        actorId: actor,
        commandId: command,
        operation: "connection.retract_fact",
        payload: { factId: id, personId: sourcePersonId },
      });
      if (claim.response) return claim.response;
      await requireVisiblePerson(tx, sourcePersonId);
      const [current] = await tx`
        SELECT * FROM current_connection_fact WHERE fact_id = ${id}
          AND (source_id = ${sourcePersonId} OR (target_kind = 'person' AND target_id = ${sourcePersonId}))
        LIMIT 1
      `;
      if (!current)
        throw typedError(
          "Recorded connection not found",
          404,
          "CONNECTION_FACT_NOT_FOUND",
        );
      const eventId = `connectionevent_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO connection_fact_event (event_id, fact_id, action, source_kind,
          source_id, target_kind, target_id, type_id, validity, date_start, date_end,
          note, command_id, actor_id, suggestion_key, supersedes_event_id)
        VALUES (${eventId}, ${id},
          'retract', ${current.source_kind}, ${current.source_id}, ${current.target_kind},
          ${current.target_id}, ${current.type_id}, ${current.validity}, ${current.date_start},
          ${current.date_end}, ${current.note}, ${command}, ${actor},
          ${current.suggestion_key}, ${current.event_id})
      `;
      await tx`
        INSERT INTO connection_fact_event_modifier (event_id, modifier_id)
        SELECT ${eventId}, modifier_id
        FROM connection_fact_event_modifier WHERE event_id = ${current.event_id}
      `;
      const response = {
        factId: id,
        replayed: false,
        schemaVersion: connectionFactSchemaVersion,
      };
      return completeConnectionCommand(tx, { commandId: command, response });
    });
  };

  const dismissSuggestion = async ({
    actorId,
    commandId,
    personId,
    suggestion,
  }) => {
    const command = cleanCommandId(commandId);
    const actor = cleanActor(actorId);
    const id = cleanId(personId, "personId");
    const key = cleanId(suggestion, "suggestionKey");
    return sql.begin(async (tx) => {
      const claim = await claimConnectionCommand(tx, {
        actorId: actor,
        commandId: command,
        operation: "connection.dismiss_suggestion",
        payload: { personId: id, suggestionKey: key },
      });
      if (claim.response) return claim.response;
      await requireVisiblePerson(tx, id);
      const inserted = await tx`
        INSERT INTO connection_suggestion_decision
          (suggestion_key, person_id, state, command_id, actor_id)
        VALUES (${key}, ${id}, 'dismissed', ${command}, ${actor})
        ON CONFLICT (suggestion_key) DO NOTHING
        RETURNING suggestion_key
      `;
      if (inserted.length === 0) {
        const [existing] = await tx`
          SELECT person_id, state FROM connection_suggestion_decision
          WHERE suggestion_key = ${key}
        `;
        if (existing?.person_id !== id || existing?.state !== "dismissed") {
          throw typedError(
            "Suggestion decision conflicts with its existing owner or state",
            409,
            "CONNECTION_SUGGESTION_DECISION_CONFLICT",
          );
        }
      }
      const response = {
        replayed: false,
        schemaVersion: connectionFactSchemaVersion,
        suggestionKey: key,
      };
      return completeConnectionCommand(tx, { commandId: command, response });
    });
  };

  return {
    createModifier,
    createType,
    dismissSuggestion,
    listModifiers,
    listTypes,
    readPerson,
    record,
    recordHub,
    retract,
  };
};
