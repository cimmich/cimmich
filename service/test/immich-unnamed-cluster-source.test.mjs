import assert from "node:assert/strict";
import test from "node:test";

import { scanUnnamed } from "../src/immich-unnamed-cluster-source.mjs";

const scope = {
  includeHiddenPeople: false,
  mediaKinds: ["image"],
  visibilities: ["timeline"],
};

const readyCompanion = (overrides = {}) => ({
  listAssetFaces: async ({ assetId }) => ({ assetId, items: [] }),
  listAssets: async () => ({ items: [], nextCursor: null }),
  status: async () => ({
    capabilities: { mediaRead: true },
    immichVersion: "3.1.0",
    principal: { userId: "owner-fixture" },
    state: "ready",
  }),
  verifyOnboardingPermissions: async () => ({
    checks: { assetList: "passed", peopleList: "passed" },
    permissionState: "ready",
  }),
  ...overrides,
});

test("unnamed-person discovery rejects candidate expansion beyond its configured bound", async () => {
  const person = { id: "unnamed", isHidden: false, name: null };
  const companion = readyCompanion({
    listAssets: async () => ({
      items: ["one", "two"].map((id) => ({
        assetType: "image",
        immichAssetId: id,
        people: [person],
      })),
      nextCursor: null,
    }),
  });

  await assert.rejects(
    scanUnnamed(companion, scope, { maxTargetAssets: 1 }),
    (error) =>
      error.code === "IMMICH_PERSON_RESOLUTION_TARGET_TOO_LARGE" &&
      error.statusCode === 413,
  );
});

test("unnamed-person discovery enforces one end-to-end time bound", async () => {
  let clock = 0;
  const companion = readyCompanion({
    listAssets: async () => {
      clock = 10;
      return { items: [], nextCursor: "more" };
    },
  });

  await assert.rejects(
    scanUnnamed(companion, scope, { now: () => clock, timeoutMs: 10 }),
    (error) =>
      error.code === "IMMICH_PERSON_RESOLUTION_SOURCE_TIMEOUT" &&
      error.statusCode === 504,
  );
});
