import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bulkReassignFaceIdentities } from "../src/bulk-face-identity-reassignment.mjs";

test("batch Face reassignment creates one Person then uses four ordered workers", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls = [];
  const items = Array.from({ length: 13 }, (_, index) => ({
    faceId: `face-${index}`,
    newPersonName: "Split Person",
  }));
  const result = await bulkReassignFaceIdentities({
    actorId: "local-operator",
    items,
    reassign: async (input) => {
      calls.push(input);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        changed: true,
        createdPerson: Object.hasOwn(input, "newPersonName"),
        faceId: input.faceId,
        personId: "person-created",
        personName: "Split Person",
      };
    },
  });

  assert.equal(maximumActive, 4);
  assert.equal(
    calls.filter((input) => Object.hasOwn(input, "newPersonName")).length,
    1,
  );
  assert.equal(
    calls.filter((input) => input.personId === "person-created").length,
    12,
  );
  assert.deepEqual(
    result.assigned.map(({ faceId }) => faceId),
    items.map(({ faceId }) => faceId),
  );
});

test("existing Person Face reassignment uses a shared target lock", async () => {
  const source = await readFile(
    new URL("../src/repository.mjs", import.meta.url),
    "utf8",
  );
  const reassignment = source.slice(
    source.indexOf("async reassignFaceIdentity"),
    source.indexOf("async bulkReassignFaceIdentities"),
  );

  assert.match(
    reassignment,
    /person_id = \$\{targetPersonId\}[\s\S]{0,300}FOR SHARE/,
  );
  assert.doesNotMatch(
    reassignment,
    /person_id = \$\{targetPersonId\}[\s\S]{0,300}FOR UPDATE/,
  );
});
