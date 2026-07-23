import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";

test("People project ordinary accepted Faces and accepted Body regions without matching authority", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("?");
    return [
      {
        accepted_faces: 1,
        aliases: [],
        asset_count: 2,
        body_preview_asset_id: "asset-body",
        body_preview_body_id: "body-1",
        body_preview_box_h: 0.6,
        body_preview_box_w: 0.3,
        body_preview_box_x: 0.2,
        body_preview_box_y: 0.1,
        body_preview_height: 1200,
        body_preview_width: 1800,
        box_h: 0.2,
        box_w: 0.1,
        box_x: 0.4,
        box_y: 0.3,
        candidate_faces: 0,
        categories: [],
        display_name: "Person",
        height: 1200,
        head_faces: 0,
        needs_holding: false,
        needs_sort: false,
        person_id: "person-1",
        prime_faces: 0,
        presentation_body_asset_id: "asset-presentation-body",
        presentation_body_crop: { h: 0.5, w: 0.4, x: 0.2, y: 0.25 },
        presentation_body_height: 1600,
        presentation_body_observation_id: "body-2",
        presentation_body_observation_kind: "body",
        presentation_body_updated_at: "2026-07-24T00:00:00.000Z",
        presentation_body_width: 1200,
        presentation_face_asset_id: "asset-presentation-face",
        presentation_face_crop: { h: 0.4, w: 0.3, x: 0.45, y: 0.2 },
        presentation_face_height: 1600,
        presentation_face_observation_id: "face-2",
        presentation_face_observation_kind: "face",
        presentation_face_updated_at: "2026-07-24T00:01:00.000Z",
        presentation_face_width: 1200,
        representative_asset_id: "asset-face",
        representative_face_id: "face-1",
        secondary_faces: 0,
        status: "active",
        subject_kind: "person",
        width: 1800,
      },
    ];
  };
  const bridge = new Map([
    ["asset-body", { filename: "body.jpg", sourceAssetId: "source-body" }],
    ["asset-face", { filename: "face.jpg", sourceAssetId: "source-face" }],
    [
      "asset-presentation-body",
      {
        filename: "selected-body.jpg",
        sourceAssetId: "source-presentation-body",
      },
    ],
    [
      "asset-presentation-face",
      {
        filename: "selected-face.jpg",
        sourceAssetId: "source-presentation-face",
      },
    ],
  ]);
  const repository = createCimmichRepository(sql, bridge);

  const [person] = await repository.people();

  assert.equal(person.representative_face_id, "face-1");
  assert.equal(person.sourceAssetId, "source-face");
  assert.deepEqual(person.bodyPreview, {
    assetId: "asset-body",
    bodyId: "body-1",
    box_h: 0.6,
    box_w: 0.3,
    box_x: 0.2,
    box_y: 0.1,
    height: 1200,
    schemaVersion: "cimmich.person-body-preview.v1",
    sourceAssetId: "source-body",
    width: 1800,
  });
  assert.deepEqual(person.presentationBody, {
    assetId: "asset-presentation-body",
    crop: { h: 0.5, w: 0.4, x: 0.2, y: 0.25 },
    filename: "selected-body.jpg",
    height: 1600,
    observationId: "body-2",
    observationKind: "body",
    selectionMode: "explicit",
    slotKind: "body",
    sourceAssetId: "source-presentation-body",
    updatedAt: "2026-07-24T00:00:00.000Z",
    width: 1200,
  });
  assert.deepEqual(person.presentationFace, {
    assetId: "asset-presentation-face",
    crop: { h: 0.4, w: 0.3, x: 0.45, y: 0.2 },
    filename: "selected-face.jpg",
    height: 1600,
    observationId: "face-2",
    observationKind: "face",
    selectionMode: "explicit",
    slotKind: "face",
    sourceAssetId: "source-presentation-face",
    updatedAt: "2026-07-24T00:01:00.000Z",
    width: 1200,
  });
  assert.match(
    statement,
    /WHERE identity\.state = 'accepted' AND identity\.face_state = 'valid'/,
  );
  assert.doesNotMatch(statement, /subject\.subject_kind = 'pet'/);
  assert.match(statement, /body_representatives AS MATERIALIZED/);
  assert.match(
    statement,
    /cimmich_visibility_asset_rank\(observation\.asset_id\) <=/,
  );
  assert.match(statement, /tag\.state = 'accepted'/);
  assert.match(statement, /person_presentation_media presentation_body/);
  assert.match(statement, /person_presentation_media presentation_face/);
});

test("Person overview uses request-local evidence sets instead of global projection views", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("?");
    return [
      {
        accepted_faces: 3,
        aliases: [],
        asset_count: 2,
        body_preview_asset_id: "asset-body",
        body_preview_body_id: "body-1",
        body_preview_box_h: 0.7,
        body_preview_box_w: 0.4,
        body_preview_box_x: 0.1,
        body_preview_box_y: 0.2,
        body_preview_height: 1200,
        body_preview_width: 1800,
        candidate_faces: 0,
        categories: [],
        display_name: "Person",
        height: 1200,
        head_faces: 0,
        needs_holding: false,
        needs_sort: false,
        person_id: "person-1",
        prime_faces: 1,
        representative_asset_id: "asset-face",
        representative_face_id: "face-1",
        secondary_faces: 0,
        status: "active",
        subject_kind: "person",
        width: 1800,
      },
    ];
  };
  const repository = createCimmichRepository(
    sql,
    new Map([
      ["asset-body", { filename: "body.jpg", sourceAssetId: "source-body" }],
      ["asset-face", { filename: "face.jpg", sourceAssetId: "source-face" }],
    ]),
  );

  const person = await repository.person({ personId: "person-1" });

  assert.equal(person.asset_count, 2);
  assert.equal(person.sourceAssetId, "source-face");
  assert.equal(person.bodyPreview.sourceAssetId, "source-body");
  assert.match(statement, /accepted_faces AS MATERIALIZED/);
  assert.match(statement, /gallery_latest AS MATERIALIZED/);
  assert.match(statement, /accepted_assets AS MATERIALIZED/);
  assert.match(statement, /FROM current_manual_head_tag/);
  assert.match(statement, /photo_history AS MATERIALIZED/);
  assert.match(statement, /asset\.media_kind = 'image'/);
  assert.match(statement, /futureCaptureDateCount/);
  assert.match(statement, /person_categories AS MATERIALIZED/);
  assert.match(statement, /body_representative AS MATERIALIZED/);
  assert.match(statement, /tag\.person_id =/);
  assert.match(statement, /tag\.state = 'accepted'/);
  assert.match(statement, /cimmich_visibility_asset_rank\(body\.asset_id\) <=/);
  assert.doesNotMatch(statement, /FROM person_assets/);
  assert.doesNotMatch(statement, /FROM current_reference_gallery/);
});

test("Person presentation falls back to the current portrait, hero and body evidence", async () => {
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("FROM person_presentation_media")) return [];
    if (statement.includes("body_representative AS MATERIALIZED")) {
      return [
        {
          accepted_faces: 1,
          aliases: [],
          asset_count: 1,
          body_preview_asset_id: "asset-body",
          body_preview_body_id: "body-1",
          body_preview_box_h: 0.7,
          body_preview_box_w: 0.4,
          body_preview_box_x: 0.1,
          body_preview_box_y: 0.2,
          body_preview_height: 1200,
          body_preview_width: 1800,
          candidate_faces: 0,
          categories: [],
          display_name: "Person",
          height: 1200,
          head_faces: 0,
          needs_holding: false,
          needs_sort: false,
          person_id: "person-1",
          prime_faces: 1,
          representative_asset_id: "asset-face",
          representative_face_id: "face-1",
          box_h: 0.2,
          box_w: 0.1,
          box_x: 0.4,
          box_y: 0.3,
          secondary_faces: 0,
          status: "active",
          subject_kind: "person",
          width: 1800,
        },
      ];
    }
    if (statement.includes("FROM current_person")) {
      return [{ person_id: "person-1", subject_kind: "person" }];
    }
    return [];
  };
  const repository = createCimmichRepository(
    sql,
    new Map([
      ["asset-body", { filename: "body.jpg", sourceAssetId: "source-body" }],
      ["asset-face", { filename: "face.jpg", sourceAssetId: "source-face" }],
    ]),
  );

  const presentation = await repository.personPresentation({
    personId: "person-1",
  });

  assert.equal(presentation.face.filename, "face.jpg");
  assert.equal(presentation.face.selectionMode, "automatic");
  assert.equal(presentation.hero.sourceAssetId, "source-face");
  assert.equal(presentation.hero.selectionMode, "automatic");
  assert.equal(presentation.body.filename, "body.jpg");
  assert.equal(presentation.body.selectionMode, "automatic");
  assert.deepEqual(presentation.body.crop, {
    h: 0.784,
    w: 0.44800000000000006,
    x: 0.07600000000000001,
    y: 0.15800000000000003,
  });
});

test("Person presentation persists only confirmed Person evidence and projects framing", async () => {
  const statements = [];
  const rows = [];
  const sql = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (statement.includes("FROM current_person")) {
      return [{ person_id: "person-1", subject_kind: "person" }];
    }
    if (statement.includes("FROM current_face_identity")) {
      return [{ exists: 1 }];
    }
    if (statement.includes("INSERT INTO person_presentation_media")) {
      rows.splice(0, rows.length, {
        asset_id: "asset-1",
        crop: { h: 0.5, w: 0.5, x: 0.25, y: 0.2 },
        observation_id: "face-1",
        observation_kind: "face",
        slot_kind: "face",
        updated_at: new Date("2026-07-23T00:00:00.000Z"),
        height: 1200,
        width: 1800,
      });
      return [];
    }
    if (statement.includes("FROM person_presentation_media")) {
      return rows;
    }
    return [];
  };
  sql.json = (value) => value;
  const repository = createCimmichRepository(
    sql,
    new Map([
      [
        "asset-1",
        { filename: "portrait.jpg", sourceAssetId: "immich-asset-1" },
      ],
    ]),
  );

  const presentation = await repository.setPersonPresentation({
    actorId: "tester",
    assetId: "asset-1",
    crop: { h: 0.5, w: 0.5, x: 0.25, y: 0.2 },
    observationId: "face-1",
    observationKind: "face",
    personId: "person-1",
    slotKind: "face",
  });

  assert.equal(presentation.face.filename, "portrait.jpg");
  assert.equal(presentation.face.selectionMode, "explicit");
  assert.equal(presentation.face.sourceAssetId, "immich-asset-1");
  assert.deepEqual(presentation.face.crop, {
    h: 0.5,
    w: 0.5,
    x: 0.25,
    y: 0.2,
  });
  assert.ok(
    statements.some(({ statement }) =>
      statement.includes("FROM current_face_identity"),
    ),
  );
  assert.ok(
    statements.some(({ statement }) =>
      statement.includes("INSERT INTO person_presentation_media"),
    ),
  );
});

test("Person assets resolve scoped associations without expanding person_assets", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("?");
    return [
      {
        asset_head_evidence: false,
        asset_id: "asset-1",
        capture_time: null,
        contexts: [
          {
            displayName: "Cedar House",
            entityId: "place-1",
            entityKind: "place",
            typeKind: "point",
          },
        ],
        has_body: false,
        has_face: true,
        has_head: false,
        has_linked_body: false,
        has_presence: false,
        height: 100,
        media_kind: "image",
        mime_type: "image/jpeg",
        presence_evidence: false,
        width: 100,
      },
    ];
  };
  const repository = createCimmichRepository(sql);

  const assets = await repository.personAssets({
    limit: 100,
    personId: "person-1",
  });

  assert.deepEqual(assets[0].association_types, ["face"]);
  assert.deepEqual(assets[0].contexts, [
    {
      displayName: "Cedar House",
      entityId: "place-1",
      entityKind: "place",
      typeKind: "point",
    },
  ]);
  assert.match(statement, /associations AS MATERIALIZED/);
  assert.match(statement, /active_heads AS MATERIALIZED/);
  assert.match(statement, /FROM current_manual_head_tag/);
  assert.match(statement, /FROM current_context_asset context_link/);
  assert.match(statement, /cimmich_visibility_context_entity_rank/);
  assert.match(
    statement,
    /ORDER BY entity\.entity_kind, lower\(entity\.display_name\), entity\.entity_id/,
  );
  assert.doesNotMatch(statement, /FROM person_assets/);
  assert.doesNotMatch(statement, /FROM asset_people/);
  assert.doesNotMatch(statement, /FROM current_reference_gallery/);
});

test("Person asset pages return an opaque subject-bound continuation", async () => {
  const rows = ["asset-1", "asset-2", "asset-3"].map((assetId, index) => ({
    asset_head_evidence: false,
    asset_id: assetId,
    capture_time: new Date(Date.UTC(2026, 0, 3 - index)),
    contexts: [],
    has_body: false,
    has_face: true,
    has_head: false,
    has_linked_body: false,
    has_presence: false,
    height: 100,
    media_kind: "image",
    mime_type: "image/jpeg",
    presence_evidence: false,
    width: 100,
  }));
  const sql = async () => rows;
  const repository = createCimmichRepository(sql);

  const page = await repository.personAssets({
    pageSize: 2,
    personId: "person-1",
  });

  assert.equal(page.schemaVersion, "cimmich.person-projection-page.v1");
  assert.equal(page.items.length, 2);
  assert.equal(page.pageSize, 2);
  assert.ok(page.nextCursor);
  await assert.rejects(
    repository.personAssets({
      cursor: page.nextCursor,
      pageSize: 2,
      personId: "person-2",
    }),
    (error) => error.code === "PERSON_PAGE_CURSOR_INVALID",
  );
});

test("Identity pages limit accepted faces before per-face enrichment", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("?");
    return [
      {
        asset_id: "asset-1",
        buckets: [],
        capture_contexts: [],
        capture_time: new Date("2026-01-03T00:00:00.000Z"),
        face_id: "face-1",
        modifier_proposals: [],
        modifiers: [],
        quality_measurements: { quality_score: 0.9 },
      },
      {
        asset_id: "asset-2",
        buckets: [],
        capture_contexts: [],
        capture_time: new Date("2026-01-02T00:00:00.000Z"),
        face_id: "face-2",
        modifier_proposals: [],
        modifiers: [],
        quality_measurements: { quality_score: 0.8 },
      },
    ];
  };
  const repository = createCimmichRepository(sql);

  const page = await repository.identityFaces({
    pageSize: 1,
    personId: "person-1",
  });

  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  assert.match(statement, /page_faces AS MATERIALIZED/);
  assert.ok(
    statement.indexOf("LIMIT") < statement.indexOf("LEFT JOIN LATERAL"),
    "Page limit must precede per-face enrichment",
  );
  assert.match(statement, /cimmich_visibility_asset_rank/);
});

test("Holding match batches are Person-scoped, ordered and concurrency-bounded", async () => {
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("current_person_category"))
      return [{ holding: true }];
    if (statement.includes("SELECT identity.face_id")) {
      return Array.from({ length: 6 }, (_, index) => ({
        face_id: `face-${index + 1}`,
      }));
    }
    throw new Error("Unexpected SQL");
  };
  const repository = createCimmichRepository(sql);
  let active = 0;
  let maximumActive = 0;
  repository.faceMatches = async ({ faceId, limit }) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    active -= 1;
    return [{ faceId, limit }];
  };
  const faceIds = Array.from({ length: 6 }, (_, index) => `face-${index + 1}`);

  const result = await repository.faceMatchesBatch({
    faceIds,
    limitPerFace: 1,
    personId: "person-holding",
  });

  assert.equal(result.schemaVersion, "cimmich.person-holding-match-batch.v1");
  assert.deepEqual(
    result.items.map((item) => item.faceId),
    faceIds,
  );
  assert.equal(maximumActive, 4);
  assert.equal(result.requestedCount, 6);
});

test("Holding match batches reject ordinary People before face lookup", async () => {
  const sql = async () => [{ holding: false }];
  const repository = createCimmichRepository(sql);

  await assert.rejects(
    repository.faceMatchesBatch({
      faceIds: ["face-1"],
      limitPerFace: 1,
      personId: "person-ordinary",
    }),
    (error) => error.code === "PERSON_HOLDING_REQUIRED",
  );
});

test("single-face matching gates the query asset at the current visibility rank", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("?");
    return [];
  };
  const repository = createCimmichRepository(sql, new Map(), {
    currentRank: () => 1,
  });

  assert.deepEqual(
    await repository.faceMatches({ faceId: "face-1", limit: 3 }),
    [],
  );
  assert.match(statement, /JOIN asset query_asset/);
  assert.match(statement, /query_asset\.state = 'active'/);
  assert.match(
    statement,
    /cimmich_visibility_asset_rank\(query_asset\.asset_id\) <=/,
  );
});

test("owner Face review comparisons are visible same-space evidence without SourcePack authority", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("?");
    return [
      {
        accepted_example_count: 3,
        current_identity: true,
        display_name: "Current owner label",
        person_id: "person-current",
        prime_score: 0.8125,
        rank: 2,
        score_kind: "cosine_similarity",
        similarity: 0.8125,
      },
      {
        accepted_example_count: 2,
        current_identity: false,
        display_name: "Second scored owner",
        person_id: "person-second",
        prime_score: 0.7125,
        rank: 2,
        score_kind: "cosine_similarity",
        similarity: 0.7125,
        unavailable_reason: null,
      },
      {
        accepted_example_count: 0,
        current_identity: false,
        display_name: "Visible without admitted reference",
        person_id: "person-unavailable",
        prime_score: null,
        rank: 3,
        score_kind: null,
        similarity: null,
        unavailable_reason: "no_independent_compatible_reference_face",
      },
    ];
  };
  const repository = createCimmichRepository(sql, new Map(), {
    currentRank: () => 1,
  });

  const result = await repository.faceReviewComparisons({
    faceId: "face-query",
    limit: 99,
  });

  assert.equal(
    result.schemaVersion,
    "cimmich.face-owner-review-comparisons.v1",
  );
  assert.equal(result.reviewOnly, true);
  assert.equal(result.evidenceKind, "accepted_owner_faces");
  assert.equal(result.matchingLibrary, "accepted_reference_faces");
  assert.equal(result.bulkAutomationAuthority, "none");
  assert.equal(result.emptyReason, null);
  assert.equal(result.automaticIdentityAuthority, "none");
  assert.equal(result.items[0].current_identity, true);
  assert.equal(result.items[0].score_kind, "cosine_similarity");
  assert.equal(result.items[2].similarity, null);
  assert.equal(result.items[2].prime_score, null);
  assert.equal(result.items[2].score_kind, null);
  assert.equal(
    result.items[2].unavailable_reason,
    "no_independent_compatible_reference_face",
  );
  assert.match(statement, /reference\.model_family = query\.model_family/);
  assert.match(statement, /reference\.model_version = query\.model_version/);
  assert.match(statement, /reference\.config_digest = query\.config_digest/);
  assert.match(statement, /reference\.dimension = query\.dimension/);
  assert.match(statement, /reference\.face_id <> query\.face_id/);
  assert.match(statement, /reference_face\.asset_id <> query\.asset_id/);
  assert.match(statement, /current_face_capture_context/);
  assert.match(statement, /identity\.state = 'accepted'/);
  assert.match(statement, /no_independent_compatible_reference_face/);
  assert.match(statement, /visible_people AS MATERIALIZED/);
  assert.match(
    statement,
    /LEFT JOIN best_per_person best ON best\.person_id = person\.person_id/,
  );
  assert.match(statement, /similarity DESC NULLS LAST/);
  assert.match(statement, /SELECT count\(\*\) FROM visible_people/);
  assert.match(
    statement,
    /cimmich_visibility_asset_rank\(reference_asset\.asset_id\)/,
  );
  assert.match(
    statement,
    /cimmich_visibility_person_rank\(person\.person_id\)/,
  );
  assert.match(statement, /LIMIT greatest\(/);
  assert.doesNotMatch(statement, /matching_gallery/);
  assert.doesNotMatch(statement, /source_pack/i);
});

test("owner Face review comparisons keep all visible People while withholding unavailable evidence detail", async () => {
  const standardRows = [
    ["person-alex", "Alex", 0.91, true],
    ["person-maya", "Maya", 0.83, false],
    ["person-samira", "Samira", 0.77, false],
    ["person-theo", "Theo", 0.69, false],
    ["person-eli", "Eli", null, false],
    ["person-nora", "Nora", null, false],
  ].map(([person_id, display_name, similarity, current_identity], index) => ({
    accepted_example_count: similarity === null ? 0 : 1,
    current_identity,
    display_name,
    person_id,
    prime_score: similarity,
    rank: index + 1,
    score_kind: similarity === null ? null : "cosine_similarity",
    similarity,
    unavailable_reason:
      similarity === null ? "no_independent_compatible_reference_face" : null,
  }));
  const personalRows = standardRows.map((row, index) => ({
    ...row,
    accepted_example_count: 1,
    prime_score: 0.9 - index * 0.05,
    score_kind: "cosine_similarity",
    similarity: 0.9 - index * 0.05,
    unavailable_reason: null,
  }));
  let rows = standardRows;
  const repository = createCimmichRepository(async () => rows, new Map(), {
    currentRank: () => 1,
  });

  const standard = await repository.faceReviewComparisons({
    faceId: "face-cha-023",
    limit: 5,
  });
  assert.equal(standard.items.length, 6);
  assert.equal(
    standard.items.filter((row) => row.similarity !== null).length,
    4,
  );
  assert.equal(
    standard.items.filter((row) => row.similarity === null).length,
    2,
  );
  assert.equal(
    new Set(standard.items.map((row) => row.person_id)).size,
    standard.items.length,
  );
  assert.deepEqual(
    standard.items.slice(-2).map((row) => row.unavailable_reason),
    [
      "no_independent_compatible_reference_face",
      "no_independent_compatible_reference_face",
    ],
  );
  assert.equal(standard.items.filter((row) => row.current_identity).length, 1);

  rows = personalRows;
  const personal = await repository.faceReviewComparisons({
    faceId: "face-cha-023",
    limit: 5,
  });
  assert.equal(personal.items.length, 6);
  assert.equal(
    personal.items.every((row) => row.similarity !== null),
    true,
  );
  assert.equal(
    personal.items.every((row) => row.unavailable_reason === null),
    true,
  );

  rows = personalRows.map((row) => ({ ...row, current_identity: false }));
  for (const faceId of [
    "face-cha-051-stranger-one",
    "face-cha-051-stranger-two",
  ]) {
    const stranger = await repository.faceReviewComparisons({
      faceId,
      limit: 5,
    });
    assert.equal(stranger.items.length, 6);
    assert.equal(
      stranger.items.every((row) => row.similarity !== null),
      true,
    );
    assert.equal(
      stranger.items.some((row) => row.current_identity),
      false,
    );
  }
});

test("owner Face review comparisons explain a genuinely empty compatible library", async () => {
  const repository = createCimmichRepository(async () => []);
  const result = await repository.faceReviewComparisons({
    faceId: "face-without-compatible-references",
  });

  assert.deepEqual(result.items, []);
  assert.equal(result.emptyReason, "no_compatible_accepted_reference_faces");
  assert.equal(result.reviewOnly, true);
  assert.equal(result.automaticIdentityAuthority, "none");
});

test("owner Face review comparison does not change the governed Prime matcher", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const governedStart = source.indexOf(
    "async faceMatches({ faceId, limit = 5 })",
  );
  const reviewStart = source.indexOf(
    "async faceReviewComparisons",
    governedStart,
  );
  const governedSource = source.slice(governedStart, reviewStart);

  assert.match(governedSource, /JOIN matching_gallery gallery/);
  assert.match(governedSource, /gallery\.bucket_kind = 'prime'/);
  assert.match(
    governedSource,
    /gallery\.person_id IS DISTINCT FROM query\.current_person_id/,
  );
});

test("Holding Prime retirement is one atomic SQL statement", async () => {
  // The maintenance helper is exercised indirectly by command methods in SQL
  // acceptance; this source assertion prevents reintroducing split retirement.
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /WITH retired_buckets AS/);
  assert.doesNotMatch(
    source,
    /await sql`UPDATE reference_bucket[\s\S]{0,250}await sql`UPDATE reference_prototype/,
  );
});
