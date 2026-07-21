import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createManualSubjectTagStore } from "../src/manual-subject-tag.mjs";
import {
  buildPublicDemoPlan,
  digest,
  publicDemoSeedSchemaVersion,
} from "../src/public-demo-bootstrap.mjs";
import { loadMigrations } from "../src/migration-runner.mjs";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const requiredPath = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value)
    throw new Error("Public demo bootstrap configuration is incomplete");
  return path.resolve(value);
};
const archiveRoot = requiredPath("CIMMICH_DEMO_ARCHIVE_ROOT");
const mapPath = requiredPath("CIMMICH_DEMO_IMMICH_MAP_PATH");
const receiptPath = requiredPath("CIMMICH_DEMO_SEED_RECEIPT_PATH");
const bridgePath = requiredPath("CIMMICH_DEMO_DISPLAY_BRIDGE_PATH");

if (!databaseUrl) {
  throw new Error("Public demo seed configuration is incomplete");
}

const manifestCsv = await readFile(
  path.join(archiveRoot, "provenance", "manifest.csv"),
  "utf8",
);
const shotLedgerCsv = await readFile(
  path.join(archiveRoot, "shot-ledger.csv"),
  "utf8",
);
const immichMap = JSON.parse(await readFile(mapPath, "utf8"));
const plan = buildPublicDemoPlan({ manifestCsv, shotLedgerCsv, immichMap });
const sql = postgres(databaseUrl, { max: 1 });
const serviceDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const migrations = await loadMigrations(
  path.resolve(
    process.env.CIMMICH_MIGRATIONS_DIRECTORY ||
      path.join(serviceDirectory, "../migrations"),
  ),
);
const expectedSchemaVersion = migrations.at(-1)?.version || 0;

const receiptId = "receipt_cimmich_public_demo_cedar_house_v1";
const sourceId = "cimmich-public-demo-cedar-house-v1";
const snapshotId = "snapshot_cimmich_public_demo_cedar_house_v1";
const runId = "immich_inventory_run_cimmich_public_demo_cedar_house_v1";
const hex32 = (value) => digest(value).slice(0, 32);
const stable = (prefix, value) => `${prefix}_${hex32(value)}`;
const decision = (scope) => stable("decision", `cedar-house:${scope}`);

const [schema] = await sql`
  SELECT coalesce(max(version), 0)::integer AS version
  FROM cimmich_schema_migration
`;
if (schema.version !== expectedSchemaVersion) {
  throw new Error(
    `Public demo requires current migration-ledger schema ${expectedSchemaVersion}, found ${schema.version}`,
  );
}
const [existing] = await sql`
  SELECT (SELECT count(*)::integer FROM asset) AS assets,
    (SELECT count(*)::integer FROM person) AS people,
    (SELECT count(*)::integer FROM context_entity) AS contexts,
    (SELECT count(*)::integer FROM cimmich_document) AS documents
`;
if (
  existing.assets ||
  existing.people ||
  existing.contexts ||
  existing.documents
) {
  throw new Error("Public demo bootstrap requires a fresh Cimmich database");
}

await sql.begin(async (tx) => {
  await tx`
    INSERT INTO source_snapshot (
      snapshot_id, input_schema_version, source_digest, locator_root_token,
      started_at, completed_at, declared_asset_count, observed_asset_count,
      state, privacy_class
    ) VALUES (
      ${snapshotId}, 'cimmich.public-demo-archive.v1', ${plan.seedDigest},
      'cedar-house-v1', now(), now(), 51, 51, 'complete', 'release-safe'
    )
  `;
  await tx`
    INSERT INTO producer_receipt (
      producer_receipt_id, producer_kind, producer_name, producer_version,
      config_digest, source_snapshot_id, started_at, completed_at,
      result_digest, privacy_class
    ) VALUES (
      ${receiptId}, 'trusted_import', 'cimmich-public-demo-bootstrap', 'v1',
      ${plan.seedDigest}, ${snapshotId}, now(), now(), ${plan.seedDigest},
      'release-safe'
    )
  `;
  await tx`
    INSERT INTO immich_inventory_source (
      source_id, principal_digest, companion_schema_version, immich_version,
      state, last_completed_run_id
    ) VALUES (
      ${sourceId}, ${plan.principalDigest}, 'cimmich.immich-companion.v1',
      ${plan.immichVersion}, 'active', NULL
    )
  `;
  await tx`
    INSERT INTO immich_inventory_run (
      run_id, source_id, snapshot_id, immich_version, principal_digest,
      state, observed_asset_count, page_count, completed_at, privacy_class
    ) VALUES (
      ${runId}, ${sourceId}, ${snapshotId}, ${plan.immichVersion},
      ${plan.principalDigest}, 'completed', 51, 1, now(), 'release-safe'
    )
  `;
  await tx`
    UPDATE immich_inventory_source SET last_completed_run_id = ${runId}
    WHERE source_id = ${sourceId}
  `;
  for (const visibility of ["timeline", "archive", "hidden", "locked"]) {
    await tx`
      INSERT INTO immich_inventory_lane (
        run_id, visibility, state, cursor, page_count, observed_item_count
      ) VALUES (
        ${runId}, ${visibility}, 'completed', '',
        ${visibility === "timeline" ? 1 : 0},
        ${visibility === "timeline" ? 51 : 0}
      )
    `;
  }

  for (const asset of plan.assets) {
    await tx`
      INSERT INTO asset (
        asset_id, content_hash, locator_token, media_kind, mime_type, width,
        height, capture_time, source_snapshot_id, state, privacy_class
      ) VALUES (
        ${asset.assetId}, ${asset.sha256}, ${`cedar-house:${asset.publicAssetId}`},
        'image', 'image/png', ${asset.width}, ${asset.height},
        ${asset.captureTime}, ${snapshotId}, 'active', 'release-safe'
      )
    `;
    await tx`
      INSERT INTO immich_asset_projection (
        source_id, immich_asset_id, cimmich_asset_id, owner_digest,
        input_revision, checksum, asset_type, visibility, original_mime_type,
        capture_time, source_updated_at, width, height, is_archived,
        is_favorite, is_offline, is_trashed, state, first_seen_run_id,
        last_seen_run_id, privacy_class
      ) VALUES (
        ${sourceId}, ${asset.immichAssetId}, ${asset.assetId},
        ${plan.principalDigest}, ${asset.inputRevision}, ${asset.sha256},
        'image', 'timeline', 'image/png', ${asset.captureTime},
        ${asset.sourceUpdatedAt}, ${asset.width}, ${asset.height}, false, false,
        false, false, 'active', ${runId}, ${runId}, 'release-safe'
      )
    `;
  }

  for (const person of plan.people) {
    const speciesKind =
      person.subjectKind === "pet"
        ? person.displayName === "Pixel"
          ? "cat"
          : "dog"
        : null;
    await tx`
      INSERT INTO person (
        person_id, display_name, status, created_by_receipt_id, privacy_class,
        subject_kind, description, cover_asset_id, species_kind
      ) VALUES (
        ${person.personId}, ${person.displayName}, 'active', ${receiptId},
        'release-safe', ${person.subjectKind},
        ${
          person.subjectKind === "pet"
            ? "A fictional Cedar House companion in the wholly synthetic public demo archive."
            : "A fictional member of the wholly synthetic Cedar House public demo archive."
        },
        ${person.coverAssetId}, ${speciesKind}
      )
    `;
    await tx`
      INSERT INTO person_alias (
        alias_id, person_id, label, alias_kind, state, producer_receipt_id,
        privacy_class
      ) VALUES (
        ${stable("alias", `cedar-house:${person.shortName}`)}, ${person.personId},
        ${person.shortName}, 'nickname', 'active', ${receiptId}, 'release-safe'
      )
    `;
    if (person.subjectKind === "person") {
      await tx`
        INSERT INTO person_profile (
          person_id, about, privacy_class
        ) VALUES (
          ${person.personId},
          ${`${person.displayName} is a fictional person created for the Cedar House product demonstration.`},
          'release-safe'
        )
      `;
    }
  }

  const duplicateNoraId = stable("person", "cedar-house:Nora duplicate");
  const nora = plan.people.find((person) => person.shortName === "Nora");
  await tx`
    INSERT INTO person (
      person_id, display_name, status, created_by_receipt_id, privacy_class,
      subject_kind, description, cover_asset_id
    ) VALUES (
      ${duplicateNoraId}, 'Nora C.', 'active', ${receiptId}, 'release-safe',
      'person', 'Intentional duplicate Person for merge/unmerge demonstration.',
      ${plan.assets.find((asset) => asset.publicAssetId === "CHA-038").assetId}
    )
  `;
  await tx`
    INSERT INTO person_category_membership_event (
      membership_event_id, person_id, category_id, action, actor_kind,
      actor_id, producer_receipt_id, privacy_class
    ) VALUES (
      ${stable("membership", "cedar-house:duplicate-nora-sort")},
      ${duplicateNoraId}, 'category_sort', 'add', 'system',
      'cimmich-public-demo', ${receiptId}, 'release-safe'
    )
  `;

  for (const context of plan.contexts) {
    const dates =
      context.eventKind === "life_period"
        ? ["2020-03-14", "2025-10-10", "year"]
        : context.eventKind === "trip"
          ? ["2022-07-15", "2022-07-17", "exact"]
          : context.eventKind === "event"
            ? ["2024-07-25", "2024-07-25", "exact"]
            : context.eventKind === "activity"
              ? ["2025-10-04", "2025-10-10", "approximate"]
              : [null, null, "unknown"];
    await tx`
      INSERT INTO context_entity (
        entity_id, entity_kind, place_kind, object_kind, event_kind,
        display_name, description, date_start, date_end, date_precision,
        geometry, status, privacy_class
      ) VALUES (
        ${context.entityId}, ${context.entityKind}, ${context.placeKind},
        ${context.objectKind}, ${context.eventKind}, ${context.displayName},
        ${`Fictional ${context.entityKind} in the Cedar House public demo archive.`},
        ${dates[0]}, ${dates[1]}, ${dates[2]},
        ${context.geometry ? tx.json(context.geometry) : null}, 'active',
        'private'
      )
    `;
  }

  const contextByName = new Map(
    plan.contexts.map((item) => [item.displayName, item]),
  );
  for (const asset of plan.assets) {
    for (const contextName of asset.contexts) {
      const context = contextByName.get(contextName);
      const decisionId = decision(
        `context:${context.entityId}:${asset.assetId}`,
      );
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'context_asset_link', ${context.entityId}, 'attach',
          'trusted_import', 'cimmich-public-demo', 'synthetic_demo_truth', '',
          ${receiptId}, 'release-safe'
        )
      `;
      const associationKind =
        context.entityKind === "place"
          ? "captured_at"
          : context.entityKind === "object"
            ? "depicts"
            : "direct";
      await tx`
        INSERT INTO context_asset_link (
          link_id, entity_id, asset_id, association_kind, state, decision_id,
          privacy_class
        ) VALUES (
          ${stable("contextasset", `${context.entityId}:${asset.assetId}`)},
          ${context.entityId}, ${asset.assetId}, ${associationKind}, 'accepted',
          ${decisionId}, 'private'
        )
      `;
    }
  }
  for (const context of plan.contexts) {
    if (context.entityKind === "event") continue;
    await tx`
      UPDATE context_entity SET cover_asset_id = ${context.coverAssetId}
      WHERE entity_id = ${context.entityId}
    `;
  }

  const eventAssets = new Map();
  for (const asset of plan.assets) {
    for (const contextName of asset.contexts) {
      const context = contextByName.get(contextName);
      if (context.entityKind !== "event") continue;
      const current = eventAssets.get(context.entityId) || {
        contexts: new Set(),
        subjects: new Set(),
      };
      asset.subjects.forEach((subject) => current.subjects.add(subject));
      asset.contexts
        .filter((name) => name !== contextName)
        .forEach((name) => current.contexts.add(name));
      eventAssets.set(context.entityId, current);
    }
  }
  const personByShortName = new Map(
    plan.people.map((person) => [person.shortName, person]),
  );
  for (const [eventId, evidence] of eventAssets) {
    for (const shortName of evidence.subjects) {
      const subject = personByShortName.get(shortName);
      const relationKind =
        subject.subjectKind === "pet" ? "companion" : "participant";
      const decisionId = decision(`relation:${eventId}:${subject.personId}`);
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'context_relation', ${eventId}, 'attach', 'trusted_import',
          'cimmich-public-demo', 'synthetic_demo_truth', ${receiptId}, 'release-safe'
        )
      `;
      await tx`
        INSERT INTO context_relation_link (
          link_id, entity_id, target_kind, target_id, relation_kind, state,
          decision_id, privacy_class
        ) VALUES (
          ${stable("contextrel", `${eventId}:${subject.personId}`)}, ${eventId},
          ${subject.subjectKind}, ${subject.personId}, ${relationKind}, 'accepted',
          ${decisionId}, 'private'
        )
      `;
    }
    for (const contextName of evidence.contexts) {
      const target = contextByName.get(contextName);
      if (!target || !["place", "object"].includes(target.entityKind)) continue;
      const relationKind =
        target.entityKind === "place" ? "location" : "object";
      const decisionId = decision(`relation:${eventId}:${target.entityId}`);
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'context_relation', ${eventId}, 'attach', 'trusted_import',
          'cimmich-public-demo', 'synthetic_demo_truth', ${receiptId}, 'release-safe'
        )
      `;
      await tx`
        INSERT INTO context_relation_link (
          link_id, entity_id, target_kind, target_id, relation_kind, state,
          decision_id, privacy_class
        ) VALUES (
          ${stable("contextrel", `${eventId}:${target.entityId}`)}, ${eventId},
          ${target.entityKind}, ${target.entityId}, ${relationKind}, 'accepted',
          ${decisionId}, 'private'
        )
      `;
    }
  }

  const documentLinks = {
    "CHA-046": ["Bluewater Weekend", "Bluewater Beach", "Ruby"],
    "CHA-047": ["Juniper"],
    "CHA-048": ["Ruby", "Northside Workshop"],
    "CHA-049": ["Nora", "Cedar House"],
    "CHA-050": ["Nora", "Nora's 70th Birthday"],
  };
  for (const document of plan.documents) {
    await tx`
      INSERT INTO cimmich_document (
        document_id, source_kind, source_asset_id, source_filename, mime_type,
        byte_size, content_sha256, source_content_hash, display_title,
        document_kind, status, visibility_tier, created_by, privacy_class
      ) VALUES (
        ${document.documentId}, 'immich_asset', ${document.assetId},
        ${document.filename}, 'image/png', NULL, ${document.sha256},
        ${document.sha256}, ${document.title}, ${document.documentKind},
        'active', ${document.visibility}, 'cimmich-public-demo', 'private'
      )
    `;
    for (const targetName of documentLinks[document.publicAssetId]) {
      const person = personByShortName.get(targetName);
      const context = contextByName.get(targetName);
      const target = person || context;
      const subjectKind = person ? person.subjectKind : context.entityKind;
      const subjectId = person ? person.personId : context.entityId;
      const decisionId = decision(
        `document:${document.documentId}:${subjectId}`,
      );
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'document_link', ${document.documentId}, 'attach',
          'trusted_import', 'cimmich-public-demo', 'synthetic_demo_truth',
          ${receiptId}, 'release-safe'
        )
      `;
      await tx`
        INSERT INTO cimmich_document_link (
          link_id, document_id, subject_kind, subject_id, relation_kind, state,
          decision_id, privacy_class
        ) VALUES (
          ${stable("document_link", `${document.documentId}:${subjectId}`)},
          ${document.documentId}, ${subjectKind}, ${subjectId}, 'about', 'current',
          ${decisionId}, 'private'
        )
      `;
    }
  }

  for (const asset of plan.assets.filter(
    (item) => item.visibility !== "standard",
  )) {
    const visibilityDecisionId = stable(
      "visibility_decision",
      `cedar-house:${asset.assetId}`,
    );
    await tx`
      INSERT INTO cimmich_visibility_decision (
        decision_id, actor_id, principal_id, device_id, decision_kind,
        before_state, after_state, state, privacy_class
      ) VALUES (
        ${visibilityDecisionId}, 'cimmich-public-demo', 'cedar-house-demo',
        'bootstrap', 'set', '[]'::jsonb,
        ${tx.json([{ objectId: asset.assetId, objectScope: "asset", visibilityTier: asset.visibility }])},
        'active', 'private'
      )
    `;
    await tx`
      INSERT INTO cimmich_visibility_object (
        object_scope, object_id, visibility_tier, decision_id, privacy_class
      ) VALUES (
        'asset', ${asset.assetId}, ${asset.visibility}, ${visibilityDecisionId},
        'private'
      )
    `;
  }

  const anchorBoxes = [
    ["CHA-001", "Maya", 0.29, 0.08, 0.38, 0.23],
    ["CHA-002", "Alex", 0.34, 0.08, 0.28, 0.2],
    ["CHA-003", "Nora", 0.35, 0.09, 0.29, 0.21],
    ["CHA-004", "Theo", 0.58, 0.09, 0.19, 0.25],
    ["CHA-005", "Samira", 0.27, 0.07, 0.34, 0.22],
    ["CHA-006", "Eli", 0.3, 0.08, 0.31, 0.2],
  ];
  for (const [publicAssetId, shortName, x, y, w, h] of anchorBoxes) {
    const asset = plan.assets.find(
      (item) => item.publicAssetId === publicAssetId,
    );
    const person = personByShortName.get(shortName);
    const faceId = stable("face", `cedar-house:anchor:${publicAssetId}`);
    const claimId = stable("claim", `cedar-house:anchor:${publicAssetId}`);
    const decisionId = decision(`identity:${publicAssetId}`);
    await tx`
      INSERT INTO face_observation (
        face_id, asset_id, box_x, box_y, box_w, box_h,
        detection_confidence, quality_measurements, state, producer_receipt_id,
        privacy_class, observation_origin
      ) VALUES (
        ${faceId}, ${asset.assetId}, ${x}, ${y}, ${w}, ${h}, 0.98,
        '{"quality_score":0.95,"quality_bucket":"demo_anchor"}'::jsonb,
        'valid', ${receiptId}, 'release-safe', 'detector_or_import'
      )
    `;
    await tx`
      INSERT INTO decision (
        decision_id, subject_type, subject_id, action, actor_kind, actor_id,
        reason_code, producer_receipt_id, privacy_class
      ) VALUES (
        ${decisionId}, 'identity_claim', ${claimId}, 'accept', 'trusted_import',
        'cimmich-public-demo', 'synthetic_demo_truth', ${receiptId}, 'release-safe'
      )
    `;
    await tx`
      INSERT INTO identity_claim (
        identity_claim_id, face_id, person_id, origin, state,
        calibrated_confidence, evidence_refs, decision_id,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${claimId}, ${faceId}, ${person.personId}, 'trusted_import', 'accepted',
        1, '["synthetic-demo-human-truth"]'::jsonb, ${decisionId}, ${receiptId},
        'release-safe'
      )
    `;
  }

  const reviewRows = [
    ["CHA-033", "Nora", "candidate", 0.36, 0.18, 0.15, 0.28],
    ["CHA-026", "Samira", "rejected", 0.25, 0.08, 0.45, 0.35],
  ];
  for (const [publicAssetId, shortName, state, x, y, w, h] of reviewRows) {
    const asset = plan.assets.find(
      (item) => item.publicAssetId === publicAssetId,
    );
    const person = personByShortName.get(shortName);
    const faceId = stable("face", `cedar-house:review:${publicAssetId}`);
    const claimId = stable("claim", `cedar-house:review:${publicAssetId}`);
    const decisionId =
      state === "rejected" ? decision(`reject:${publicAssetId}`) : null;
    await tx`
      INSERT INTO face_observation (
        face_id, asset_id, box_x, box_y, box_w, box_h,
        detection_confidence, quality_measurements, state, producer_receipt_id,
        privacy_class, observation_origin
      ) VALUES (
        ${faceId}, ${asset.assetId}, ${x}, ${y}, ${w}, ${h}, 0.76,
        '{"quality_score":0.58,"quality_bucket":"difficult"}'::jsonb,
        'valid', ${receiptId}, 'release-safe', 'detector_or_import'
      )
    `;
    if (decisionId) {
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'identity_claim', ${claimId}, 'reject', 'user',
          'cimmich-public-demo', 'not_this_person', ${receiptId}, 'release-safe'
        )
      `;
    }
    await tx`
      INSERT INTO identity_claim (
        identity_claim_id, face_id, person_id, origin, state,
        calibrated_confidence, evidence_refs, decision_id,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${claimId}, ${faceId}, ${person.personId}, 'secondary_match', ${state},
        0.76, '["synthetic-demo-review-state"]'::jsonb, ${decisionId},
        ${receiptId}, 'release-safe'
      )
    `;
  }

  const unknownAsset = plan.assets.find(
    (item) => item.publicAssetId === "CHA-036",
  );
  await tx`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
      quality_measurements, state, producer_receipt_id, privacy_class,
      observation_origin
    ) VALUES (
      ${stable("face", "cedar-house:unknown:CHA-036")}, ${unknownAsset.assetId},
      0.08, 0.08, 0.34, 0.7, 0.51,
      '{"quality_score":0.31,"quality_bucket":"low_quality"}'::jsonb,
      'valid', ${receiptId}, 'release-safe', 'detector_or_import'
    )
  `;

  const wrongAsset = plan.assets.find(
    (item) => item.publicAssetId === "CHA-035",
  );
  const alex = personByShortName.get("Alex");
  const wrongFaceId = stable("face", "cedar-house:wrong:CHA-035");
  const wrongClaimId = stable("claim", "cedar-house:wrong:CHA-035");
  const wrongDecisionId = decision("wrong:CHA-035");
  await tx`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
      quality_measurements, state, producer_receipt_id, privacy_class,
      observation_origin
    ) VALUES (
      ${wrongFaceId}, ${wrongAsset.assetId}, 0.62, 0.18, 0.24, 0.45, 0.82,
      '{"quality_score":0.67,"quality_bucket":"side_profile"}'::jsonb,
      'valid', ${receiptId}, 'release-safe', 'detector_or_import'
    )
  `;
  await tx`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, producer_receipt_id, privacy_class
    ) VALUES (
      ${wrongDecisionId}, 'identity_claim', ${wrongClaimId}, 'accept',
      'trusted_import', 'cimmich-public-demo', 'intentional_correction_fixture',
      ${receiptId}, 'release-safe'
    )
  `;
  await tx`
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state,
      calibrated_confidence, evidence_refs, decision_id,
      producer_receipt_id, privacy_class
    ) VALUES (
      ${wrongClaimId}, ${wrongFaceId}, ${alex.personId}, 'trusted_import',
      'accepted', 1, '["intentional-demo-error"]'::jsonb, ${wrongDecisionId},
      ${receiptId}, 'release-safe'
    )
  `;

  await tx`
    INSERT INTO person_category_membership_event (
      membership_event_id, person_id, category_id, action, actor_kind,
      actor_id, producer_receipt_id, privacy_class
    )
    SELECT ${stable("membership", "cedar-house:all-sort") || ""} || '_' || substr(person_id, 8, 8),
      person_id, 'category_sort', 'add', 'system', 'cimmich-public-demo',
      ${receiptId}, 'release-safe'
    FROM person
    WHERE status = 'active' AND person_id <> ${duplicateNoraId}
  `;
});

const tagStore = createManualSubjectTagStore(sql, {
  presentationRank: () => 2,
});
for (const tag of plan.manualTags) {
  await tagStore.attach({
    actorId: "cimmich-public-demo",
    assetId: tag.assetId,
    commandId: `demo.attach.${tag.tagType}.v1`,
    region: tag.geometry,
    subjectId: tag.subjectId,
    subjectKind: tag.subjectKind,
    tagType: tag.tagType,
  });
}

const [counts] = await sql`
  SELECT
    (SELECT count(*)::integer FROM asset WHERE state = 'active') AS assets,
    (SELECT count(*)::integer FROM person WHERE status = 'active') AS people,
    (SELECT count(*)::integer FROM context_entity WHERE status = 'active') AS contexts,
    (SELECT count(*)::integer FROM cimmich_document WHERE status = 'active') AS documents,
    (SELECT count(*)::integer FROM manual_subject_tag_operation WHERE state = 'active') AS manual_tags,
    (SELECT count(*)::integer FROM cimmich_visibility_object WHERE object_scope = 'asset') AS visibility_overrides,
    (SELECT count(*)::integer FROM source_pack WHERE state = 'active') AS active_source_packs
`;
const receipt = {
  archiveDigest: plan.archiveDigest,
  authority: {
    activeSourcePacks: "none",
    automaticIdentityAcceptance: "none",
    generatedDemoOnly: true,
    matchingPerformanceClaim: "none",
  },
  counts,
  immichVersion: plan.immichVersion,
  schemaVersion: publicDemoSeedSchemaVersion,
  seedDigest: plan.seedDigest,
  status: "READY",
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  mode: 0o644,
});
await chmod(receiptPath, 0o644);
await writeFile(
  bridgePath,
  `${JSON.stringify(
    {
      assets: plan.assets.map((asset) => ({
        assetId: asset.assetId,
        filename: asset.filename,
        sourceAssetId: asset.immichAssetId,
      })),
      filenameAuthority: "canonical_source",
      schemaVersion: "cimmich.display-bridge.v1",
    },
    null,
    2,
  )}\n`,
  { mode: 0o644 },
);
await chmod(bridgePath, 0o644);
await sql.end();
process.stdout.write(`${JSON.stringify(receipt)}\n`);
