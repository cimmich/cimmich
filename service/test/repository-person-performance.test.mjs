import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";
import { createFragmentAwareSql } from "./fixtures/fragment-aware-sql.mjs";

test("Person candidate summary retains review claims from a retired passed SourcePack", async () => {
  let statement = "";
  let boundValues = [];
  const sql = async (strings, ...values) => {
    statement = strings.join("?");
    boundValues = values;
    return [
      {
        asset_count: 3,
        best_margin: 0.42,
        best_score: 0.81,
        display_name: "Maya Chen",
        person_id: "person-maya",
        suggestion_count: 4,
      },
      {
        asset_count: 2,
        best_margin: 0.31,
        best_score: 0.72,
        display_name: "Noah Chen",
        person_id: "person-noah",
        suggestion_count: 2,
      },
    ];
  };
  const repository = createCimmichRepository(sql);

  const summary = await repository.personCandidateSummary();

  assert.deepEqual(summary, {
    items: [
      {
        assetCount: 3,
        bestMargin: 0.42,
        bestScore: 0.81,
        displayName: "Maya Chen",
        personId: "person-maya",
        suggestionCount: 4,
      },
      {
        assetCount: 2,
        bestMargin: 0.31,
        bestScore: 0.72,
        displayName: "Noah Chen",
        personId: "person-noah",
        suggestionCount: 2,
      },
    ],
    schemaVersion: "cimmich.person-candidate-summary.v2",
    totalCandidates: 6,
    totalPeople: 2,
  });
  assert.match(statement, /JOIN source_pack pack/);
  assert.match(statement, /pack\.state IN \('active', 'retired'\)/);
  assert.doesNotMatch(statement, /JOIN current_source_pack pack/);
  assert.match(statement, /cimmich_person_candidate_reviewable/);
  assert.match(statement, /claim\.state = 'candidate'/);
  assert.match(statement, /cimmich_face_match_eligible/);
  assert.match(statement, /face_review_unknown/);
  assert.match(statement, /algorithm_version = \?/);
  assert.ok(boundValues.includes("cimmich-possible-people-graph-v2"));
  assert.match(statement, /accepted_physical_people AS MATERIALIZED/);
  assert.match(statement, /decided_physical_faces AS MATERIALIZED/);
  assert.match(statement, /face_suggestions AS MATERIALIZED/);
  assert.match(statement, /GROUP BY claim\.person_id, person\.display_name/);
  assert.match(
    statement,
    /face\.face_id = candidate_physical\.canonical_face_id/,
  );
  assert.match(
    statement,
    /accepted_same_person\.physical_face_id = candidate_physical\.physical_face_id/,
  );
  assert.match(
    statement,
    /count\(DISTINCT grouped_physical\.physical_face_id\)/,
  );
  assert.match(
    statement,
    /decided\.physical_face_id = grouped_physical\.physical_face_id/,
  );
  assert.doesNotMatch(statement, /identity_audit/);
});

test("Person candidate summary cannot revive a retired Possible-people graph", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../src/person-candidate-summary.mjs", import.meta.url),
      "utf8",
    ),
  );

  assert.match(
    source,
    /state = 'completed' AND classification_state = 'completed'\s+AND algorithm_version = \$\{possiblePeopleContract\.algorithmVersion\}/,
  );
  assert.doesNotMatch(source, /WHERE decided\.face_id = member\.face_id/);
});

test("Person candidate detail and acceptance retain the same passed-pack review boundary", async () => {
  const { readFile } = await import("node:fs/promises");
  const [source, acceptanceSource] = await Promise.all([
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../src/bulk-person-candidate-accept.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  const slices = [
    source.slice(
      source.indexOf("async personCandidates"),
      source.indexOf("bulkAcceptPersonCandidates,"),
    ),
    acceptanceSource,
  ];
  for (const method of slices) {
    assert.match(method, /JOIN source_pack pack/);
    assert.match(method, /pack\.state IN \('active', 'retired'\)/);
    assert.match(method, /pack\.evaluation_status = 'passed'/);
    assert.doesNotMatch(method, /JOIN current_source_pack pack/);
  }
});

test("Person candidate same-photo counts are projected once instead of rescanning current identity per candidate", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const method = source.slice(
    source.indexOf("async personCandidates"),
    source.indexOf("bulkAcceptPersonCandidates,"),
  );

  assert.match(method, /WITH accepted_asset_counts AS MATERIALIZED/);
  assert.match(method, /GROUP BY accepted_face\.asset_id/);
  assert.match(method, /accepted_asset_count_map AS MATERIALIZED/);
  assert.match(method, /jsonb_object_agg\(asset_id, accepted_count\)/);
  assert.match(method, /CROSS JOIN accepted_asset_count_map accepted_counts/);
  assert.doesNotMatch(method, /LEFT JOIN accepted_asset_counts same_photo/);
  assert.doesNotMatch(method, /FROM current_face_identity same_photo_identity/);
});

test("Person candidate current assignments and owner review decisions are projected once", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const method = source.slice(
    source.indexOf("async personCandidates"),
    source.indexOf("bulkAcceptPersonCandidates,"),
  );

  assert.match(method, /current_acceptance AS MATERIALIZED/);
  assert.match(method, /latest_face_review AS MATERIALIZED/);
  assert.match(method, /LEFT JOIN current_acceptance accepted/);
  assert.match(method, /LEFT JOIN latest_face_review review/);
  assert.doesNotMatch(method, /LEFT JOIN LATERAL/);
  assert.doesNotMatch(method, /coalesce\(\(SELECT review\.reason_code/);
});

test("candidate reads resolve canonical Face geometry by indexed Face ID", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const methods = [
    source.slice(
      source.indexOf("async identityCandidates"),
      source.indexOf("async personCandidates"),
    ),
    source.slice(
      source.indexOf("async personCandidates"),
      source.indexOf("bulkAcceptPersonCandidates,"),
    ),
  ];

  for (const method of methods) {
    assert.match(
      method,
      /JOIN face_observation (?:fo|face)\s+ON (?:fo|face)\.face_id = candidate_physical\.canonical_face_id/,
    );
    assert.doesNotMatch(
      method,
      /JOIN current_display_face (?:fo|face)\s+ON (?:fo|face)\.physical_face_id = candidate_physical\.physical_face_id/,
    );
  }
});

test("candidate reads materialize accepted physical identities once", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const identityCandidates = source.slice(
    source.indexOf("async identityCandidates"),
    source.indexOf("async personCandidates"),
  );
  const personCandidates = source.slice(
    source.indexOf("async personCandidates"),
    source.indexOf("bulkAcceptPersonCandidates,"),
  );

  assert.match(identityCandidates, /accepted_physical_people AS MATERIALIZED/);
  assert.match(personCandidates, /accepted_physical_claims AS MATERIALIZED/);
  assert.doesNotMatch(
    identityCandidates,
    /FROM current_face_physical_member accepted_physical\s+JOIN identity_claim accepted/,
  );
  assert.doesNotMatch(
    personCandidates,
    /JOIN current_face_physical_member current_physical/,
  );
});

test("Person candidate reads honor a current owner Unknown decision", async () => {
  const { readFile } = await import("node:fs/promises");
  const [source, summarySource] = await Promise.all([
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../src/person-candidate-summary.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  const slices = [
    source.slice(
      source.indexOf("async identityCandidates"),
      source.indexOf("async personCandidates"),
    ),
    source.slice(
      source.indexOf("async personCandidates"),
      source.indexOf("bulkAcceptPersonCandidates,"),
    ),
    summarySource,
  ];
  for (const method of slices) {
    assert.match(method, /subject_type = 'face_review'/);
    assert.match(method, /face_review_unknown/);
    assert.match(
      method,
      /ORDER BY (?:review\.subject_id,\s+)?review\.created_at DESC, review\.decision_id DESC/,
    );
  }
});

test("People project ordinary accepted Faces and accepted Body regions without matching authority", async () => {
  let statement = "";
  const sql = createFragmentAwareSql(
    (text) => {
      statement = text;
    },
    [
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
    ],
  );
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
  // Asset visibility is enforced through the one materialized hidden-asset
  // set, never through per-row rank function calls.
  assert.match(statement, /hidden_assets AS MATERIALIZED/);
  assert.match(
    statement,
    /NOT EXISTS \(\s+SELECT 1 FROM hidden_assets hidden\s+WHERE hidden\.object_id = observation\.asset_id\s+\)/,
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
  // Asset visibility runs through the materialized hidden-asset set, not
  // per-row rank function calls.
  assert.match(statement, /hidden_assets AS MATERIALIZED/);
  assert.match(
    statement,
    /NOT EXISTS \(\s+SELECT 1 FROM hidden_assets hidden\s+WHERE hidden\.object_id = body\.asset_id\s+\)/,
  );
  assert.doesNotMatch(statement, /cimmich_visibility_asset_rank\(/);
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
  const validation = statements.find(({ statement }) =>
    statement.includes("FROM current_face_identity"),
  );
  assert.match(validation.statement, /source\.state = 'active'/);
  assert.match(
    validation.statement,
    /cimmich_visibility_asset_rank\(face\.asset_id\) <=/,
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
        has_body_candidate: false,
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
  assert.match(statement, /active_face_buckets AS MATERIALIZED/);
  assert.match(statement, /same_person_detector_faces AS MATERIALIZED/);
  assert.match(statement, /same_photo_usable_face_assets AS MATERIALIZED/);
  assert.match(statement, /body_interest_exports AS MATERIALIZED/);
  assert.match(statement, /usable_face_exports AS MATERIALIZED/);
  assert.match(statement, /body\.content_hash = face\.content_hash/);
  assert.match(statement, /body\.filename = face\.filename/);
  assert.match(statement, /body_hint\.face_id IS NULL/);
  assert.match(statement, /FROM current_manual_head_tag/);
  assert.match(statement, /FROM imported_identity_locator locator/);
  assert.match(statement, /locator\.state = 'unresolved'/);
  assert.match(
    statement,
    /locator\.resolution_kind = 'stronger_existing_truth'/,
  );
  assert.match(statement, /'body_hint_face'::text/);
  assert.match(statement, /effective_gallery_permission/);
  assert.match(statement, /detected_identity\.origin <> 'trusted_import'/);
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

test("Asset display recovery prefers a newer same-photo projection", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statements.length === 1) {
      return [
        {
          asset_id: "asset-stale",
          asset_state: "active",
          filename: "photo.jpg",
          projection_state: "active",
          source_asset_id: "source-stale",
        },
      ];
    }
    return [
      {
        asset_id: "asset-current",
        filename: "photo.jpg",
        source_asset_id: "source-current",
      },
    ];
  };
  const repository = createCimmichRepository(sql);

  assert.deepEqual(
    await repository.assetDisplay({ sourceAssetId: "source-stale" }),
    {
      assetId: "asset-current",
      filename: "photo.jpg",
      schemaVersion: "cimmich.asset-display.v1",
      sourceAssetId: "source-current",
    },
  );
  assert.match(
    statements[1],
    /candidate_projection\.last_seen_at[\s\S]*> requested_projection\.last_seen_at/,
  );
  assert.match(
    statements[1],
    /requested_asset\.content_hash = candidate_asset\.content_hash/,
  );
  assert.match(
    statements[1],
    /lower\(requested_projection\.original_file_name\)[\s\S]*lower\(candidate_projection\.original_file_name\)/,
  );
});

test("Asset display recovery resolves a retired source projection through a newer equivalent", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statements.length === 1) {
      return [
        {
          asset_id: "asset-retired",
          asset_state: "missing",
          filename: "photo.jpg",
          projection_state: "missing",
          source_asset_id: "source-retired",
        },
      ];
    }
    return [
      {
        asset_id: "asset-current",
        filename: "photo.jpg",
        source_asset_id: "source-current",
      },
    ];
  };
  const repository = createCimmichRepository(sql);

  assert.deepEqual(
    await repository.assetDisplay({ sourceAssetId: "source-retired" }),
    {
      assetId: "asset-current",
      filename: "photo.jpg",
      schemaVersion: "cimmich.asset-display.v1",
      sourceAssetId: "source-current",
    },
  );
  assert.doesNotMatch(statements[0], /WHERE projection\.state = 'active'/);
  assert.doesNotMatch(statements[1], /requested_projection\.state = 'active'/);
});

test("legacy Body-lane imports project as placement candidates rather than Presence", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("?");
    return [
      {
        asset_head_evidence: false,
        asset_id: "asset-body-candidate",
        capture_time: null,
        contexts: [],
        has_body: false,
        has_body_candidate: true,
        has_face: false,
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

  assert.deepEqual(assets[0].association_types, ["body_candidate"]);
  assert.match(statement, /legacy_non_gallery_person_presence/);
  assert.match(statement, /legacy_body_placement_pending/);
});

test("Person assets keep face-linked geometry out of standalone Body and Presence", async () => {
  const sql = async () => [
    {
      asset_head_evidence: false,
      asset_id: "asset-multi-role",
      capture_time: null,
      contexts: [],
      has_body: false,
      has_body_candidate: true,
      has_face: true,
      has_head: false,
      has_linked_body: true,
      has_presence: true,
      height: 100,
      media_kind: "image",
      mime_type: "image/jpeg",
      presence_evidence: true,
      width: 100,
    },
  ];
  const repository = createCimmichRepository(sql);

  const assets = await repository.personAssets({
    limit: 100,
    personId: "person-1",
  });

  assert.deepEqual(assets[0].association_types, ["face"]);
});

test("Person asset pages return an opaque subject-bound continuation", async () => {
  const rows = ["asset-1", "asset-2", "asset-3"].map((assetId, index) => ({
    asset_head_evidence: false,
    asset_id: assetId,
    capture_time: new Date(Date.UTC(2026, 0, 3 - index)),
    contexts: [],
    has_body: false,
    has_body_candidate: false,
    has_face: true,
    has_head: false,
    has_linked_body: false,
    has_presence: false,
    height: 100,
    media_kind: "image",
    mime_type: "image/jpeg",
    presence_evidence: false,
    body_candidate_count: 7,
    confirmed_body_count: 41,
    presence_count: 3,
    total_count: 51,
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
  assert.deepEqual(page.summary, {
    body: 41,
    bodyCandidate: 7,
    presence: 3,
    total: 51,
  });
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

test("Person Body pages bind their filter into the cursor scope", async () => {
  const rows = ["asset-1", "asset-2"].map((assetId, index) => ({
    asset_head_evidence: false,
    asset_id: assetId,
    body_candidate_count: 1,
    capture_time: new Date(Date.UTC(2026, 0, 2 - index)),
    confirmed_body_count: 2,
    contexts: [],
    has_body: true,
    has_body_candidate: false,
    has_face: false,
    has_head: false,
    has_linked_body: false,
    has_presence: false,
    height: 100,
    media_kind: "image",
    mime_type: "image/jpeg",
    presence_count: 0,
    presence_evidence: false,
    total_count: 3,
    width: 100,
  }));
  const sql = async () => rows;
  const repository = createCimmichRepository(sql);

  const page = await repository.personAssets({
    associationType: "body",
    pageSize: 1,
    personId: "person-1",
  });

  assert.deepEqual(page.items[0].association_types, ["body"]);
  assert.deepEqual(page.summary, {
    body: 2,
    bodyCandidate: 1,
    presence: 0,
    total: 3,
  });
  await assert.rejects(
    repository.personAssets({
      associationType: "presence",
      cursor: page.nextCursor,
      pageSize: 1,
      personId: "person-1",
    }),
    (error) => error.code === "PERSON_PAGE_CURSOR_INVALID",
  );
  await assert.rejects(
    repository.personAssets({
      associationType: "face",
      pageSize: 1,
      personId: "person-1",
    }),
    (error) => error.code === "PERSON_ASSET_ASSOCIATION_INVALID",
  );
});

test("Identity pages limit accepted faces before per-face enrichment", async () => {
  let statement = "";
  const sql = async (strings) => {
    const currentStatement = strings.join("?");
    statement = currentStatement;
    if (currentStatement.includes("AS all_count")) {
      return [
        {
          all_count: 2,
          head_count: 0,
          low_quality_count: 0,
          prime_count: 1,
          secondary_count: 1,
        },
      ];
    }
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
    bucketKind: "head",
    pageSize: 1,
    personId: "person-1",
  });

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].main_evidence_tier, "secondary");
  assert.equal(page.items[0].matching_reference_tier, null);
  assert.deepEqual(page.summary, {
    all: 2,
    head: 0,
    lowQuality: 0,
    prime: 1,
    secondary: 1,
  });
  assert.ok(page.nextCursor);
  assert.match(statement, /page_faces AS MATERIALIZED/);
  assert.ok(
    statement.indexOf("LIMIT") < statement.indexOf("LEFT JOIN LATERAL"),
    "Page limit must precede per-face enrichment",
  );
  assert.match(statement, /cimmich_visibility_asset_rank/);
  assert.match(statement, /filtered_gallery\.bucket_kind =/);
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
  assert.match(statement, /cimmich_face_match_eligible/);
  assert.match(statement, /FROM current_source_pack pack/);
  assert.match(statement, /governed_candidate/);
  assert.match(
    statement,
    /cimmich_visibility_asset_rank\(query_asset\.asset_id\) <=/,
  );
});

test("owner Face review comparisons are visible same-space evidence without SourcePack authority", async () => {
  let statement = "";
  let parameters = [];
  const sql = async (strings, ...values) => {
    statement = strings.join("?");
    parameters = values;
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
  assert.match(statement, /LIMIT \?/);
  assert.doesNotMatch(statement, /LIMIT greatest/);
  assert.match(statement, /reference\.model_family = query\.model_family/);
  assert.match(statement, /reference\.model_version = query\.model_version/);
  assert.match(statement, /reference\.config_digest = query\.config_digest/);
  assert.match(statement, /reference\.dimension = query\.dimension/);
  assert.match(statement, /reference\.face_id <> query\.face_id/);
  assert.match(statement, /reference_face\.asset_id <> query\.asset_id/);
  assert.match(statement, /cimmich_face_match_eligible\(/);
  assert.match(statement, /query_contexts AS MATERIALIZED/);
  assert.match(statement, /current_capture_context_member/);
  assert.doesNotMatch(statement, /current_face_capture_context/);
  assert.match(statement, /identity\.state = 'accepted'/);
  assert.match(statement, /JOIN identity_claim identity/);
  assert.doesNotMatch(statement, /current_face_identity/);
  assert.match(statement, /no_independent_compatible_reference_face/);
  assert.match(statement, /visible_people AS MATERIALIZED/);
  assert.match(
    statement,
    /LEFT JOIN best_per_person best ON best\.person_id = person\.person_id/,
  );
  assert.match(statement, /similarity DESC NULLS LAST/);
  assert.equal(parameters.at(-1), 12);
  // Asset and person visibility run through the materialized hidden sets;
  // per-row rank calls multiplied the accepted-reference walk.
  assert.match(statement, /hidden_assets AS MATERIALIZED/);
  assert.match(statement, /hidden_people AS MATERIALIZED/);
  assert.match(statement, /candidate_spaces AS MATERIALIZED/);
  assert.match(statement, /space_reference_counts AS MATERIALIZED/);
  assert.match(
    statement,
    /count\(DISTINCT identity\.person_id\)::int AS accepted_person_count/,
  );
  assert.match(
    statement,
    /ORDER BY coalesce\(reference_count\.accepted_person_count, 0\) DESC/,
  );
  assert.doesNotMatch(
    statement,
    /ORDER BY \(\s+SELECT count\(DISTINCT identity\.person_id\)/,
  );
  assert.match(
    statement,
    /NOT EXISTS \(\s+SELECT 1 FROM hidden_assets hidden\s+WHERE hidden\.object_id = reference_asset\.asset_id\s+\)/,
  );
  assert.match(
    statement,
    /NOT EXISTS \(\s+SELECT 1 FROM hidden_people hidden\s+WHERE hidden\.object_id = person\.person_id\s+\)/,
  );
  assert.doesNotMatch(statement, /cimmich_visibility_asset_rank\(/);
  assert.doesNotMatch(statement, /cimmich_visibility_person_rank\(/);
  assert.doesNotMatch(statement, /matching_gallery/);
  assert.doesNotMatch(statement, /source_pack/i);
});

test("owner Face review comparisons bound visible People while withholding unavailable evidence detail", async () => {
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
  const repository = createCimmichRepository(
    async (_strings, ...parameters) => rows.slice(0, Number(parameters.at(-1))),
    new Map(),
    {
      currentRank: () => 1,
    },
  );

  const standard = await repository.faceReviewComparisons({
    faceId: "face-cha-023",
    limit: 5,
  });
  assert.equal(standard.items.length, 5);
  assert.equal(
    standard.items.filter((row) => row.similarity !== null).length,
    4,
  );
  assert.equal(
    standard.items.filter((row) => row.similarity === null).length,
    1,
  );
  assert.equal(
    new Set(standard.items.map((row) => row.person_id)).size,
    standard.items.length,
  );
  assert.deepEqual(
    standard.items.slice(-1).map((row) => row.unavailable_reason),
    ["no_independent_compatible_reference_face"],
  );
  assert.equal(standard.items.filter((row) => row.current_identity).length, 1);

  rows = personalRows;
  const personal = await repository.faceReviewComparisons({
    faceId: "face-cha-023",
    limit: 5,
  });
  assert.equal(personal.items.length, 5);
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
    assert.equal(stranger.items.length, 5);
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
  const governedSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../src/face-match-repository.mjs", import.meta.url),
      "utf8",
    ),
  );

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
    readFile(
      new URL("../src/repository-maintenance.mjs", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /WITH retired_buckets AS/);
  assert.doesNotMatch(
    source,
    /await sql`UPDATE reference_bucket[\s\S]{0,250}await sql`UPDATE reference_prototype/,
  );
});

test("personPresentation automatic slots use the narrow representative query, not the person() dossier", async () => {
  const statements = [];
  const sql = async (strings) => {
    const text = strings.join("?");
    statements.push(text);
    if (text.includes("representative AS MATERIALIZED")) {
      return [
        {
          body_preview_asset_id: "asset-body",
          body_preview_body_id: "body-1",
          body_preview_box_h: 0.7,
          body_preview_box_w: 0.5,
          body_preview_box_x: 0.05,
          body_preview_box_y: 0.1,
          body_preview_height: 1500,
          body_preview_width: 2000,
          box_h: 0.4,
          box_w: 0.3,
          box_x: 0.1,
          box_y: 0.2,
          height: 3000,
          person_id: "person-1",
          representative_asset_id: "asset-rep",
          representative_face_id: "face-1",
          width: 4000,
        },
      ];
    }
    if (text.includes("cimmich_visibility_subject_rank")) {
      return [{ person_id: "person-1", subject_kind: "person" }];
    }
    if (text.includes("FROM person_presentation_media")) return [];
    throw new Error(`Unexpected statement: ${text.slice(0, 120)}`);
  };
  const bridge = new Map([
    ["asset-body", { filename: "body.jpg", sourceAssetId: "immich-body" }],
    ["asset-rep", { filename: "rep.jpg", sourceAssetId: "immich-rep" }],
  ]);
  const repository = createCimmichRepository(sql, bridge);

  const presentation = await repository.personPresentation({
    personId: "person-1",
  });

  assert.equal(presentation.face.assetId, "asset-rep");
  assert.equal(presentation.face.selectionMode, "automatic");
  assert.equal(presentation.face.observationId, "face-1");
  assert.equal(presentation.hero.assetId, "asset-rep");
  assert.equal(presentation.hero.crop, null);
  assert.equal(presentation.body.assetId, "asset-body");
  assert.equal(presentation.body.observationId, "body-1");
  // Same automatic slots as before, but priced without the dossier CTEs.
  for (const text of statements) {
    assert.doesNotMatch(text, /photo_history/);
    assert.doesNotMatch(text, /person_categories/);
    assert.doesNotMatch(text, /accepted_assets/);
    assert.doesNotMatch(text, /candidate_faces/);
  }
});

test("pet presentation paths gate on the narrow pet cover lookup, not the pet() projection", async () => {
  const statements = [];
  const sql = async (strings) => {
    const text = strings.join("?");
    statements.push(text);
    if (text.includes("cimmich_visibility_pet_rank")) {
      return [{ cover_asset_id: null, cover_crop: null, person_id: "pet-1" }];
    }
    if (text.includes("cimmich_visibility_subject_rank")) {
      return [{ person_id: "pet-1", subject_kind: "pet" }];
    }
    if (text.includes("FROM person_presentation_media")) {
      return ["face", "hero"].map((slot) => ({
        asset_id: "asset-pet",
        crop: null,
        height: 1200,
        observation_id: null,
        observation_kind: "presence",
        slot_kind: slot,
        updated_at: "2026-07-24T00:00:00.000Z",
        width: 1800,
      }));
    }
    if (text.includes("representative AS MATERIALIZED")) {
      return [
        {
          body_preview_asset_id: null,
          body_preview_body_id: null,
          person_id: "pet-1",
          representative_asset_id: null,
          representative_face_id: null,
        },
      ];
    }
    throw new Error(`Unexpected statement: ${text.slice(0, 120)}`);
  };
  const bridge = new Map([
    ["asset-pet", { filename: "pet.jpg", sourceAssetId: "immich-pet" }],
  ]);
  const repository = createCimmichRepository(sql, bridge);

  const presentation = await repository.petPresentation({ petId: "pet-1" });

  assert.equal(presentation.face.assetId, "asset-pet");
  assert.equal(presentation.hero.assetId, "asset-pet");
  assert.equal(presentation.body, null);
  // The presentation gate must not price the pet list projection.
  for (const text of statements) {
    assert.doesNotMatch(text, /person_assets/);
    assert.doesNotMatch(text, /current_pet_document/);
    assert.doesNotMatch(text, /confirmed_media_count/);
  }
});
