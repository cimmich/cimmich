import assert from "node:assert/strict";
import { currentSchemaVersion } from "./current-schema.mjs";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_PERSON_PROFILE_PHASE || "all";
const personId = "person_profile_acceptance_fixture";
const privateSentinel = "private-profile-sentinel-7c4e9a";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-profile-editor",
};

const request = async (path, { body, method = "GET", status = 200 } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers }),
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
};

const assertNoPrivateSentinel = (label, payload) => {
  assert.equal(
    JSON.stringify(payload).includes(privateSentinel),
    false,
    `${label} leaked private Person Profile data`,
  );
};

const assertPersistedState = async () => {
  const health = await request("/health");
  assert.equal(health.schemaVersion, await currentSchemaVersion());

  const profile = await request(`/v1/people/${personId}/profile`);
  assert.equal(profile.schemaVersion, "cimmich.person-profile.v1");
  assert.equal(profile.profile.about, `${privateSentinel} About`);
  assert.equal(profile.profile.genderIdentityKind, "self_described");
  assert.equal(profile.profile.genderIdentityLabel, "Synthetic identity");
  assert.equal(profile.profile.pronounsLabel, "they/them");
  assert.equal(
    profile.profile.privateNotes,
    `${privateSentinel} private notes`,
  );
  assert.deepEqual(
    profile.relationships.map((category) => category.categoryId).sort(),
    ["category_acquaintances", "category_family"],
  );
  const items = new Map(profile.items.map((item) => [item.itemId, item]));
  assert.equal(items.get("profile_item_email_0001").value, "new@example.test");
  assert.equal(items.has("profile_item_social_0001"), false);
  assert.equal(items.get("profile_item_address_0001").kind, "address");
  assert.equal(items.get("profile_item_date_000001").dateValue, "2000-02-29");
  assert.equal(
    items.get("profile_item_work_000001").secondaryValue,
    "Example Org",
  );
  assert.equal(items.get("profile_item_custom_0001").value, "Synthetic value");

  const defaults = await request("/v1/people/profile-display-defaults");
  assert.equal(defaults.schemaVersion, "cimmich.person-profile.v1");
  assert.equal(defaults.owner.ownerId, "local-primary");
  assert.equal(defaults.fields.length, 8);
  assert.equal(defaults.fields.at(-1).fieldKey, "about");
  assert.equal(defaults.fields.at(-1).visible, false);

  const display = await request(`/v1/people/${personId}/profile-display`);
  const aboutDisplay = display.fields.find(
    (field) => field.fieldKey === "about",
  );
  assert.equal(aboutDisplay.visibility, "inherit");
  assert.equal(aboutDisplay.defaultVisible, false);
  assert.equal(aboutDisplay.effectiveVisible, false);
  assert.equal(profile.profile.about, `${privateSentinel} About`);

  for (const [label, path] of [
    ["People collection", "/v1/people?limit=500"],
    ["People search", `/v1/people?q=${encodeURIComponent(privateSentinel)}`],
    ["Person projection", `/v1/people/${personId}`],
    ["Person setup", `/v1/people/${personId}/setup`],
    ["Person media", `/v1/people/${personId}/assets?limit=5`],
    ["review queue", "/v1/review/identity-claims?limit=5"],
    ["summary", "/v1/summary"],
  ]) {
    assertNoPrivateSentinel(label, await request(path));
  }
};

if (phase === "write" || phase === "all") {
  const initial = await request(`/v1/people/${personId}/profile`);
  assert.equal(initial.profile.revision, 0);
  assert.equal(initial.profile.about, null);
  const family = initial.relationshipCatalog.find(
    (category) => category.categoryId === "category_family",
  );
  const friends = initial.relationshipCatalog.find(
    (category) => category.categoryId === "category_friends",
  );
  const acquaintances = initial.relationshipCatalog.find(
    (category) => category.categoryId === "category_acquaintances",
  );
  assert.ok(family && friends && acquaintances);

  const createBody = {
    about: `${privateSentinel} About`,
    commandId: "person-profile-create-0001",
    genderIdentityKind: "self_described",
    genderIdentityLabel: "Synthetic identity",
    itemCommands: [
      {
        action: "add",
        item: {
          itemId: "profile_item_email_0001",
          kind: "email",
          label: "Personal",
          value: "old@example.test",
        },
      },
      {
        action: "add",
        item: {
          itemId: "profile_item_social_0001",
          kind: "social",
          label: "Example social",
          value: "https://social.example.test/example",
        },
      },
      {
        action: "add",
        item: {
          itemId: "profile_item_address_0001",
          kind: "address",
          label: "Home",
          value: `${privateSentinel} Example address`,
        },
      },
      {
        action: "add",
        item: {
          dateValue: "2000-02-29",
          itemId: "profile_item_date_000001",
          kind: "important_date",
          label: "Birthday",
        },
      },
      {
        action: "add",
        item: {
          itemId: "profile_item_work_000001",
          kind: "work",
          label: "Current role",
          secondaryValue: "Example Org",
          value: "Synthetic Engineer",
        },
      },
      {
        action: "add",
        item: {
          itemId: "profile_item_custom_0001",
          kind: "custom",
          label: "Favourite fixture",
          value: "Synthetic value",
        },
      },
    ],
    privateNotes: `${privateSentinel} private notes`,
    pronounsLabel: "they/them",
    relationshipCategoryIds: [family.categoryId, friends.categoryId],
  };
  const created = await request(`/v1/people/${personId}/profile`, {
    body: createBody,
    method: "PATCH",
  });
  assert.equal(created.status, "applied");
  assert.equal(created.replayed, false);
  assert.equal(created.profile.profile.about, `${privateSentinel} About`);
  assert.equal(created.profile.items.length, 6);

  const replay = await request(`/v1/people/${personId}/profile`, {
    body: createBody,
    method: "PATCH",
  });
  assert.equal(replay.replayed, true);
  assert.equal(
    replay.profile.profile.revision,
    created.profile.profile.revision,
  );

  const conflict = await request(`/v1/people/${personId}/profile`, {
    body: { ...createBody, about: "Conflicting replay" },
    method: "PATCH",
    status: 409,
  });
  assert.equal(conflict.code, "PERSON_PROFILE_COMMAND_CONFLICT");

  const invalidGender = await request(`/v1/people/${personId}/profile`, {
    body: {
      commandId: "person-profile-invalid-gender",
      genderIdentityKind: "woman",
      genderIdentityLabel: "Not allowed",
    },
    method: "PATCH",
    status: 400,
  });
  assert.equal(invalidGender.code, "PERSON_PROFILE_GENDER_INVALID");

  const cleared = await request(`/v1/people/${personId}/profile`, {
    body: {
      commandId: "person-profile-clear-pronouns",
      pronounsLabel: null,
    },
    method: "PATCH",
  });
  assert.equal(cleared.profile.profile.pronounsLabel, null);

  const edited = await request(`/v1/people/${personId}/profile`, {
    body: {
      commandId: "person-profile-edit-items-01",
      itemCommands: [
        {
          action: "update",
          itemId: "profile_item_email_0001",
          patch: { value: "new@example.test" },
        },
        { action: "remove", itemId: "profile_item_social_0001" },
      ],
      pronounsLabel: "they/them",
      relationshipCategoryIds: [family.categoryId, acquaintances.categoryId],
    },
    method: "PATCH",
  });
  assert.equal(edited.profile.items.length, 5);
  assert.equal(
    edited.profile.items.find(
      (item) => item.itemId === "profile_item_email_0001",
    ).value,
    "new@example.test",
  );
  assert.equal(
    edited.profile.items.some(
      (item) => item.itemId === "profile_item_social_0001",
    ),
    false,
  );

  const removedAgain = await request(`/v1/people/${personId}/profile`, {
    body: {
      commandId: "person-profile-remove-missing",
      itemCommands: [{ action: "remove", itemId: "profile_item_social_0001" }],
    },
    method: "PATCH",
    status: 404,
  });
  assert.equal(removedAgain.code, "PERSON_PROFILE_ITEM_NOT_FOUND");

  const defaults = await request("/v1/people/profile-display-defaults");
  const reorderedFields = defaults.fields
    .filter((field) => field.fieldKey !== "about")
    .map((field, order) => ({
      fieldKey: field.fieldKey,
      order,
      visible: field.visible,
    }));
  reorderedFields.push({
    fieldKey: "about",
    order: reorderedFields.length,
    visible: false,
  });
  const defaultBody = {
    commandId: "person-profile-defaults-01",
    fields: reorderedFields,
  };
  const changedDefaults = await request("/v1/people/profile-display-defaults", {
    body: defaultBody,
    method: "PATCH",
  });
  assert.equal(changedDefaults.defaults.fields.at(-1).fieldKey, "about");
  assert.equal(changedDefaults.defaults.fields.at(-1).visible, false);
  const defaultReplay = await request("/v1/people/profile-display-defaults", {
    body: defaultBody,
    method: "PATCH",
  });
  assert.equal(defaultReplay.replayed, true);

  const hidden = await request(`/v1/people/${personId}/profile-display`, {
    body: {
      commandId: "person-profile-display-hide",
      overrides: [{ fieldKey: "about", visibility: "hide" }],
    },
    method: "PATCH",
  });
  assert.equal(
    hidden.display.fields.find((field) => field.fieldKey === "about")
      .effectiveVisible,
    false,
  );
  assert.equal(
    (await request(`/v1/people/${personId}/profile`)).profile.about,
    `${privateSentinel} About`,
  );

  const shown = await request(`/v1/people/${personId}/profile-display`, {
    body: {
      commandId: "person-profile-display-show",
      overrides: [{ fieldKey: "about", visibility: "show" }],
    },
    method: "PATCH",
  });
  assert.equal(
    shown.display.fields.find((field) => field.fieldKey === "about")
      .effectiveVisible,
    true,
  );

  const inherited = await request(`/v1/people/${personId}/profile-display`, {
    body: {
      commandId: "person-profile-display-inherit",
      overrides: [{ fieldKey: "about", visibility: "inherit" }],
    },
    method: "PATCH",
  });
  assert.equal(
    inherited.display.fields.find((field) => field.fieldKey === "about")
      .effectiveVisible,
    false,
  );
}

if (phase === "readback" || phase === "all") {
  await assertPersistedState();
}

console.log(`Cimmich Person Profile journey (${phase}): PASS`);
