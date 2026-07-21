import { createHash } from "node:crypto";

const schemaVersion = "cimmich.person-details-display.v1";
const localOwnerId = "local-primary";
const sectionKeys = [
  "about",
  "at_a_glance",
  "identity_summary",
  "important_dates",
  "work",
  "contact_details",
  "social",
  "address",
  "private_notes",
];
const sectionKeySet = new Set(sectionKeys);
const visibilityKinds = new Set(["inherit", "show", "hide"]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

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

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor of 1 to 120 characters is required",
      400,
      "PERSON_DETAILS_DISPLAY_ACTOR_REQUIRED",
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
      "PERSON_DETAILS_DISPLAY_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const requireHumanPerson = async (
  executor,
  personId,
  { lock = false, presentationRank = () => 0 } = {},
) => {
  const id = String(personId || "").trim();
  const rows = lock
    ? await executor`
        SELECT person_id, subject_kind, status
        FROM person
        WHERE person_id = ${id} AND status IN ('active','hidden')
          AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
        FOR UPDATE
      `
    : await executor`
        SELECT person_id, subject_kind, status
        FROM person
        WHERE person_id = ${id} AND status IN ('active','hidden')
          AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
      `;
  const person = rows[0];
  if (!person || person.subject_kind !== "person") {
    throw typedError(
      "Person Details display human subject not found",
      404,
      "PERSON_DETAILS_DISPLAY_NOT_FOUND",
    );
  }
  return person;
};

const cleanDefaults = (value) => {
  if (!Array.isArray(value) || value.length !== sectionKeys.length) {
    throw typedError(
      "sections must contain every Person Details section exactly once",
      400,
      "PERSON_DETAILS_DISPLAY_INVALID",
    );
  }
  const sections = value.map((section) => ({
    order: Number(section?.order),
    sectionKey: String(section?.sectionKey || "").trim(),
    visible: section?.visible,
  }));
  if (
    sections.some(
      (section) =>
        !sectionKeySet.has(section.sectionKey) ||
        !Number.isInteger(section.order) ||
        section.order < 0 ||
        section.order >= sectionKeys.length ||
        typeof section.visible !== "boolean",
    ) ||
    new Set(sections.map((section) => section.sectionKey)).size !==
      sectionKeys.length ||
    new Set(sections.map((section) => section.order)).size !==
      sectionKeys.length
  ) {
    throw typedError(
      "Person Details sections, order and visibility are invalid",
      400,
      "PERSON_DETAILS_DISPLAY_INVALID",
    );
  }
  return sections.sort((left, right) => left.order - right.order);
};

const cleanOverrides = (value) => {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > sectionKeys.length
  ) {
    throw typedError(
      "overrides must contain 1 to 9 Person Details sections",
      400,
      "PERSON_DETAILS_DISPLAY_INVALID",
    );
  }
  const overrides = value.map((entry) => ({
    sectionKey: String(entry?.sectionKey || "").trim(),
    visibility: String(entry?.visibility || "").trim(),
  }));
  if (
    overrides.some(
      (entry) =>
        !sectionKeySet.has(entry.sectionKey) ||
        !visibilityKinds.has(entry.visibility),
    ) ||
    new Set(overrides.map((entry) => entry.sectionKey)).size !==
      overrides.length
  ) {
    throw typedError(
      "Person Details overrides are invalid",
      400,
      "PERSON_DETAILS_DISPLAY_INVALID",
    );
  }
  return overrides;
};

const loadDefaults = async (executor) => {
  const rows = await executor`
    SELECT section_key, display_order, is_visible
    FROM person_details_display_default
    WHERE owner_id = ${localOwnerId}
    ORDER BY display_order, section_key
  `;
  if (rows.length !== sectionKeys.length) {
    throw typedError(
      "Person Details display defaults are incomplete",
      503,
      "PERSON_DETAILS_DISPLAY_SCHEMA_INCOMPLETE",
    );
  }
  return {
    owner: { ownerId: localOwnerId, ownerKind: "local_library" },
    schemaVersion,
    sections: rows.map((row) => ({
      order: Number(row.display_order),
      sectionKey: row.section_key,
      visible: row.is_visible,
    })),
  };
};

const loadPersonDisplay = async (executor, personId, presentationRank) => {
  const person = await requireHumanPerson(executor, personId, {
    presentationRank,
  });
  const defaults = await loadDefaults(executor);
  const rows = await executor`
    SELECT section_key, visibility
    FROM person_details_display_override
    WHERE owner_id = ${localOwnerId} AND person_id = ${person.person_id}
  `;
  const overrides = new Map(
    rows.map((row) => [row.section_key, row.visibility]),
  );
  return {
    owner: defaults.owner,
    personId: person.person_id,
    schemaVersion,
    sections: defaults.sections.map((section) => {
      const visibility = overrides.get(section.sectionKey) || "inherit";
      return {
        defaultVisible: section.visible,
        effectiveVisible:
          visibility === "inherit" ? section.visible : visibility === "show",
        order: section.order,
        sectionKey: section.sectionKey,
        visibility,
      };
    }),
  };
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const id = cleanCommandId(commandId);
  const requestDigest = digest({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  const [existing] = await tx`
    SELECT command_kind, actor_id, request_digest, response
    FROM person_details_display_command
    WHERE command_id = ${id}
  `;
  if (existing) {
    if (
      existing.command_kind !== commandKind ||
      existing.actor_id !== actorId ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different Person Details display command",
        409,
        "PERSON_DETAILS_DISPLAY_COMMAND_CONFLICT",
      );
    }
    return { commandId: id, replay: { ...existing.response, replayed: true } };
  }
  return { commandId: id, requestDigest, replay: null };
};

const completeCommand = async (
  tx,
  { actorId, command, commandKind, personId = null, response },
) => {
  await tx`
    INSERT INTO person_details_display_command (
      command_id, command_kind, actor_id, person_id, request_digest, response
    ) VALUES (
      ${command.commandId}, ${commandKind}, ${actorId}, ${personId},
      ${command.requestDigest}, ${tx.json(response)}
    )
  `;
  return response;
};

export const createPersonDetailsDisplayStore = (
  sql,
  { presentationRank = () => 0 } = {},
) => ({
  getDefaults: () => loadDefaults(sql),

  getPersonDisplay: ({ personId }) =>
    loadPersonDisplay(sql, personId, presentationRank),

  async patchDefaults({ actorId, commandId, sections }) {
    const actor = cleanActor(actorId);
    const cleanSections = cleanDefaults(sections);
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "details_defaults_patch",
        payload: { sections: cleanSections },
      });
      if (command.replay) return command.replay;
      await tx`
        SELECT owner_id FROM person_profile_display_owner
        WHERE owner_id = ${localOwnerId}
        FOR UPDATE
      `;
      await tx`
        DELETE FROM person_details_display_default
        WHERE owner_id = ${localOwnerId}
      `;
      for (const section of cleanSections) {
        await tx`
          INSERT INTO person_details_display_default (
            owner_id, section_key, display_order, is_visible, updated_at
          ) VALUES (
            ${localOwnerId}, ${section.sectionKey}, ${section.order},
            ${section.visible}, now()
          )
        `;
      }
      const defaults = await loadDefaults(tx);
      const response = {
        commandId: command.commandId,
        defaults,
        replayed: false,
        schemaVersion,
        status: "applied",
      };
      return completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "details_defaults_patch",
        response,
      });
    });
  },

  async patchPersonDisplay({ actorId, commandId, overrides, personId }) {
    const actor = cleanActor(actorId);
    const cleanEntries = cleanOverrides(overrides);
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "person_details_patch",
        payload: { overrides: cleanEntries, personId },
      });
      if (command.replay) return command.replay;
      const person = await requireHumanPerson(tx, personId, {
        lock: true,
        presentationRank,
      });
      for (const override of cleanEntries) {
        await tx`
          INSERT INTO person_details_display_override (
            owner_id, person_id, section_key, visibility, updated_at
          ) VALUES (
            ${localOwnerId}, ${person.person_id}, ${override.sectionKey},
            ${override.visibility}, now()
          )
          ON CONFLICT (owner_id, person_id, section_key) DO UPDATE SET
            visibility = excluded.visibility,
            updated_at = excluded.updated_at
        `;
      }
      const display = await loadPersonDisplay(
        tx,
        person.person_id,
        presentationRank,
      );
      const response = {
        commandId: command.commandId,
        display,
        replayed: false,
        schemaVersion,
        status: "applied",
      };
      return completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "person_details_patch",
        personId: person.person_id,
        response,
      });
    });
  },
});

export const personDetailsDisplayContract = Object.freeze({
  schemaVersion,
  sectionKeys: [...sectionKeys],
  visibilityKinds: [...visibilityKinds],
});
