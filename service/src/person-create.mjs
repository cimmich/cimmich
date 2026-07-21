import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.person-create.v1";
const receiptId = "receipt_cimmich_expanded_demo_p1_contracts_v1";

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

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
      "PERSON_CREATE_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor is required",
      400,
      "PERSON_CREATE_ACTOR_REQUIRED",
    );
  }
  return actor;
};

const cleanName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name || name.length > 160) {
    throw typedError(
      "Person name must contain 1 to 160 characters",
      400,
      "PERSON_NAME_INVALID",
    );
  }
  return name;
};

const cleanImmichPersonId = (value) => {
  const personId = String(value || "").trim();
  if (
    !personId ||
    personId.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(personId)
  ) {
    throw typedError(
      "A stable Immich Person ID is required",
      400,
      "IMMICH_PERSON_ID_INVALID",
    );
  }
  return personId;
};

const cleanSourceId = (value) => {
  const sourceId = String(value || "").trim();
  if (!sourceId || sourceId.length > 120) {
    throw typedError(
      "The configured Immich source ID is invalid",
      500,
      "IMMICH_PERSON_SOURCE_INVALID",
    );
  }
  return sourceId;
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, requestDigest },
) => {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${commandId}, 60))`;
  const [existing] = await tx`
    SELECT actor_id, command_kind, request_digest, response_body, state
    FROM person_create_command
    WHERE command_id = ${commandId}
    FOR UPDATE
  `;
  if (existing) {
    if (
      existing.actor_id !== actorId ||
      existing.command_kind !== commandKind ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different Person creation",
        409,
        "PERSON_CREATE_COMMAND_CONFLICT",
      );
    }
    if (existing.state === "completed") {
      return { replay: { ...existing.response_body, replayed: true } };
    }
    throw typedError(
      "Person creation is already in progress",
      409,
      "PERSON_CREATE_COMMAND_CONFLICT",
    );
  }
  await tx`
    INSERT INTO person_create_command (
      command_id, actor_id, command_kind, request_digest, state
    ) VALUES (
      ${commandId}, ${actorId}, ${commandKind}, ${requestDigest}, 'started'
    )
  `;
  return { commandId };
};

const completeCommand = async (
  tx,
  { commandId, decisionId, personId, response },
) => {
  await tx`
    UPDATE person_create_command
    SET person_id = ${personId}, decision_id = ${decisionId},
      response_body = ${tx.json(response)}, state = 'completed',
      completed_at = now()
    WHERE command_id = ${commandId}
  `;
  return response;
};

const duplicatePeople = (tx, name) => tx`
  SELECT person.person_id, person.display_name
  FROM current_person person
  WHERE person.status = 'active' AND person.subject_kind = 'person'
    AND (
      lower(person.display_name) = lower(${name})
      OR EXISTS (
        SELECT 1 FROM unnest(person.aliases) alias
        WHERE lower(alias) = lower(${name})
      )
    )
  ORDER BY person.person_id
  LIMIT 2
`;

export const createPersonCreateStore = (
  sql,
  { companion = null, immichSourceId = "immich-primary" } = {},
) => ({
  async create({ actorId, commandId, immichPersonId, newPersonName }) {
    const actor = cleanActor(actorId);
    const stableCommandId = cleanCommandId(commandId);
    const selectors = ["immichPersonId", "newPersonName"].filter((key) =>
      key === "immichPersonId"
        ? immichPersonId !== undefined
        : newPersonName !== undefined,
    );
    if (selectors.length !== 1) {
      throw typedError(
        "Choose exactly one new Person name or one Immich Person ID",
        400,
        "PERSON_CREATE_SELECTOR_INVALID",
      );
    }
    const commandKind =
      selectors[0] === "immichPersonId" ? "reconcile_immich" : "create_native";
    const requested =
      commandKind === "reconcile_immich"
        ? { immichPersonId: cleanImmichPersonId(immichPersonId) }
        : { newPersonName: cleanName(newPersonName) };
    const requestDigest = digest({ commandKind, ...requested });

    const [early] = await sql`
      SELECT actor_id, command_kind, request_digest, response_body, state
      FROM person_create_command WHERE command_id = ${stableCommandId}
    `;
    if (early?.state === "completed") {
      if (
        early.actor_id !== actor ||
        early.command_kind !== commandKind ||
        early.request_digest !== requestDigest
      ) {
        throw typedError(
          "commandId was already used for a different Person creation",
          409,
          "PERSON_CREATE_COMMAND_CONFLICT",
        );
      }
      return { ...early.response_body, replayed: true };
    }

    let source = null;
    let name = requested.newPersonName || "";
    if (commandKind === "reconcile_immich") {
      if (!companion?.getPerson) {
        throw typedError(
          "Immich Person reconciliation is unavailable",
          503,
          "IMMICH_PERSON_RECONCILIATION_UNAVAILABLE",
        );
      }
      const projection = await companion.getPerson({
        personId: requested.immichPersonId,
      });
      if (projection?.person?.id !== requested.immichPersonId) {
        throw typedError(
          "Immich Person projection did not match the requested Person",
          502,
          "IMMICH_PERSON_PROJECTION_MISMATCH",
        );
      }
      if (!/^[0-9a-f]{64}$/.test(projection?.person?.sourceRevision || "")) {
        throw typedError(
          "Immich Person projection did not include a valid source revision",
          502,
          "IMMICH_PERSON_PROJECTION_INVALID",
        );
      }
      name = cleanName(projection.person.name);
      source = {
        immichPersonId: projection.person.id,
        sourceId: cleanSourceId(immichSourceId),
        sourceRevision: projection.person.sourceRevision,
      };
    }

    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId: stableCommandId,
        commandKind,
        requestDigest,
      });
      if (command.replay) return command.replay;

      if (source) {
        const [existingProjection] = await tx`
          SELECT projection.person_id, person.display_name
          FROM immich_person_projection projection
          JOIN person ON person.person_id = projection.person_id
          WHERE projection.source_id = ${source.sourceId}
            AND projection.immich_person_id = ${source.immichPersonId}
            AND projection.state = 'active'
          FOR UPDATE OF projection, person
        `;
        if (existingProjection) {
          const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO decision (
              decision_id, subject_type, subject_id, action, actor_kind,
              actor_id, reason_code, note, producer_receipt_id, privacy_class
            ) VALUES (
              ${decisionId}, 'identity_subject', ${existingProjection.person_id},
              'restore', 'user', ${actor}, 'immich_person_reconciled_no_change',
              'Reconcile existing Immich Person projection', ${receiptId}, 'private'
            )
          `;
          const response = {
            changed: false,
            commandId: stableCommandId,
            createdPerson: false,
            personId: existingProjection.person_id,
            personName: existingProjection.display_name,
            replayed: false,
            schemaVersion,
            source: {
              kind: "immich_person",
              sourcePersonId: source.immichPersonId,
            },
            status: "no_change",
            subjectKind: "person",
          };
          return completeCommand(tx, {
            commandId: stableCommandId,
            decisionId,
            personId: existingProjection.person_id,
            response,
          });
        }
      }

      await tx`LOCK TABLE person IN SHARE ROW EXCLUSIVE MODE`;
      await tx`LOCK TABLE person_alias IN SHARE ROW EXCLUSIVE MODE`;
      const duplicates = await duplicatePeople(tx, name);
      if (duplicates.length) {
        throw typedError(
          "A Cimmich Person already uses this display name or alias",
          409,
          "PERSON_NAME_CONFLICT",
          {
            existingPeople: duplicates.map((person) => ({
              personId: person.person_id,
              personName: person.display_name,
            })),
          },
        );
      }

      const [sortCategory] = await tx`
        SELECT category_id FROM person_category
        WHERE slug = 'sort' AND state = 'active'
        LIMIT 1 FOR SHARE
      `;
      if (!sortCategory) {
        throw typedError(
          "The required Sort workflow category is unavailable",
          503,
          "PERSON_SORT_CATEGORY_UNAVAILABLE",
        );
      }
      const personId = `person_${randomUUID().replaceAll("-", "")}`;
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO person (
          person_id, display_name, status, subject_kind,
          created_by_receipt_id, privacy_class
        ) VALUES (
          ${personId}, ${name}, 'active', 'person', ${receiptId}, 'private'
        )
      `;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind,
          actor_id, reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'identity_subject', ${personId}, 'create', 'user',
          ${actor}, ${source ? "immich_person_reconciled" : "person_manual_create"},
          ${source ? "Create Cimmich projection for Immich Person" : "Create Person"},
          ${receiptId}, 'private'
        )
      `;
      await tx`
        INSERT INTO person_category_membership_event (
          membership_event_id, person_id, category_id, action, actor_kind,
          actor_id, decision_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${`categoryevent_${randomUUID().replaceAll("-", "")}`}, ${personId},
          ${sortCategory.category_id}, 'add', 'user', ${actor}, ${decisionId},
          ${receiptId}, 'private'
        )
      `;
      if (source) {
        await tx`
          INSERT INTO immich_person_projection (
            source_id, immich_person_id, person_id, source_name,
            source_revision, state, producer_receipt_id
          ) VALUES (
            ${source.sourceId}, ${source.immichPersonId}, ${personId}, ${name},
            ${source.sourceRevision}, 'active', ${receiptId}
          )
        `;
      }
      const response = {
        changed: true,
        commandId: stableCommandId,
        createdPerson: true,
        decisionId,
        personId,
        personName: name,
        replayed: false,
        schemaVersion,
        source: source
          ? {
              kind: "immich_person",
              sourcePersonId: source.immichPersonId,
            }
          : { kind: "cimmich_native", sourcePersonId: null },
        status: "applied",
        subjectKind: "person",
      };
      return completeCommand(tx, {
        commandId: stableCommandId,
        decisionId,
        personId,
        response,
      });
    });
  },
});

export const personCreateContract = Object.freeze({ schemaVersion });
