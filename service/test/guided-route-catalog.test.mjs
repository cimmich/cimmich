import assert from "node:assert/strict";
import test from "node:test";
import {
  guidedRouteCatalog,
  matchGuidedCanonicalRoute,
} from "../src/guided-route-catalog.mjs";

test("Guided route catalogue is deterministic, unique and machine-readable", () => {
  const left = guidedRouteCatalog();
  const right = guidedRouteCatalog();
  assert.deepEqual(left, right);
  assert.equal(left.items.length >= 50, true);
  assert.equal(
    new Set(left.items.map((item) => item.id)).size,
    left.items.length,
  );
  for (const item of left.items) {
    assert.match(item.id, /^[a-z][a-z0-9_.]+$/);
    assert.equal(["read", "operate"].includes(item.authority), true);
    assert.equal(
      item.requestSchema === null || item.requestSchema.type === "object",
      true,
    );
    assert.equal(item.responseSchema.type, "object");
  }
});

test("Guided publishes one exact provider-disabled inventory admission payload", () => {
  const operation = guidedRouteCatalog().items.find(
    (item) => item.id === "immich.sync",
  );
  assert.equal(operation.requestSchema.properties.envelope.type, "object");
  assert.deepEqual(operation.requestExample, {
    commandId: "guided-inventory-sync-0001",
    commandKind: "run",
    envelope: {
      candidateLimit: 0,
      leaseSeconds: 300,
      maxDetectionJobs: 0,
      maxDurationMs: 30_000,
      maxInventoryPages: 1,
      maxPendingJobs: 100,
      maxRecognitionJobs: 0,
    },
  });
  assert.deepEqual(operation.requestSchema.properties.commandKind.enum, [
    "run",
  ]);
  assert.deepEqual(
    [...operation.requestSchema.properties.envelope.required].sort(),
    Object.keys(operation.requestExample.envelope).sort(),
  );
  assert.deepEqual(
    operation.responseSchema.properties.inventory.properties.admittedAssets
      .items.required,
    ["assetId", "sourceAssetId"],
  );
  assert.equal(
    operation.responseExample.inventory.admittedAssets[0].sourceAssetId,
    "immich_source_asset_example",
  );
});

test("Guided request catalogue preserves canonical nested shapes and closed enums", () => {
  const byId = new Map(
    guidedRouteCatalog().items.map((operation) => [operation.id, operation]),
  );

  for (const operation of byId.values()) {
    for (const [field, schema] of Object.entries(
      operation.requestSchema?.properties || {},
    )) {
      if (schema?.type !== "array" || schema.items?.type !== "object") {
        continue;
      }
      assert.notDeepEqual(
        schema.items,
        { type: "object" },
        `${operation.id}.${field} must not publish a generic object item`,
      );
      assert.equal(schema.items.additionalProperties, false);
      assert.equal(Object.keys(schema.items.properties || {}).length > 0, true);
      assert.equal((schema.items.required || []).length > 0, true);
    }
  }

  const manualReplace = byId.get("manual_subject_tags.replace").requestSchema;
  assert.deepEqual(manualReplace.properties.tagType.enum, [
    "face",
    "head",
    "body",
    "presence",
  ]);
  assert.deepEqual(manualReplace.properties.subjectKind.enum, [
    "person",
    "pet",
  ]);

  assert.deepEqual(
    byId.get("visibility.mode").requestSchema.properties.viewingMode.enum,
    ["standard", "personal", "private"],
  );
  assert.deepEqual(
    byId.get("visibility.lock").requestSchema.properties.reason.enum,
    ["explicit", "background", "device_lock", "account_lock"],
  );
  assert.deepEqual(byId.get("visibility.lock").requestExample, {
    reason: "explicit",
  });
  assert.deepEqual(
    byId.get("visibility.object_set").requestSchema.properties.visibilityTier
      .enum,
    ["standard", "personal", "private"],
  );

  const expectedKinds = {
    events: ["trip", "event", "activity", "life_period"],
    objects: [
      "vehicle",
      "property",
      "device",
      "collectible",
      "equipment",
      "other",
    ],
    places: ["point", "area", "route", "unlocated"],
  };
  for (const family of ["places", "objects", "events"]) {
    for (const action of ["create", "update"]) {
      const schema = byId.get(`${family}.${action}`).requestSchema;
      assert.equal(schema.properties.aliases.type, "array");
      assert.equal(schema.properties.aliases.items.type, "string");
      assert.deepEqual(schema.properties.typeKind.enum, expectedKinds[family]);
      assert.deepEqual(schema.properties.datePrecision.enum, [
        "exact",
        "month",
        "year",
        "approximate",
        "unknown",
      ]);
      assert.equal(
        family === "places"
          ? Array.isArray(schema.properties.geometry.oneOf)
          : schema.properties.geometry.type === "null",
        true,
      );
    }

    const assets = byId.get(`${family}.assets_attach`);
    assert.deepEqual(assets.requestSchema.properties.assets.items.required, [
      "assetId",
      "associationKind",
    ]);
    assert.equal(
      assets.requestSchema.properties.assets.items.properties.associationKind
        .enum.length > 0,
      true,
    );
    assert.equal(assets.responseSchema.properties.detail.type, "object");
    assert.equal(assets.responseExample.detail.entity.revision, 2);

    const relations = byId.get(`${family}.relations_attach`);
    assert.equal(
      relations.requestSchema.properties.relations.items.properties.direction
        .const,
      "outgoing",
    );
    assert.deepEqual(
      relations.requestSchema.properties.relations.items.properties.relationKind
        .enum,
      family === "events"
        ? [
            "participant",
            "companion",
            "location",
            "object",
            "parent",
            "related",
          ]
        : family === "places"
          ? ["parent", "related"]
          : ["related"],
    );
    assert.deepEqual(
      relations.requestSchema.properties.relations.items.properties.targetKind
        .enum,
      ["person", "pet", "place", "object", "event"],
    );
    assert.equal(relations.responseExample.detail.entity.revision, 3);
  }

  const batch = byId.get("visibility.objects_batch_set");
  assert.deepEqual(batch.requestSchema.properties.objects.items.required, [
    "objectScope",
    "objectId",
    "visibilityTier",
  ]);
  assert.deepEqual(
    batch.requestSchema.properties.objects.items.properties.visibilityTier.enum,
    ["standard", "personal", "private"],
  );
  assert.deepEqual(
    batch.requestSchema.properties.objects.items.properties.objectScope.enum,
    ["asset", "context_entity", "document", "person", "pet"],
  );
  assert.equal(batch.responseExample.objects[0].revision, 1);
});

test("Guided event verification links target the current Events product", () => {
  const eventOperations = guidedRouteCatalog().items.filter(
    (operation) => operation.domain === "events",
  );
  assert.equal(eventOperations.length > 0, true);
  assert.equal(
    eventOperations.every((operation) =>
      operation.uiVerificationLink.startsWith("/cimmich/events"),
    ),
    true,
  );
});

test("Guided publishes the governed owner SourcePack journey without caller policy", () => {
  const byId = new Map(
    guidedRouteCatalog().items.map((operation) => [operation.id, operation]),
  );
  const ids = [
    "face_matching.status",
    "face_matching.recognition_run",
    "face_matching.source_pack_compile",
    "face_matching.source_pack_read",
    "face_matching.source_pack_evaluate",
    "face_matching.source_pack_review",
    "face_matching.source_pack_activate",
    "face_matching.source_pack_rollback",
  ];
  for (const id of ids) {
    const operation = byId.get(id);
    assert.ok(operation, id);
    assert.equal(operation.uiVerificationLink, "/cimmich/maintenance");
  }
  const status = byId.get("face_matching.status").responseSchema;
  assert.equal(status.required.includes("evidence"), true);
  assert.equal(status.required.includes("latestPack"), true);
  assert.equal(
    status.properties.next.properties.action.enum.includes(
      "activate_source_pack",
    ),
    true,
  );
  assert.equal(
    status.properties.next.properties.action.enum.includes(
      "await_more_evidence",
    ),
    true,
  );
  assert.equal(
    status.properties.next.properties.action.enum.includes("enable_enhanced"),
    true,
  );
  const compile = byId.get("face_matching.source_pack_compile");
  assert.deepEqual(compile.requestSchema.required, []);
  assert.deepEqual(compile.requestSchema.properties, {});
  const recognition = byId.get("face_matching.recognition_run").requestSchema;
  assert.deepEqual(Object.keys(recognition.properties).sort(), [
    "commandId",
    "workLimit",
  ]);
  const packProjection = byId.get("face_matching.source_pack_read")
    .responseSchema.properties.pack;
  assert.equal(packProjection.required.includes("reviewGateReceipt"), true);
  assert.equal(
    packProjection.required.includes("reviewGateReceiptNullReason"),
    true,
  );
  const evaluationProjection = byId.get("face_matching.source_pack_evaluate")
    .responseSchema.properties.evaluation;
  assert.equal(
    evaluationProjection.required.includes("reviewGateReceipt"),
    true,
  );
  assert.equal(
    evaluationProjection.properties.reviewGateReceiptNullReason.enum.includes(
      "INSUFFICIENT_VERIFIED_UNKNOWNS",
    ),
    true,
  );
  const review = byId.get("face_matching.source_pack_review").requestSchema;
  assert.deepEqual(review.properties.gateReceipt.properties.authorityScope, {
    const: "human-review",
    type: "string",
  });
  assert.deepEqual(
    review.properties.gateReceipt.properties.matcherPolicy.oneOf[0].properties
      .scorer,
    { const: "best_individual_prime", type: "string" },
  );
  for (const operation of ids.map((id) => byId.get(id))) {
    const serialized = JSON.stringify(operation.requestSchema);
    for (const forbidden of [
      '"providerId"',
      '"modelFamily"',
      '"modelVersion"',
      '"configDigest"',
      '"vectorSpaceId"',
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  }
});

test("Guided route matcher is exact and excludes hidden internal authority", () => {
  for (const [method, pathname, id] of [
    ["POST", "/v1/events/event-one/assets:attach", "events.assets_attach"],
    ["POST", "/v1/faces/face-one/geometry", "faces.geometry_correct"],
    [
      "PATCH",
      "/v1/visibility/objects/context_entity/place-one",
      "visibility.object_set",
    ],
    [
      "POST",
      "/v1/operator/face-matching/source-packs/pack-one/activate",
      "face_matching.source_pack_activate",
    ],
    ["GET", "/v1/documents", "documents.collection"],
    ["POST", "/v1/operator/enhanced", "enhanced.control"],
    ["POST", "/v1/people/merge", "people.merge"],
    ["GET", "/v1/pets", "pets.collection"],
    [
      "POST",
      "/v1/assets/asset-one/manual-presences",
      "manual_presences.modify",
    ],
  ]) {
    assert.equal(matchGuidedCanonicalRoute({ method, pathname })?.id, id);
  }
  for (const [method, pathname] of [
    ["POST", "/v1/media-jobs"],
    ["POST", "/v1/steward/plan"],
    ["GET", "/v1/companion/assets/source-one"],
    ["DELETE", "/v1/events/event-one"],
    ["GET", "/v1/events/event-one/private-internal"],
  ]) {
    assert.equal(matchGuidedCanonicalRoute({ method, pathname }), null);
  }
});

test("Guided truthfully publishes context create and update no-change/Undo responses", () => {
  const byId = new Map(
    guidedRouteCatalog().items.map((operation) => [operation.id, operation]),
  );
  for (const family of ["places", "objects", "events"]) {
    for (const action of ["create", "update"]) {
      const operation = byId.get(`${family}.${action}`);
      assert.equal(operation.undo, "/v1/context/decisions/{decisionId}/undo");
      assert.deepEqual(operation.responseSchema.properties.decisionId.anyOf, [
        { maxLength: 200, minLength: 1, type: "string" },
        { type: "null" },
      ]);
      assert.deepEqual(operation.responseSchema.properties.status.enum, [
        "applied",
        "no_change",
      ]);
      assert.deepEqual(operation.responseSchema.properties.undo.required, [
        "eligible",
        "token",
      ]);
      assert.equal(operation.responseExample.undo.eligible, true);
      assert.equal(
        operation.responseExample.undo.token,
        operation.responseExample.decisionId,
      );
    }
  }
});
