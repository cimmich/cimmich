import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_PERSON_DETAILS_DISPLAY_PHASE || "all";
const personId = "person_profile_acceptance_fixture";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-details-editor",
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

const expectedKeys = [
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

const assertPersisted = async () => {
  const defaults = await request("/v1/people/profile-details-display-defaults");
  assert.equal(defaults.schemaVersion, "cimmich.person-details-display.v1");
  assert.deepEqual(
    defaults.sections.map((section) => section.sectionKey),
    [...expectedKeys].reverse(),
  );
  assert.equal(
    defaults.sections.find((section) => section.sectionKey === "about")
      ?.visible,
    false,
  );

  const display = await request(
    `/v1/people/${personId}/profile-details-display`,
  );
  assert.equal(display.schemaVersion, "cimmich.person-details-display.v1");
  const about = display.sections.find(
    (section) => section.sectionKey === "about",
  );
  const notes = display.sections.find(
    (section) => section.sectionKey === "private_notes",
  );
  assert.equal(about.visibility, "show");
  assert.equal(about.defaultVisible, false);
  assert.equal(about.effectiveVisible, true);
  assert.equal(notes.visibility, "hide");
  assert.equal(notes.effectiveVisible, false);

  // Display changes are presentation-only and must preserve profile truth.
  const profile = await request(`/v1/people/${personId}/profile`);
  assert.match(profile.profile.about, /private-profile-sentinel/);
  assert.match(profile.profile.privateNotes, /private-profile-sentinel/);
};

if (phase === "write" || phase === "all") {
  const initial = await request("/v1/people/profile-details-display-defaults");
  assert.deepEqual(
    initial.sections.map((section) => section.sectionKey),
    expectedKeys,
  );
  assert.ok(initial.sections.every((section) => section.visible));

  const reordered = [...initial.sections].reverse().map((section, order) => ({
    order,
    sectionKey: section.sectionKey,
    visible: section.sectionKey !== "about",
  }));
  const defaultsBody = {
    commandId: "person-details-defaults-0001",
    sections: reordered,
  };
  const changed = await request("/v1/people/profile-details-display-defaults", {
    body: defaultsBody,
    method: "PATCH",
  });
  assert.equal(changed.replayed, false);
  assert.equal(changed.defaults.sections[0].sectionKey, "private_notes");

  const replay = await request("/v1/people/profile-details-display-defaults", {
    body: defaultsBody,
    method: "PATCH",
  });
  assert.equal(replay.replayed, true);

  const conflict = await request(
    "/v1/people/profile-details-display-defaults",
    {
      body: {
        ...defaultsBody,
        sections: defaultsBody.sections.map((section) => ({
          ...section,
          visible: true,
        })),
      },
      method: "PATCH",
      status: 409,
    },
  );
  assert.equal(conflict.code, "PERSON_DETAILS_DISPLAY_COMMAND_CONFLICT");

  const invalid = await request("/v1/people/profile-details-display-defaults", {
    body: {
      commandId: "person-details-invalid-0001",
      sections: defaultsBody.sections.slice(0, 8),
    },
    method: "PATCH",
    status: 400,
  });
  assert.equal(invalid.code, "PERSON_DETAILS_DISPLAY_INVALID");

  const personBody = {
    commandId: "person-details-person-0001",
    overrides: [
      { sectionKey: "about", visibility: "show" },
      { sectionKey: "private_notes", visibility: "hide" },
    ],
  };
  const personChanged = await request(
    `/v1/people/${personId}/profile-details-display`,
    { body: personBody, method: "PATCH" },
  );
  assert.equal(personChanged.replayed, false);
  const personReplay = await request(
    `/v1/people/${personId}/profile-details-display`,
    { body: personBody, method: "PATCH" },
  );
  assert.equal(personReplay.replayed, true);
}

if (phase === "readback" || phase === "all") await assertPersisted();
