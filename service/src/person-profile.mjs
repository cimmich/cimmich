import { createHash, randomUUID } from "node:crypto";

const schemaVersion = "cimmich.person-profile.v1";
const localOwnerId = "local-primary";
const userCommandReceiptId = "receipt_cimmich_local_identity_commands_v1";
const genderKinds = new Set(["woman", "man", "non_binary", "self_described"]);
const itemKinds = new Set([
  "important_date",
  "work",
  "email",
  "phone",
  "web",
  "social",
  "address",
  "custom",
]);
const heroFieldKeys = [
  "about",
  "relationships",
  "pronouns",
  "gender_identity",
  "important_dates",
  "work",
  "aliases",
  "photo_history",
];
const heroFieldSet = new Set(heroFieldKeys);
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

const commandDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor of 1 to 120 characters is required",
      400,
      "PERSON_PROFILE_ACTOR_REQUIRED",
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
      "PERSON_PROFILE_COMMAND_ID_INVALID",
    );
  }
  return commandId;
};

const cleanNullableText = (value, maximum, fieldName) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > maximum) {
    throw typedError(
      `${fieldName} must be ${maximum} characters or fewer`,
      400,
      "PERSON_PROFILE_VALUE_INVALID",
      { field: fieldName, maximum },
    );
  }
  return text;
};

const cleanGenderKind = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const kind = String(value).trim();
  if (!genderKinds.has(kind)) {
    throw typedError(
      "genderIdentityKind is not supported",
      400,
      "PERSON_PROFILE_GENDER_INVALID",
    );
  }
  return kind;
};

const validateGenderPair = (kind, label) => {
  if (kind === "self_described" && !label) {
    throw typedError(
      "genderIdentityLabel is required for self_described",
      400,
      "PERSON_PROFILE_GENDER_INVALID",
    );
  }
  if (kind !== "self_described" && label) {
    throw typedError(
      "genderIdentityLabel is only valid for self_described",
      400,
      "PERSON_PROFILE_GENDER_INVALID",
    );
  }
  return {
    genderIdentityKind: kind ?? null,
    genderIdentityLabel: label ?? null,
  };
};

const cleanStableItemId = (value) => {
  const itemId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(itemId)) {
    throw typedError(
      "A stable itemId of 8 to 120 safe characters is required",
      400,
      "PERSON_PROFILE_ITEM_ID_INVALID",
    );
  }
  return itemId;
};

const cleanRequiredText = (value, maximum, fieldName) => {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) {
    throw typedError(
      `${fieldName} must contain 1 to ${maximum} characters`,
      400,
      "PERSON_PROFILE_ITEM_INVALID",
      { field: fieldName, maximum },
    );
  }
  return text;
};

const cleanDateValue = (value) => {
  const dateValue = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throw typedError(
      "dateValue must be an ISO calendar date",
      400,
      "PERSON_PROFILE_ITEM_INVALID",
    );
  }
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateValue
  ) {
    throw typedError(
      "dateValue must be a real ISO calendar date",
      400,
      "PERSON_PROFILE_ITEM_INVALID",
    );
  }
  return dateValue;
};

const cleanItem = (input, { itemId, itemKind } = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw typedError(
      "A typed Person Profile item is required",
      400,
      "PERSON_PROFILE_ITEM_INVALID",
    );
  }
  const nextItemId = cleanStableItemId(itemId ?? input.itemId);
  const nextKind = String(itemKind ?? input.kind ?? "").trim();
  if (!itemKinds.has(nextKind)) {
    throw typedError(
      "Person Profile item kind is not supported",
      400,
      "PERSON_PROFILE_ITEM_INVALID",
    );
  }
  const label = cleanRequiredText(input.label, 80, "label");
  if (nextKind === "important_date") {
    if (
      input.value !== undefined &&
      input.value !== null &&
      String(input.value).trim() !== ""
    ) {
      throw typedError(
        "important_date uses dateValue, not value",
        400,
        "PERSON_PROFILE_ITEM_INVALID",
      );
    }
    return {
      dateValue: cleanDateValue(input.dateValue),
      itemId: nextItemId,
      kind: nextKind,
      label,
      secondaryValue: null,
      value: null,
    };
  }
  const value = cleanRequiredText(
    input.value,
    nextKind === "work" ? 500 : 2000,
    "value",
  );
  const secondaryValue =
    nextKind === "work"
      ? (cleanNullableText(input.secondaryValue, 500, "secondaryValue") ?? null)
      : null;
  if (
    nextKind !== "work" &&
    input.secondaryValue !== undefined &&
    input.secondaryValue !== null &&
    String(input.secondaryValue).trim() !== ""
  ) {
    throw typedError(
      "secondaryValue is only valid for work items",
      400,
      "PERSON_PROFILE_ITEM_INVALID",
    );
  }
  return {
    dateValue: null,
    itemId: nextItemId,
    kind: nextKind,
    label,
    secondaryValue,
    value,
  };
};

const projectDateValue = (value) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value
      ? String(value).slice(0, 10)
      : null;

const projectItem = (row) => ({
  dateValue: projectDateValue(row.date_value),
  itemId: row.item_id,
  kind: row.item_kind,
  label: row.label,
  revision: Number(row.revision),
  secondaryValue: row.secondary_value_text || null,
  value: row.value_text || null,
});

const ensureUserCommandReceipt = async (tx) => {
  const now = new Date();
  await tx`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      started_at, completed_at, privacy_class
    ) VALUES (
      ${userCommandReceiptId}, 'user', 'cimmich-local-identity-commands', 'v1',
      ${now}, ${now}, 'private'
    ) ON CONFLICT (producer_receipt_id) DO UPDATE
      SET completed_at = excluded.completed_at
  `;
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, payload },
) => {
  const id = cleanCommandId(commandId);
  const digest = commandDigest({ commandKind, payload });
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  const [existing] = await tx`
    SELECT command_kind, actor_id, request_digest, response
    FROM person_profile_command
    WHERE command_id = ${id}
  `;
  if (existing) {
    if (
      existing.command_kind !== commandKind ||
      existing.actor_id !== actorId ||
      existing.request_digest !== digest
    ) {
      throw typedError(
        "commandId was already used for a different Person Profile command",
        409,
        "PERSON_PROFILE_COMMAND_CONFLICT",
      );
    }
    return {
      commandId: id,
      digest,
      replay: { ...existing.response, replayed: true },
    };
  }
  return { commandId: id, digest, replay: null };
};

const completeCommand = async (
  tx,
  { actorId, command, commandKind, personId = null, response },
) => {
  await tx`
    INSERT INTO person_profile_command (
      command_id, command_kind, actor_id, person_id, request_digest,
      response, privacy_class
    ) VALUES (
      ${command.commandId}, ${commandKind}, ${actorId}, ${personId},
      ${command.digest}, ${tx.json(response)}, 'sensitive-profile'
    )
  `;
  return response;
};

const requireHumanPerson = async (
  executor,
  personId,
  { lock = false, presentationRank = () => 0 } = {},
) => {
  const id = String(personId || "").trim();
  const rows = lock
    ? await executor`
        SELECT person_id, display_name, status, subject_kind, current_revision
        FROM person
        WHERE person_id = ${id} AND status IN ('active','hidden')
          AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
        FOR UPDATE
      `
    : await executor`
        SELECT person_id, display_name, status, subject_kind, current_revision
        FROM person
        WHERE person_id = ${id} AND status IN ('active','hidden')
          AND cimmich_visibility_person_rank(person_id) <= ${presentationRank()}
      `;
  const person = rows[0];
  if (!person || person.subject_kind !== "person") {
    throw typedError(
      "Person Profile human subject not found",
      404,
      "PERSON_PROFILE_NOT_FOUND",
    );
  }
  return person;
};

const loadProfile = async (executor, personId, presentationRank) => {
  const person = await requireHumanPerson(executor, personId, {
    presentationRank,
  });
  const [profile] = await executor`
    SELECT about, gender_identity_kind, gender_identity_label,
      pronouns_label, private_notes, revision
    FROM person_profile
    WHERE person_id = ${person.person_id}
  `;
  const items = await executor`
    SELECT item_id, item_kind, label, value_text, secondary_value_text,
      date_value, revision
    FROM person_profile_item
    WHERE person_id = ${person.person_id} AND state = 'active'
    ORDER BY item_kind, created_at, item_id
  `;
  const relationships = await executor`
    SELECT category_id, slug, name, sort_order
    FROM current_person_category
    WHERE person_id = ${person.person_id} AND category_kind = 'relationship'
    ORDER BY sort_order, name, category_id
  `;
  const relationshipCatalog = await executor`
    SELECT category_id, slug, name, sort_order
    FROM person_category
    WHERE state = 'active' AND category_kind = 'relationship'
    ORDER BY sort_order, name, category_id
  `;
  return {
    items: items.map(projectItem),
    person: {
      displayName: person.display_name || "",
      personId: person.person_id,
      status: person.status,
    },
    profile: {
      about: profile?.about || null,
      genderIdentityKind: profile?.gender_identity_kind || null,
      genderIdentityLabel: profile?.gender_identity_label || null,
      privateNotes: profile?.private_notes || null,
      pronounsLabel: profile?.pronouns_label || null,
      revision: Number(profile?.revision || 0),
    },
    relationshipCatalog: relationshipCatalog.map((category) => ({
      categoryId: category.category_id,
      name: category.name,
      slug: category.slug,
      sortOrder: Number(category.sort_order),
    })),
    relationships: relationships.map((category) => ({
      categoryId: category.category_id,
      name: category.name,
      slug: category.slug,
      sortOrder: Number(category.sort_order),
    })),
    schemaVersion,
  };
};

const loadDisplayDefaults = async (executor) => {
  const rows = await executor`
    SELECT field_key, display_order, is_visible
    FROM person_profile_display_default
    WHERE owner_id = ${localOwnerId}
    ORDER BY display_order, field_key
  `;
  return {
    fields: rows.map((row) => ({
      fieldKey: row.field_key,
      order: Number(row.display_order),
      visible: row.is_visible,
    })),
    owner: { ownerId: localOwnerId, ownerKind: "local_library" },
    schemaVersion,
  };
};

const loadPersonDisplay = async (executor, personId, presentationRank) => {
  const person = await requireHumanPerson(executor, personId, {
    presentationRank,
  });
  const defaults = await loadDisplayDefaults(executor);
  const overrideRows = await executor`
    SELECT field_key, visibility
    FROM person_profile_display_override
    WHERE owner_id = ${localOwnerId} AND person_id = ${person.person_id}
  `;
  const overrides = new Map(
    overrideRows.map((row) => [row.field_key, row.visibility]),
  );
  return {
    fields: defaults.fields.map((field) => {
      const visibility = overrides.get(field.fieldKey) || "inherit";
      return {
        defaultVisible: field.visible,
        effectiveVisible:
          visibility === "inherit" ? field.visible : visibility === "show",
        fieldKey: field.fieldKey,
        order: field.order,
        visibility,
      };
    }),
    owner: defaults.owner,
    personId: person.person_id,
    schemaVersion,
  };
};

const cleanRelationshipIds = (value) => {
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

const cleanItemCommands = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw typedError(
      "itemCommands must be an array of at most 100 commands",
      400,
      "PERSON_PROFILE_ITEMS_INVALID",
    );
  }
  const commands = value.map((entry) => {
    const action = String(entry?.action || "").trim();
    if (action === "add") {
      return { action, item: cleanItem(entry.item) };
    }
    const itemId = cleanStableItemId(entry?.itemId);
    if (action === "remove") return { action, itemId };
    if (action === "update") {
      if (
        !entry.patch ||
        typeof entry.patch !== "object" ||
        Array.isArray(entry.patch)
      ) {
        throw typedError(
          "An item update patch is required",
          400,
          "PERSON_PROFILE_ITEM_INVALID",
        );
      }
      const allowedKeys = new Set([
        "dateValue",
        "label",
        "secondaryValue",
        "value",
      ]);
      const patchKeys = Object.keys(entry.patch);
      if (
        patchKeys.length < 1 ||
        patchKeys.some((key) => !allowedKeys.has(key))
      ) {
        throw typedError(
          "Item update patch contains no supported fields",
          400,
          "PERSON_PROFILE_ITEM_INVALID",
        );
      }
      return { action, itemId, patch: { ...entry.patch } };
    }
    throw typedError(
      "Person Profile item action must be add, update, or remove",
      400,
      "PERSON_PROFILE_ITEM_INVALID",
    );
  });
  const targets = commands.map((command) =>
    command.action === "add" ? command.item.itemId : command.itemId,
  );
  if (new Set(targets).size !== targets.length) {
    throw typedError(
      "Each itemId can be targeted only once per command",
      400,
      "PERSON_PROFILE_ITEMS_INVALID",
    );
  }
  return commands;
};

const applyItemCommands = async (tx, personId, commands = []) => {
  for (const command of commands) {
    if (command.action === "add") {
      const [existing] = await tx`
        SELECT item_id, state FROM person_profile_item
        WHERE item_id = ${command.item.itemId}
      `;
      if (existing) {
        throw typedError(
          "itemId already exists and cannot be retargeted",
          409,
          "PERSON_PROFILE_ITEM_CONFLICT",
        );
      }
      const [{ active_count, custom_count }] = await tx`
        SELECT count(*)::int AS active_count,
          count(*) FILTER (WHERE item_kind = 'custom')::int AS custom_count
        FROM person_profile_item
        WHERE person_id = ${personId} AND state = 'active'
      `;
      if (Number(active_count) >= 200) {
        throw typedError(
          "Person Profile supports at most 200 active items",
          409,
          "PERSON_PROFILE_ITEM_LIMIT",
        );
      }
      if (command.item.kind === "custom" && Number(custom_count) >= 20) {
        throw typedError(
          "Person Profile supports at most 20 active custom fields",
          409,
          "PERSON_PROFILE_CUSTOM_FIELD_LIMIT",
        );
      }
      await tx`
        INSERT INTO person_profile_item (
          item_id, person_id, item_kind, label, value_text,
          secondary_value_text, date_value
        ) VALUES (
          ${command.item.itemId}, ${personId}, ${command.item.kind},
          ${command.item.label}, ${command.item.value},
          ${command.item.secondaryValue}, ${command.item.dateValue}
        )
      `;
      continue;
    }
    const [existing] = await tx`
      SELECT item_id, item_kind, label, value_text, secondary_value_text,
        date_value, state
      FROM person_profile_item
      WHERE item_id = ${command.itemId} AND person_id = ${personId}
      FOR UPDATE
    `;
    if (!existing || existing.state !== "active") {
      throw typedError(
        "Active Person Profile item not found",
        404,
        "PERSON_PROFILE_ITEM_NOT_FOUND",
      );
    }
    if (command.action === "remove") {
      await tx`
        UPDATE person_profile_item SET
          state = 'removed', removed_at = now(), updated_at = now(),
          revision = revision + 1
        WHERE item_id = ${existing.item_id}
      `;
      continue;
    }
    const current = {
      dateValue: projectDateValue(existing.date_value),
      itemId: existing.item_id,
      kind: existing.item_kind,
      label: existing.label,
      secondaryValue: existing.secondary_value_text || null,
      value: existing.value_text || null,
    };
    const item = cleanItem(
      { ...current, ...command.patch },
      { itemId: current.itemId, itemKind: current.kind },
    );
    await tx`
      UPDATE person_profile_item SET
        label = ${item.label}, value_text = ${item.value},
        secondary_value_text = ${item.secondaryValue},
        date_value = ${item.dateValue}, updated_at = now(),
        revision = revision + 1
      WHERE item_id = ${item.itemId}
    `;
  }
};

const applyRelationships = async (tx, personId, actorId, desiredIds) => {
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
        ${userCommandReceiptId}, 'private'
      )
    `;
  }
};

const cleanDisplayDefaults = (value) => {
  if (!Array.isArray(value) || value.length !== heroFieldKeys.length) {
    throw typedError(
      "fields must contain every Person hero field exactly once",
      400,
      "PERSON_PROFILE_DISPLAY_INVALID",
    );
  }
  const fields = value.map((field) => ({
    fieldKey: String(field?.fieldKey || "").trim(),
    order: Number(field?.order),
    visible: field?.visible,
  }));
  if (
    fields.some(
      (field) =>
        !heroFieldSet.has(field.fieldKey) ||
        !Number.isInteger(field.order) ||
        field.order < 0 ||
        field.order >= heroFieldKeys.length ||
        typeof field.visible !== "boolean",
    ) ||
    new Set(fields.map((field) => field.fieldKey)).size !==
      heroFieldKeys.length ||
    new Set(fields.map((field) => field.order)).size !== heroFieldKeys.length
  ) {
    throw typedError(
      "Hero fields, order and visibility are invalid",
      400,
      "PERSON_PROFILE_DISPLAY_INVALID",
    );
  }
  return fields.sort((left, right) => left.order - right.order);
};

const cleanDisplayOverrides = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw typedError(
      "overrides must contain 1 to 8 Person hero fields",
      400,
      "PERSON_PROFILE_DISPLAY_INVALID",
    );
  }
  const overrides = value.map((entry) => ({
    fieldKey: String(entry?.fieldKey || "").trim(),
    visibility: String(entry?.visibility || "").trim(),
  }));
  if (
    overrides.some(
      (entry) =>
        !heroFieldSet.has(entry.fieldKey) ||
        !visibilityKinds.has(entry.visibility),
    ) ||
    new Set(overrides.map((entry) => entry.fieldKey)).size !== overrides.length
  ) {
    throw typedError(
      "Person hero overrides are invalid",
      400,
      "PERSON_PROFILE_DISPLAY_INVALID",
    );
  }
  return overrides;
};

export const createPersonProfileStore = (
  sql,
  { presentationRank = () => 0 } = {},
) => ({
  getPersonProfile: ({ personId }) =>
    loadProfile(sql, personId, presentationRank),

  async patchPersonProfile({
    about,
    actorId,
    commandId,
    genderIdentityKind,
    genderIdentityLabel,
    itemCommands,
    personId,
    privateNotes,
    pronounsLabel,
    relationshipCategoryIds,
  }) {
    const actor = cleanActor(actorId);
    const requested = {
      ...(about !== undefined
        ? { about: cleanNullableText(about, 4000, "about") }
        : {}),
      ...(genderIdentityKind !== undefined
        ? { genderIdentityKind: cleanGenderKind(genderIdentityKind) }
        : {}),
      ...(genderIdentityLabel !== undefined
        ? {
            genderIdentityLabel: cleanNullableText(
              genderIdentityLabel,
              120,
              "genderIdentityLabel",
            ),
          }
        : {}),
      ...(privateNotes !== undefined
        ? {
            privateNotes: cleanNullableText(
              privateNotes,
              10000,
              "privateNotes",
            ),
          }
        : {}),
      ...(pronounsLabel !== undefined
        ? {
            pronounsLabel: cleanNullableText(
              pronounsLabel,
              80,
              "pronounsLabel",
            ),
          }
        : {}),
      ...(relationshipCategoryIds !== undefined
        ? {
            relationshipCategoryIds: cleanRelationshipIds(
              relationshipCategoryIds,
            ),
          }
        : {}),
      ...(itemCommands !== undefined
        ? { itemCommands: cleanItemCommands(itemCommands) }
        : {}),
    };
    if (!Object.keys(requested).length) {
      throw typedError(
        "No Person Profile fields or item commands were supplied",
        400,
        "PERSON_PROFILE_UPDATE_EMPTY",
      );
    }
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "profile_patch",
        payload: { personId, ...requested },
      });
      if (command.replay) return command.replay;
      const person = await requireHumanPerson(tx, personId, {
        lock: true,
        presentationRank,
      });
      const [current] = await tx`
        SELECT about, gender_identity_kind, gender_identity_label,
          pronouns_label, private_notes
        FROM person_profile
        WHERE person_id = ${person.person_id}
        FOR UPDATE
      `;
      let nextGenderKind = Object.hasOwn(requested, "genderIdentityKind")
        ? requested.genderIdentityKind
        : current?.gender_identity_kind || null;
      let nextGenderLabel = Object.hasOwn(requested, "genderIdentityLabel")
        ? requested.genderIdentityLabel
        : current?.gender_identity_label || null;
      if (
        Object.hasOwn(requested, "genderIdentityKind") &&
        nextGenderKind !== "self_described" &&
        !Object.hasOwn(requested, "genderIdentityLabel")
      ) {
        nextGenderLabel = null;
      }
      ({
        genderIdentityKind: nextGenderKind,
        genderIdentityLabel: nextGenderLabel,
      } = validateGenderPair(nextGenderKind, nextGenderLabel));
      const nextAbout = Object.hasOwn(requested, "about")
        ? requested.about
        : current?.about || null;
      const nextPronouns = Object.hasOwn(requested, "pronounsLabel")
        ? requested.pronounsLabel
        : current?.pronouns_label || null;
      const nextPrivateNotes = Object.hasOwn(requested, "privateNotes")
        ? requested.privateNotes
        : current?.private_notes || null;
      await ensureUserCommandReceipt(tx);
      await tx`
        INSERT INTO person_profile (
          person_id, about, gender_identity_kind, gender_identity_label,
          pronouns_label, private_notes
        ) VALUES (
          ${person.person_id},
          ${nextAbout},
          ${nextGenderKind}, ${nextGenderLabel},
          ${nextPronouns}, ${nextPrivateNotes}
        )
        ON CONFLICT (person_id) DO UPDATE SET
          about = excluded.about,
          gender_identity_kind = excluded.gender_identity_kind,
          gender_identity_label = excluded.gender_identity_label,
          pronouns_label = excluded.pronouns_label,
          private_notes = excluded.private_notes,
          revision = person_profile.revision + 1,
          updated_at = now()
      `;
      await applyRelationships(
        tx,
        person.person_id,
        actor,
        requested.relationshipCategoryIds,
      );
      await applyItemCommands(tx, person.person_id, requested.itemCommands);
      await tx`
        UPDATE person SET current_revision = current_revision + 1
        WHERE person_id = ${person.person_id}
      `;
      const profile = await loadProfile(tx, person.person_id, presentationRank);
      const response = {
        commandId: command.commandId,
        profile,
        replayed: false,
        schemaVersion,
        status: "applied",
      };
      return completeCommand(tx, {
        actorId: actor,
        command,
        commandKind: "profile_patch",
        personId: person.person_id,
        response,
      });
    });
  },

  getPersonProfileDisplayDefaults: () => loadDisplayDefaults(sql),

  async patchPersonProfileDisplayDefaults({ actorId, commandId, fields }) {
    const actor = cleanActor(actorId);
    const cleanFields = cleanDisplayDefaults(fields);
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "display_defaults_patch",
        payload: { fields: cleanFields },
      });
      if (command.replay) return command.replay;
      await tx`
        SELECT owner_id FROM person_profile_display_owner
        WHERE owner_id = ${localOwnerId}
        FOR UPDATE
      `;
      await tx`
        DELETE FROM person_profile_display_default
        WHERE owner_id = ${localOwnerId}
      `;
      for (const field of cleanFields) {
        await tx`
          INSERT INTO person_profile_display_default (
            owner_id, field_key, display_order, is_visible, updated_at
          ) VALUES (
            ${localOwnerId}, ${field.fieldKey}, ${field.order},
            ${field.visible}, now()
          )
        `;
      }
      const defaults = await loadDisplayDefaults(tx);
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
        commandKind: "display_defaults_patch",
        response,
      });
    });
  },

  getPersonProfileDisplay: ({ personId }) =>
    loadPersonDisplay(sql, personId, presentationRank),

  async patchPersonProfileDisplay({ actorId, commandId, overrides, personId }) {
    const actor = cleanActor(actorId);
    const cleanOverrides = cleanDisplayOverrides(overrides);
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId,
        commandKind: "person_display_patch",
        payload: { overrides: cleanOverrides, personId },
      });
      if (command.replay) return command.replay;
      const person = await requireHumanPerson(tx, personId, {
        lock: true,
        presentationRank,
      });
      for (const override of cleanOverrides) {
        await tx`
          INSERT INTO person_profile_display_override (
            owner_id, person_id, field_key, visibility, updated_at
          ) VALUES (
            ${localOwnerId}, ${person.person_id}, ${override.fieldKey},
            ${override.visibility}, now()
          )
          ON CONFLICT (owner_id, person_id, field_key) DO UPDATE SET
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
        commandKind: "person_display_patch",
        personId: person.person_id,
        response,
      });
    });
  },
});

export const personProfileContract = Object.freeze({
  genderIdentityKinds: [...genderKinds],
  heroFieldKeys: [...heroFieldKeys],
  itemKinds: [...itemKinds],
  schemaVersion,
  visibilityKinds: [...visibilityKinds],
});
