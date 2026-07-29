import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createXmpSidecarReviewStore,
  xmpSidecarReviewSchemaVersion,
} from "../src/xmp-sidecar-review.mjs";

const groupId = (sourceId, normalizedName) =>
  `xmp_name_${createHash("sha256")
    .update(`${sourceId}\u001f${normalizedName}`)
    .digest("hex")}`;

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};

const requestDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const fakeSql = (handler) => {
  const sql = async (first, ...values) => {
    if (Array.isArray(first) && !Object.hasOwn(first, "raw")) return first;
    return handler(first.join("?"), values);
  };
  return sql;
};

test("unresolved XMP names are grouped by ROI with bounded visible previews", async () => {
  let queryIndex = 0;
  const sql = fakeSql((text) => {
    queryIndex += 1;
    if (text.includes("WITH unresolved AS")) {
      return [
        {
          asset_count: 7,
          asset_id: "asset_1",
          box_h: "0.4",
          box_w: "0.2",
          box_x: "0.3",
          box_y: "0.2",
          conflicting_identity_count: 0,
          face_count: 9,
          face_id: "face_1",
          first_capture_time: "2001-01-01T00:00:00Z",
          height: 3000,
          last_capture_time: "2010-01-01T00:00:00Z",
          normalized_name: "Known Historical Label",
          raw_name_variants: [
            "Known Historical Label",
            "Known Historical Label 1",
          ],
          source_asset_id: "immich_1",
          source_id: "x1-archive-xmp",
          width: 4000,
        },
      ];
    }
    assert.match(text, /remaining_group_count/);
    return [{ remaining_group_count: 224 }];
  });
  const store = createXmpSidecarReviewStore(sql, {
    bridgeFields: () => ({ sourceAssetId: "bridge_fallback" }),
    presentationRank: () => 1,
  });
  const result = await store.list({ limit: 24 });
  assert.equal(queryIndex, 2);
  assert.equal(result.schemaVersion, xmpSidecarReviewSchemaVersion);
  assert.equal(result.remainingGroupCount, 224);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].faceCount, 9);
  assert.equal(result.items[0].previews[0].sourceAssetId, "immich_1");
  assert.equal(
    result.items[0].groupId,
    groupId("x1-archive-xmp", "Known Historical Label"),
  );
});

test("completed owner resolution commands replay without another write", async () => {
  const stableGroupId = groupId("x1-archive-xmp", "Historical Label");
  let queryCount = 0;
  const sql = fakeSql((text) => {
    queryCount += 1;
    assert.match(text, /xmp_sidecar_name_resolution_command/);
    return [
      {
        actor_id: "local-operator",
        group_id: stableGroupId,
        request_digest: requestDigest({
          groupId: stableGroupId,
          personId: "person_target",
          selectorKind: "existing_person",
        }),
        response_body: {
          personId: "person_target",
          resolvedFaceCount: 12,
          state: "resolved",
        },
        state: "completed",
      },
    ];
  });
  const store = createXmpSidecarReviewStore(sql);
  const result = await store.resolve({
    actorId: "local-operator",
    commandId: "xmp-owner-resolution-0001",
    groupId: stableGroupId,
    personId: "person_target",
  });
  assert.equal(queryCount, 1);
  assert.equal(result.replayed, true);
  assert.equal(result.resolvedFaceCount, 12);
});

test("owner resolution requires exactly one explicit Person selector", async () => {
  const store = createXmpSidecarReviewStore(fakeSql(() => []));
  await assert.rejects(
    store.resolve({
      actorId: "local-operator",
      commandId: "xmp-owner-resolution-0002",
      groupId: groupId("x1-archive-xmp", "Historical Label"),
    }),
    { code: "XMP_NAME_RESOLUTION_SELECTOR_INVALID" },
  );
  await assert.rejects(
    store.resolve({
      actorId: "local-operator",
      commandId: "xmp-owner-resolution-0003",
      groupId: groupId("x1-archive-xmp", "Historical Label"),
      newPersonName: "New Person",
      personId: "person_target",
    }),
    { code: "XMP_NAME_RESOLUTION_SELECTOR_INVALID" },
  );
});
