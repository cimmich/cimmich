import { randomUUID } from "node:crypto";

const error = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

export const createPersonNameStore = ({
  cleanActor,
  cleanAliasKind,
  cleanPersonName,
  ensureUserCommandReceipt,
  requireVisibleSubject,
  sql,
  userCommandReceiptId,
}) => {
  const personSetup = async ({ personId }) => {
    await requireVisibleSubject(personId);
    const [person] = await sql`
      SELECT person_id, display_name, status, aliases, subject_kind,
        current_revision
      FROM current_person
      WHERE person_id = ${String(personId || "")}
      LIMIT 1
    `;
    if (!person) throw error("Cimmich identity not found", 404);
    const aliases = await sql`
      SELECT alias_id, label, alias_kind, source_system, source_subject_id,
        created_at
      FROM person_alias
      WHERE person_id = ${person.person_id} AND state = 'active'
      ORDER BY created_at, alias_id
    `;
    const merges = await sql`
      SELECT operation.merge_operation_id, operation.source_person_id,
        source.display_name AS source_display_name, operation.created_at
      FROM person_merge_operation operation
      JOIN person source ON source.person_id = operation.source_person_id
      WHERE operation.target_person_id = ${person.person_id}
        AND operation.state = 'active'
      ORDER BY operation.created_at DESC, operation.merge_operation_id DESC
    `;
    const categories = await sql`
      SELECT category_id, slug, name, category_kind, sort_order
      FROM current_person_category
      WHERE person_id = ${person.person_id}
      ORDER BY sort_order, name
    `;
    const categoryCatalog = await sql`
      SELECT category_id, slug, name, category_kind, sort_order
      FROM person_category
      WHERE state = 'active'
      ORDER BY sort_order, name
    `;
    return {
      ...person,
      alias_items: aliases,
      categories,
      category_catalog: categoryCatalog,
      merges,
    };
  };

  const addPersonAlias = async ({
    actorId,
    aliasKind,
    label,
    personId,
    sourceSubjectId = "",
    sourceSystem = "",
  }) => {
    const actor = cleanActor(actorId);
    if (!actor) throw error("Missing Cimmich actor", 400, "ACTOR_REQUIRED");
    const cleanLabel = cleanPersonName(label);
    const kind = cleanAliasKind(aliasKind);
    return sql.begin(async (tx) => {
      const [person] = await tx`
        SELECT person_id, display_name FROM person
        WHERE person_id = ${String(personId || "")} AND status = 'active'
        FOR UPDATE
      `;
      if (!person) throw error("Active Cimmich identity not found", 404);
      const [existing] = await tx`
        SELECT alias_id, label, alias_kind
        FROM person_alias
        WHERE person_id = ${person.person_id} AND state = 'active'
          AND lower(label) = lower(${cleanLabel})
        LIMIT 1
      `;
      if (
        existing ||
        String(person.display_name || "").toLowerCase() ===
          cleanLabel.toLowerCase()
      ) {
        return {
          alias: existing || null,
          changed: false,
          personId: person.person_id,
        };
      }
      await ensureUserCommandReceipt(tx);
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      const aliasId = `alias_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'person_alias', ${aliasId}, 'rename', 'user', ${actor},
          'identity_setup_alias_add', ${`Add ${kind} alias ${cleanLabel}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
      const [alias] = await tx`
        INSERT INTO person_alias (
          alias_id, person_id, label, alias_kind, state, source_system,
          source_subject_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${aliasId}, ${person.person_id}, ${cleanLabel}, ${kind}, 'active',
          ${String(sourceSystem || "").trim() || null},
          ${String(sourceSubjectId || "").trim() || null},
          ${userCommandReceiptId}, 'private'
        )
        RETURNING alias_id, label, alias_kind, source_system,
          source_subject_id, created_at
      `;
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${person.person_id}
      `;
      return { alias, changed: true, decisionId, personId: person.person_id };
    });
  };

  const removePersonAlias = async ({ actorId, aliasId, personId }) => {
    const actor = cleanActor(actorId);
    if (!actor) throw error("Missing Cimmich actor", 400, "ACTOR_REQUIRED");
    return sql.begin(async (tx) => {
      const [alias] = await tx`
        SELECT alias_id, label FROM person_alias
        WHERE alias_id = ${String(aliasId || "")}
          AND person_id = ${String(personId || "")} AND state = 'active'
        FOR UPDATE
      `;
      if (!alias) return { aliasId, changed: false, personId };
      const [person] = await tx`
        SELECT person_id FROM person
        WHERE person_id = ${personId} AND status = 'active'
        FOR UPDATE
      `;
      if (!person) throw error("Active Cimmich identity not found", 404);
      await ensureUserCommandReceipt(tx);
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'person_alias', ${alias.alias_id}, 'rename', 'user',
          ${actor}, 'identity_setup_alias_remove',
          ${`Remove alias ${alias.label}`}, ${userCommandReceiptId}, 'private'
        )
      `;
      await tx`
        UPDATE person_alias SET state = 'removed'
        WHERE alias_id = ${alias.alias_id}
      `;
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${person.person_id}
      `;
      return {
        aliasId: alias.alias_id,
        changed: true,
        decisionId,
        personId: person.person_id,
      };
    });
  };

  const setPersonDisplayName = async ({ actorId, displayName, personId }) => {
    await requireVisibleSubject(personId);
    const actor = cleanActor(actorId);
    if (!actor) throw error("Missing Cimmich actor", 400, "ACTOR_REQUIRED");
    const nextName = cleanPersonName(displayName);
    return sql.begin(async (tx) => {
      await tx`LOCK TABLE person IN SHARE ROW EXCLUSIVE MODE`;
      await tx`LOCK TABLE person_alias IN SHARE ROW EXCLUSIVE MODE`;
      const [person] = await tx`
        SELECT person_id, display_name FROM person
        WHERE person_id = ${String(personId || "")} AND status = 'active'
          AND subject_kind = 'person'
        FOR UPDATE
      `;
      if (!person) throw error("Active Cimmich Person not found", 404);
      const previousName = String(person.display_name || "");
      if (previousName.toLocaleLowerCase() === nextName.toLocaleLowerCase()) {
        return {
          changed: false,
          displayName: previousName,
          personId: person.person_id,
          previousDisplayName: previousName,
        };
      }
      const conflicts = await tx`
        SELECT candidate.person_id, candidate.display_name
        FROM current_person candidate
        WHERE candidate.status = 'active'
          AND candidate.subject_kind = 'person'
          AND candidate.person_id <> ${person.person_id}
          AND (
            lower(candidate.display_name) = lower(${nextName})
            OR EXISTS (
              SELECT 1 FROM unnest(candidate.aliases) alias
              WHERE lower(alias) = lower(${nextName})
            )
          )
        ORDER BY candidate.person_id
        LIMIT 2
      `;
      if (conflicts.length > 0) {
        throw error(
          "A Cimmich Person already uses this display name or alias",
          409,
          "PERSON_NAME_CONFLICT",
          {
            existingPeople: conflicts.map((candidate) => ({
              personId: candidate.person_id,
              personName: candidate.display_name,
            })),
          },
        );
      }
      await ensureUserCommandReceipt(tx);
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        UPDATE person_alias SET state = 'superseded'
        WHERE person_id = ${person.person_id} AND state = 'active'
          AND lower(label) = lower(${nextName})
      `;
      let formerAliasId = "";
      if (previousName.trim()) {
        const [formerAlias] = await tx`
          SELECT alias_id FROM person_alias
          WHERE person_id = ${person.person_id} AND state = 'active'
            AND lower(label) = lower(${previousName})
          LIMIT 1
        `;
        formerAliasId = formerAlias?.alias_id || "";
        if (formerAliasId) {
          await tx`
            UPDATE person_alias SET alias_kind = 'former_name'
            WHERE alias_id = ${formerAliasId}
          `;
        } else {
          formerAliasId = `alias_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO person_alias (
              alias_id, person_id, label, alias_kind, state,
              producer_receipt_id, privacy_class
            ) VALUES (
              ${formerAliasId}, ${person.person_id}, ${previousName},
              'former_name', 'active', ${userCommandReceiptId}, 'private'
            )
          `;
        }
      }
      await tx`
        UPDATE person SET display_name = ${nextName},
          current_revision = current_revision + 1
        WHERE person_id = ${person.person_id}
      `;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'identity_subject', ${person.person_id}, 'rename',
          'user', ${actor}, 'identity_setup_display_name_update',
          ${`Change display name from ${previousName} to ${nextName}`},
          ${userCommandReceiptId}, 'private'
        )
      `;
      return {
        changed: true,
        decisionId,
        displayName: nextName,
        formerNameAliasId: formerAliasId,
        personId: person.person_id,
        previousDisplayName: previousName,
      };
    });
  };

  return {
    addPersonAlias,
    personSetup,
    removePersonAlias,
    setPersonDisplayName,
  };
};
