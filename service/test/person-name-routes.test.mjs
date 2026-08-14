import assert from "node:assert/strict";
import test from "node:test";

import { routePersonNames } from "../src/person-name-routes.mjs";

test("display-name route preserves the owner actor and stable Person ID", async () => {
  let input;
  let sent;
  const handled = await routePersonNames({
    allowedOrigin: "http://owner.test",
    readJsonBody: async () => ({ displayName: "Desired Name" }),
    repository: {
      setPersonDisplayName: async (value) => {
        input = value;
        return { changed: true, displayName: value.displayName };
      },
    },
    request: {
      headers: { "x-cimmich-actor": "owner" },
      method: "POST",
    },
    response: {},
    sendJson: (...parts) => {
      sent = parts;
    },
    url: new URL("http://local/v1/people/person.one/display-name"),
  });

  assert.equal(handled, true);
  assert.deepEqual(input, {
    actorId: "owner",
    displayName: "Desired Name",
    personId: "person.one",
  });
  assert.equal(sent[1], 200);
  assert.equal(sent[2].displayName, "Desired Name");
  assert.equal(sent[3], "http://owner.test");
});
