import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_URL || "http://127.0.0.1:3101";
const response = await fetch(`${root}/v1/decisions?limit=100`, {
  headers: {
    "x-cimmich-device-id": "decision-history-acceptance-device",
    "x-cimmich-principal-id": "local-primary",
    "x-cimmich-surface": "interactive",
  },
});
assert.equal(response.status, 200);
const history = await response.json();
assert.equal(history.schemaVersion, "cimmich.decision-history.v1");
assert.equal(Array.isArray(history.items), true);
assert.equal(history.items.length <= 100, true);
for (const item of history.items) {
  assert.deepEqual(Object.keys(item).sort(), [
    "createdAt",
    "decisionId",
    "decisionKind",
    "state",
    "subjectId",
    "subjectKind",
    "undo",
  ]);
  assert.equal(item.undo.link.startsWith("/v1/"), true);
  assert.equal(typeof item.undo.eligible, "boolean");
}
process.stdout.write(
  `${JSON.stringify({
    itemCount: history.items.length,
    schemaVersion: history.schemaVersion,
    visibilityBeforeProjection: true,
  })}\n`,
);
