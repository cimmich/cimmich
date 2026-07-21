import assert from "node:assert/strict";
import test from "node:test";
import { cleanManualPresenceGeometry } from "../src/manual-subject-presence.mjs";

test("manual Presence accepts a normalized point", () => {
  assert.deepEqual(
    cleanManualPresenceGeometry({ kind: "point", x: 0.4, y: 0.6 }),
    {
      kind: "point",
      x: 0.4,
      y: 0.6,
    },
  );
});

test("manual Presence accepts a bounded normalized region", () => {
  assert.deepEqual(
    cleanManualPresenceGeometry({
      h: 0.4,
      kind: "region",
      w: 0.3,
      x: 0.2,
      y: 0.1,
    }),
    { h: 0.4, kind: "region", w: 0.3, x: 0.2, y: 0.1 },
  );
});

for (const [name, geometry] of [
  ["unknown kind", { kind: "face", x: 0.2, y: 0.2 }],
  ["out-of-bounds point", { kind: "point", x: 1.1, y: 0.2 }],
  ["point with size", { h: 0.1, kind: "point", w: 0.1, x: 0.2, y: 0.2 }],
  ["overflowing region", { h: 0.4, kind: "region", w: 0.4, x: 0.8, y: 0.2 }],
]) {
  test(`manual Presence rejects ${name}`, () => {
    assert.throws(
      () => cleanManualPresenceGeometry(geometry),
      (error) => error.code === "MANUAL_PRESENCE_GEOMETRY_INVALID",
    );
  });
}
