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

test("unnamed-person discovery returns useful partial candidates at its configured bound", async () => {
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

  const result = await scanUnnamed(companion, scope, { maxTargetAssets: 1 });
  assert.deepEqual(
    result.assets.map(({ immichAssetId }) => immichAssetId),
    ["one"],
  );
  assert.equal(result.scanSummary.complete, false);
  assert.equal(result.scanSummary.truncationReason, "target_limit");
});

test("unnamed-person discovery returns hydrated progress at its end-to-end time bound", async () => {
  let clock = 0;
  const companion = readyCompanion({
    listAssetFaces: async ({ assetId }) => {
      clock = 10;
      return { assetId, items: [] };
    },
    listAssets: async () => ({
      items: [
        {
          assetType: "image",
          immichAssetId: "one",
          people: [{ id: "unnamed", isHidden: false, name: null }],
        },
      ],
      nextCursor: "more",
    }),
  });

  const result = await scanUnnamed(companion, scope, {
    now: () => clock,
    timeoutMs: 10,
  });
  assert.deepEqual(
    result.assets.map(({ immichAssetId }) => immichAssetId),
    ["one"],
  );
  assert.equal(result.scanSummary.complete, false);
  assert.equal(result.scanSummary.truncationReason, "timeout");
});
