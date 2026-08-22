import { randomUUID } from "node:crypto";

const relationshipCommandKind = "relationship_category_create";

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const cleanRelationshipName = (value) => {
  const name = String(value || "")
    .trim()
    .replaceAll(/\s+/g, " ");
  if (!name || name.length > 80) {
    throw typedError(
      "Relationship name must contain 1 to 80 characters",
      400,
      "PERSON_PROFILE_RELATIONSHIP_NAME_INVALID",
    );
  }
  return name;
};

const relationshipSlug = (name) => {
  const slug = name
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 64)
    .replaceAll(/-+$/g, "");
  return /^[a-z]/.test(slug)
    ? slug
    : `custom-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
};

export const cleanRelationshipIds = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw typedError(
      "relationshipCategoryIds must be an array of at most 20 IDs",
      400,
      "PERSON_PROFILE_RELATIONSHIPS_INVALID",
    );
  }
  const ids = value.map((item) => String(item || "").trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw typedError(
      "relationshipCategoryIds must contain unique non-blank IDs",
      400,
      "PERSON_PROFILE_RELATIONSHIPS_INVALID",
    );
  }
  return ids;
};

export const applyRelationships = async (
  tx,
  { actorId, personId, producerReceiptId },
  desiredIds,
) => {
  if (desiredIds === undefined) return;
  const available = desiredIds.length
    ? await tx`
        SELECT category_id
        FROM person_category
        WHERE category_id = ANY(${desiredIds})
          AND category_kind = 'relationship' AND state = 'active'
      `
    : [];
  const availableIds = new Set(available.map((row) => row.category_id));
  const invalid = desiredIds.filter((id) => !availableIds.has(id));
  if (invalid.length) {
    throw typedError(
      "One or more relationship categories are not active relationship truth",
      400,
      "PERSON_PROFILE_RELATIONSHIPS_INVALID",
      { invalidCategoryIds: invalid },
    );
  }
  const current = await tx`
    SELECT category_id
    FROM current_person_category
    WHERE person_id = ${personId} AND category_kind = 'relationship'
  `;
  const currentIds = new Set(current.map((row) => row.category_id));
  const desired = new Set(desiredIds);
  for (const categoryId of new Set([...currentIds, ...desired])) {
    const wasSelected = currentIds.has(categoryId);
    const selected = desired.has(categoryId);
    if (wasSelected === selected) continue;
    await tx`
      INSERT INTO person_category_membership_event (
        membership_event_id, person_id, category_id, action, actor_kind,
        actor_id, producer_receipt_id, privacy_class
      ) VALUES (
        ${`categoryevent_${randomUUID().replaceAll("-", "")}`}, ${personId},
        ${categoryId}, ${selected ? "add" : "remove"}, 'user', ${actorId},
        ${producerReceiptId}, 'private'
      )
    `;
  }
};

export const createRelationshipCategory = async (
  sql,
  {
    actorId,
    beginCommand,
    commandId,
    completeCommand,
    ensureUserCommandReceipt,
    loadProfile,
    name,
    personId,
    presentationRank,
    producerReceiptId,
    requireHumanPerson,
  },
) => {
  const relationshipName = cleanRelationshipName(name);
  const baseSlug = relationshipSlug(relationshipName);
  return sql.begin(async (tx) => {
    const command = await beginCommand(tx, {
      actorId,
      commandId,
      commandKind: relationshipCommandKind,
      payload: { name: relationshipName, personId },
    });
    if (command.replay) return command.replay;
    const person = await requireHumanPerson(tx, personId, {
      lock: true,
      presentationRank,
    });
    await ensureUserCommandReceipt(tx);
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`person-relationship:${baseSlug}`}, 0)
      )
    `;
    let [category] = await tx`
      SELECT category_id, name, slug, sort_order, state
      FROM person_category
      WHERE category_kind = 'relationship' AND lower(name) = lower(${relationshipName})
      ORDER BY state = 'active' DESC, created_at, category_id
      LIMIT 1
    `;
    if (category && category.state !== "active") {
      throw typedError(
        "A retired relationship already uses this name",
        409,
        "PERSON_PROFILE_RELATIONSHIP_RETIRED",
      );
    }
    if (!category) {
      const [slugCollision] = await tx`
        SELECT 1 FROM person_category WHERE slug = ${baseSlug}
      `;
      const slug = slugCollision
        ? `${baseSlug.slice(0, 50)}-${randomUUID().replaceAll("-", "").slice(0, 8)}`
        : baseSlug;
      const [{ next_sort_order: sortOrder }] = await tx`
        SELECT coalesce(max(sort_order), 0)::int + 10 AS next_sort_order
        FROM person_category WHERE category_kind = 'relationship'
      `;
      const categoryId = `category_custom_${randomUUID().replaceAll("-", "")}`;
      [category] = await tx`
        INSERT INTO person_category (
          category_id, slug, name, category_kind, sort_order, state,
          is_system_seed, producer_receipt_id, privacy_class
        ) VALUES (
          ${categoryId}, ${slug}, ${relationshipName}, 'relationship',
          ${sortOrder}, 'active', false, ${producerReceiptId}, 'private'
        )
        RETURNING category_id, name, slug, sort_order, state
      `;
    }
    const current = await tx`
      SELECT category_id FROM current_person_category
      WHERE person_id = ${person.person_id} AND category_kind = 'relationship'
    `;
    await applyRelationships(
      tx,
      {
        actorId,
        personId: person.person_id,
        producerReceiptId,
      },
      [
        ...new Set([
          ...current.map((row) => row.category_id),
          category.category_id,
        ]),
      ],
    );
    await tx`
      UPDATE person SET current_revision = current_revision + 1
      WHERE person_id = ${person.person_id}
    `;
    const profile = await loadProfile(tx, person.person_id, presentationRank);
    const response = {
      commandId: command.commandId,
      profile,
      replayed: false,
      schemaVersion: profile.schemaVersion,
      status: "applied",
    };
    return completeCommand(tx, {
      actorId,
      command,
      commandKind: relationshipCommandKind,
      personId: person.person_id,
      response,
    });
  });
};
