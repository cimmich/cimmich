import assert from "node:assert/strict";
import { currentSchemaVersion } from "./current-schema.mjs";
import { readFile, unlink, writeFile } from "node:fs/promises";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_MANUAL_PRESENCE_PHASE || "write";
const statePath = "/tmp/cimmich-manual-presence-acceptance.json";
const actor = "synthetic-manual-presence-editor";
const principalId = "local-primary";
const deviceId = "synthetic-manual-presence-browser";

const request = async (path, { body, method = "GET", status = 200 } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": actor,
      "x-cimmich-device-id": deviceId,
      "x-cimmich-principal-id": principalId,
      "x-cimmich-surface": "interactive",
    },
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  assert.equal(response.headers.get("cache-control"), "no-store");
  return payload;
};

const command = (overrides = {}) => ({
  action: "attach",
  commandId: "manual-presence-person-point-a",
  geometry: { kind: "point", x: 0.63, y: 0.31 },
  subjectId: "person_candidate_fixture",
  subjectKind: "person",
  ...overrides,
});

if (phase === "write") {
  const health = await request("/health");
  assert.equal(health.schemaVersion, await currentSchemaVersion());
  const baseline = await request("/v1/summary");
  const pets = await request("/v1/pets");
  const miso = pets.items.find((pet) => pet.displayName === "Miso");
  assert.ok(miso);

  const attached = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    { body: command(), method: "POST" },
  );
  assert.equal(attached.schemaVersion, "cimmich.manual-subject-presence.v1");
  assert.equal(attached.status, "applied");
  assert.equal(attached.association.reasonCode, "manual_person");
  assert.deepEqual(attached.association.geometry, {
    kind: "point",
    x: 0.63,
    y: 0.31,
  });
  assert.equal(attached.undo.eligible, true);

  const replay = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    { body: command(), method: "POST" },
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.decisionId, attached.decisionId);

  const conflict = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({ geometry: { kind: "point", x: 0.2, y: 0.2 } }),
      method: "POST",
      status: 409,
    },
  );
  assert.equal(conflict.code, "MANUAL_PRESENCE_COMMAND_CONFLICT");

  const invalidGeometry = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({
        commandId: "manual-presence-invalid-geometry",
        geometry: { h: 0.4, kind: "region", w: 0.4, x: 0.8, y: 0.2 },
      }),
      method: "POST",
      status: 400,
    },
  );
  assert.equal(invalidGeometry.code, "MANUAL_PRESENCE_GEOMETRY_INVALID");

  const kindMismatch = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({
        commandId: "manual-presence-kind-mismatch",
        subjectKind: "pet",
      }),
      method: "POST",
      status: 409,
    },
  );
  assert.equal(kindMismatch.code, "MANUAL_PRESENCE_SUBJECT_KIND_MISMATCH");

  const headSelected = await request(
    "/v1/people/person_reassign_fixture/identity/assets/asset_service_fixture/head",
    {
      body: { selected: true },
      method: "POST",
    },
  );
  assert.equal(headSelected.selected, true);
  const authorityConflict = await request(
    "/v1/assets/asset_service_fixture/manual-presences",
    {
      body: command({
        commandId: "manual-presence-authority-conflict",
        subjectId: "person_reassign_fixture",
      }),
      method: "POST",
      status: 409,
    },
  );
  assert.equal(authorityConflict.code, "MANUAL_PRESENCE_AUTHORITY_CONFLICT");
  const headRestored = await request(
    "/v1/people/person_reassign_fixture/identity/assets/asset_service_fixture/head",
    {
      body: { selected: false },
      method: "POST",
    },
  );
  assert.equal(headRestored.selected, false);

  const region = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({
        commandId: "manual-presence-person-region-b",
        geometry: { h: 0.28, kind: "region", w: 0.22, x: 0.52, y: 0.18 },
      }),
      method: "POST",
    },
  );
  assert.equal(region.association.geometry.kind, "region");
  const regionUndone = await request(
    `/v1/manual-presences/decisions/${region.decisionId}/undo`,
    {
      body: { commandId: "manual-presence-person-region-undo" },
      method: "POST",
    },
  );
  assert.deepEqual(regionUndone.association.geometry, {
    kind: "point",
    x: 0.63,
    y: 0.31,
  });

  const detached = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({
        action: "detach",
        commandId: "manual-presence-person-detach-c",
        geometry: undefined,
      }),
      method: "POST",
    },
  );
  assert.equal(detached.association, null);
  const detachUndone = await request(
    `/v1/manual-presences/decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "manual-presence-person-detach-undo" },
      method: "POST",
    },
  );
  assert.equal(detachUndone.association.geometry.kind, "point");

  const petAttached = await request(
    "/v1/assets/asset_service_fixture/manual-presences",
    {
      body: command({
        commandId: "manual-presence-pet-point-a",
        geometry: { kind: "point", x: 0.2, y: 0.75 },
        subjectId: miso.petId,
        subjectKind: "pet",
      }),
      method: "POST",
    },
  );
  assert.equal(petAttached.association.reasonCode, "manual_pet");
  assert.equal(petAttached.association.subjectKind, "pet");

  const visibilityChanged = await request(
    "/v1/visibility/objects/asset/asset_body_link_ambiguous_fixture",
    {
      body: {
        commandId: "manual-presence-visibility-personal",
        visibilityTier: "personal",
      },
      method: "PATCH",
    },
  );
  const hidden = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    { status: 404 },
  );
  assert.equal(hidden.code, "VISIBILITY_OBJECT_NOT_VISIBLE");
  await request("/v1/visibility/mode", {
    body: { viewingMode: "personal" },
    method: "POST",
  });
  const visible = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
  );
  assert.equal(visible.items.length, 1);
  await request(
    `/v1/visibility/decisions/${visibilityChanged.decisionId}/undo`,
    {
      body: { commandId: "manual-presence-visibility-undo" },
      method: "POST",
    },
  );
  await request("/v1/visibility/mode", {
    body: { viewingMode: "standard" },
    method: "POST",
  });

  const after = await request("/v1/summary");
  assert.equal(after.face_observations, baseline.face_observations);
  assert.equal(after.body_observations, baseline.body_observations);
  assert.equal(after.candidate_signals, baseline.candidate_signals);
  await writeFile(
    statePath,
    JSON.stringify({
      baseline,
      misoId: miso.petId,
      petDecisionId: petAttached.decisionId,
    }),
  );
  console.log("Cimmich manual subject Presence write acceptance: PASS");
} else if (phase === "readback") {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const personReadback = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
  );
  assert.equal(personReadback.items.length, 1);
  assert.deepEqual(personReadback.items[0].geometry, {
    kind: "point",
    x: 0.63,
    y: 0.31,
  });
  const petReadback = await request(
    "/v1/assets/asset_service_fixture/manual-presences",
  );
  const miso = petReadback.items.find(
    (item) => item.subjectId === state.misoId,
  );
  assert.equal(miso.geometry.kind, "point");

  const petUndone = await request(
    `/v1/manual-presences/decisions/${state.petDecisionId}/undo`,
    {
      body: { commandId: "manual-presence-pet-point-undo" },
      method: "POST",
    },
  );
  assert.equal(petUndone.association.subjectId, state.misoId);
  assert.equal(petUndone.association.geometry, null);

  const detached = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({
        action: "detach",
        commandId: "manual-presence-person-cleanup-d",
        geometry: undefined,
      }),
      method: "POST",
    },
  );
  const detachReplay = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({
        action: "detach",
        commandId: "manual-presence-person-cleanup-d",
        geometry: undefined,
      }),
      method: "POST",
    },
  );
  assert.equal(detachReplay.replayed, true);
  const restored = await request(
    `/v1/manual-presences/decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "manual-presence-person-cleanup-undo" },
      method: "POST",
    },
  );
  assert.equal(restored.association.geometry.kind, "point");
  const unavailable = await request(
    `/v1/manual-presences/decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "manual-presence-person-cleanup-undo-again" },
      method: "POST",
      status: 409,
    },
  );
  assert.equal(unavailable.code, "MANUAL_PRESENCE_UNDO_NOT_AVAILABLE");
  await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
    {
      body: command({
        action: "detach",
        commandId: "manual-presence-person-final-detach",
        geometry: undefined,
      }),
      method: "POST",
    },
  );
  const finalPerson = await request(
    "/v1/assets/asset_body_link_ambiguous_fixture/manual-presences",
  );
  assert.equal(finalPerson.items.length, 0);
  const finalPet = await request(
    "/v1/assets/asset_service_fixture/manual-presences",
  );
  assert.equal(
    finalPet.items.find((item) => item.subjectId === state.misoId).geometry,
    null,
  );
  const finalSummary = await request("/v1/summary");
  assert.equal(finalSummary.assets, state.baseline.assets);
  assert.equal(
    finalSummary.face_observations,
    state.baseline.face_observations,
  );
  assert.equal(
    finalSummary.body_observations,
    state.baseline.body_observations,
  );
  assert.equal(
    finalSummary.candidate_signals,
    state.baseline.candidate_signals,
  );
  assert.equal(
    finalSummary.accepted_presence,
    state.baseline.accepted_presence,
  );
  await unlink(statePath);
  console.log(
    "Cimmich manual subject Presence restart/cleanup acceptance: PASS",
  );
} else {
  throw new Error(`Unknown CIMMICH_MANUAL_PRESENCE_PHASE ${phase}`);
}
