import { createHash, randomUUID } from "node:crypto";

export const IMMICH_ONBOARDING_SCHEMA_VERSION = "cimmich.immich-onboarding.v1";

const receiptId = "receipt_cimmich_immich_onboarding_identity_import_v1";
const resolutionReceiptId = "receipt_cimmich_immich_person_resolution_v1";
const PERSON_RESOLUTION_ACTIONS = new Set([
  "create_person",
  "existing_person",
  "later",
  "noise",
  "unknown",
]);
const LANES = ["timeline", "archive", "hidden", "locked"];
const MEDIA_KINDS = ["image", "video"];
const MODE_RANK = new Map([
  ["Standard", 0],
  ["Personal", 1],
  ["Private", 2],
]);
const LANE_RANK = new Map([
  ["timeline", 0],
  ["archive", 1],
  ["hidden", 2],
  ["locked", 3],
]);

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const stableId = (prefix, ...parts) =>
  `${prefix}${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 40)}`;

const typedError = (code, message, statusCode = 400, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const boundedId = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw typedError("IMMICH_ONBOARDING_INPUT_INVALID", `${label} is invalid`);
  }
  return normalized;
};

const commandId = (value) => {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(normalized)) {
    throw typedError(
      "IMMICH_ONBOARDING_COMMAND_INVALID",
      "A stable commandId of 8 to 120 safe characters is required",
    );
  }
  return normalized;
};

const normalizedName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name || name.length > 160) {
    throw typedError(
      "IMMICH_ONBOARDING_SOURCE_INVALID",
      "Immich Person name is invalid",
      502,
    );
  }
  return name;
};

export const normalizeImmichOnboardingScope = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "IMMICH_ONBOARDING_SCOPE_INVALID",
      "Setup scope is invalid",
    );
  }
  const allowed = [
    "importPeople",
    "includeHiddenPeople",
    "mediaKinds",
    "providerMode",
    "visibilities",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw typedError(
      "IMMICH_ONBOARDING_SCOPE_INVALID",
      "Setup scope contains unsupported fields",
    );
  }
  const visibilities = value.visibilities ?? ["timeline"];
  const mediaKinds = value.mediaKinds ?? [...MEDIA_KINDS];
  if (
    !Array.isArray(visibilities) ||
    visibilities.length < 1 ||
    new Set(visibilities).size !== visibilities.length ||
    visibilities.some((lane) => !LANES.includes(lane))
  ) {
    throw typedError(
      "IMMICH_ONBOARDING_SCOPE_INVALID",
      "Setup visibility lanes are invalid",
    );
  }
  if (
    !Array.isArray(mediaKinds) ||
    mediaKinds.length < 1 ||
    new Set(mediaKinds).size !== mediaKinds.length ||
    mediaKinds.some((kind) => !MEDIA_KINDS.includes(kind))
  ) {
    throw typedError(
      "IMMICH_ONBOARDING_SCOPE_INVALID",
      "Setup media kinds are invalid",
    );
  }
  const providerMode = String(value.providerMode || "deferred");
  if (!new Set(["deferred", "configured"]).has(providerMode)) {
    throw typedError(
      "IMMICH_ONBOARDING_SCOPE_INVALID",
      "Setup provider mode is invalid",
    );
  }
  return Object.freeze({
    importPeople: value.importPeople !== false,
    includeHiddenPeople: value.includeHiddenPeople === true,
    mediaKinds: MEDIA_KINDS.filter((kind) => mediaKinds.includes(kind)),
    providerMode,
    visibilities: LANES.filter((lane) => visibilities.includes(lane)),
  });
};

const viewingModeRank = (viewingMode) => {
  const rawMode = String(viewingMode || "Standard").toLowerCase();
  const mode = `${rawMode.slice(0, 1).toUpperCase()}${rawMode.slice(1)}`;
  const rank = MODE_RANK.get(mode);
  if (rank == null) {
    throw typedError(
      "IMMICH_ONBOARDING_VIEWING_MODE_INVALID",
      "Setup viewing mode is invalid",
    );
  }
  return rank;
};

const enforceViewingMode = (scope, viewingMode) => {
  const rank = viewingModeRank(viewingMode);
  const inaccessible = scope.visibilities.find(
    (lane) => (LANE_RANK.get(lane) ?? 99) > rank,
  );
  if (inaccessible) {
    throw typedError(
      "IMMICH_ONBOARDING_SCOPE_NOT_VISIBLE",
      "Setup scope exceeds the active viewing mode",
      403,
      { lane: inaccessible },
    );
  }
  if (scope.includeHiddenPeople && rank < 2) {
    throw typedError(
      "IMMICH_ONBOARDING_SCOPE_NOT_VISIBLE",
      "Hidden Immich People require Private viewing mode",
      403,
    );
  }
};

const iou = (left, right) => {
  const x1 = Math.max(Number(left.x), Number(right.x));
  const y1 = Math.max(Number(left.y), Number(right.y));
  const x2 = Math.min(
    Number(left.x) + Number(left.w),
    Number(right.x) + Number(right.w),
  );
  const y2 = Math.min(
    Number(left.y) + Number(left.h),
    Number(right.y) + Number(right.h),
  );
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union =
    Number(left.w) * Number(left.h) +
    Number(right.w) * Number(right.h) -
    intersection;
  return union > 0 ? intersection / union : 0;
};

export const reconcileImmichFacesByGeometry = ({
  providerFaces,
  sourceFaces,
}) => {
  const pairs = [];
  for (const source of sourceFaces) {
    for (const provider of providerFaces) {
      const score = iou(source.box, provider.box);
      if (score >= 0.8) pairs.push({ provider, score, source });
    }
  }
  const matches = new Map();
  for (const source of sourceFaces) {
    const candidates = pairs
      .filter((pair) => pair.source.id === source.id)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.provider.id.localeCompare(right.provider.id),
      );
    if (!candidates.length) {
      matches.set(source.id, {
        reason: "missing_provider_face",
        state: "missing",
      });
      continue;
    }
    const best = candidates[0];
    const providerCandidates = pairs
      .filter((pair) => pair.provider.id === best.provider.id)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.source.id.localeCompare(right.source.id),
      );
    const sourceMargin = best.score - (candidates[1]?.score ?? 0);
    const providerMargin = best.score - (providerCandidates[1]?.score ?? 0);
    if (
      sourceMargin < 0.1 ||
      providerMargin < 0.1 ||
      providerCandidates[0]?.source.id !== source.id
    ) {
      matches.set(source.id, {
        reason: "ambiguous_provider_geometry",
        state: "ambiguous",
      });
      continue;
    }
    matches.set(source.id, {
      providerFaceId: best.provider.id,
      score: Number(best.score.toFixed(6)),
      state: "exact",
    });
  }
  return matches;
};

const batches = (items, size) => {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
};

export const projectUnlabelledPersonClusters = ({ assets, facesByAsset }) => {
  const assetsById = new Map(
    assets.map((asset) => [asset.immichAssetId, asset]),
  );
  const clusters = new Map();
  for (const [sourceAssetId, faces] of facesByAsset) {
    const asset = assetsById.get(sourceAssetId);
    if (!asset) continue;
    for (const face of faces) {
      if (!face.person || face.person.name) continue;
      if (!clusters.has(face.person.id)) {
        clusters.set(face.person.id, {
          faces: [],
          person: face.person,
        });
      }
      clusters.get(face.person.id).faces.push({ asset, face });
    }
  }
  return [...clusters.values()]
    .map(({ faces, person }) => {
      const ordered = faces.toSorted(
        (left, right) =>
          left.face.id.localeCompare(right.face.id) ||
          left.asset.immichAssetId.localeCompare(right.asset.immichAssetId),
      );
      const representative = ordered[0];
      const snapshot = {
        faces: ordered.map(({ asset, face }) => ({
          assetInputRevision: asset.inputRevision,
          box: face.box,
          faceId: face.id,
          faceSourceRevision: face.sourceRevision,
          sourceAssetId: asset.immichAssetId,
        })),
        immichPersonId: person.id,
        sourceRevision: person.sourceRevision,
      };
      return {
        faceCount: ordered.length,
        immichPersonId: person.id,
        representative: {
          assetInputRevision: representative.asset.inputRevision,
          box: representative.face.box,
          faceId: representative.face.id,
          sourceAssetId: representative.asset.immichAssetId,
        },
        snapshotDigest: digest(snapshot),
        sourceRevision: person.sourceRevision,
      };
    })
    .sort((left, right) =>
      left.immichPersonId.localeCompare(right.immichPersonId),
    );
};

const normalizedResolutionAction = (value) => {
  const action = String(value || "");
  if (!PERSON_RESOLUTION_ACTIONS.has(action)) {
    throw typedError(
      "IMMICH_PERSON_RESOLUTION_INPUT_INVALID",
      "Immich Person resolution action is invalid",
    );
  }
  return action;
};

const normalizedOwnerPersonName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw typedError(
      "IMMICH_PERSON_RESOLUTION_INPUT_INVALID",
      "New Person name is invalid",
    );
  }
  return name;
};

export const duplicateImmichPersonNames = (faces) => {
  const sourcePeopleByName = new Map();
  for (const face of faces) {
    if (!face?.person?.name) continue;
    const key = normalizedName(face.person.name).toLocaleLowerCase("en");
    if (!sourcePeopleByName.has(key)) sourcePeopleByName.set(key, new Set());
    sourcePeopleByName
      .get(key)
      .add(boundedId(face.person.id, "person.id", 200));
  }
  return new Set(
    [...sourcePeopleByName]
      .filter(([, personIds]) => personIds.size > 1)
      .map(([name]) => name)
      .sort(),
  );
};

const verifiedCompanionStatus = async (
  companion,
  { failClosed = false } = {},
) => {
  const status = await companion.status();
  if (status.state !== "ready") return status;
  try {
    const verified = await companion.verifyOnboardingPermissions();
    return {
      ...status,
      capabilities: verified.capabilities,
      permissionVerification: verified.permissionVerification,
      permissions: verified.permissions,
    };
  } catch (error) {
    if (failClosed) throw error;
    return {
      ...status,
      capabilities: {
        assetRead: false,
        assetSearch: false,
        faceRead: false,
        mediaRead: false,
        personList: false,
        personRead: false,
      },
      code: error?.code || "IMMICH_COMPANION_PERMISSION_CHECK_FAILED",
      permissionVerification: "failed",
      state:
        error?.code === "IMMICH_COMPANION_AUTH_FAILED"
          ? "unauthorized"
          : "unavailable",
    };
  }
};

const scanSource = async ({ companion, scope }) => {
  const status = await verifiedCompanionStatus(companion, {
    failClosed: true,
  });
  if (status.state !== "ready") {
    throw typedError(
      status.code || "IMMICH_COMPANION_NOT_READY",
      "Immich connection is not ready for setup",
      status.state === "incompatible" ? 409 : 503,
    );
  }
  const people = [];
  let peopleCursor = "";
  do {
    const page = await companion.listPeople({
      cursor: peopleCursor,
      includeHidden: scope.includeHiddenPeople,
      limit: 500,
    });
    people.push(...page.items);
    peopleCursor = page.nextCursor || "";
    if (people.length > 100_000) {
      throw typedError(
        "IMMICH_ONBOARDING_SOURCE_TOO_LARGE",
        "Immich People preview exceeds the supported setup bound",
        413,
      );
    }
  } while (peopleCursor);

  const assets = [];
  const laneCounts = {};
  const visibilityCoverage = {};
  for (const visibility of scope.visibilities) {
    let cursor = "";
    let count = 0;
    let accessState = "available";
    do {
      const page = await companion.listAssets({
        cursor,
        limit: 500,
        visibility,
      });
      accessState = page.accessState || "available";
      for (const asset of page.items) {
        if (scope.mediaKinds.includes(asset.assetType)) assets.push(asset);
      }
      count += page.items.length;
      cursor = page.nextCursor || "";
      if (assets.length > 100_000) {
        throw typedError(
          "IMMICH_ONBOARDING_SOURCE_TOO_LARGE",
          "Immich asset preview exceeds the supported setup bound",
          413,
        );
      }
    } while (cursor);
    laneCounts[visibility] = count;
    visibilityCoverage[visibility] = {
      accessState,
      itemCount: count,
    };
  }

  const imageAssets = assets.filter((asset) => asset.assetType === "image");
  const facesByAsset = new Map();
  for (const group of batches(imageAssets, 8)) {
    const pages = await Promise.all(
      group.map((asset) =>
        companion.listAssetFaces({ assetId: asset.immichAssetId }),
      ),
    );
    for (const page of pages) {
      facesByAsset.set(
        page.assetId,
        page.items.filter(
          (face) => scope.includeHiddenPeople || !face.person?.isHidden,
        ),
      );
    }
  }
  const faces = [...facesByAsset.values()].flat();
  const publicPreview = {
    schemaVersion: IMMICH_ONBOARDING_SCHEMA_VERSION,
    connection: {
      immichVersion: status.immichVersion,
      permissionVerification: status.permissionVerification,
      principalId: status.principal.userId,
      readOnly: true,
      permissions: {
        assets: true,
        faces: true,
        media: Boolean(status.capabilities.mediaRead),
        people: true,
        locked: "interactive_elevated_session_required",
      },
    },
    counts: {
      assignedFaces: faces.filter((face) => face.personId).length,
      assets: assets.length,
      images: assets.filter((asset) => asset.assetType === "image").length,
      people: people.filter((person) => !person.isHidden).length,
      labelledPeople: people.filter((person) => !person.isHidden && person.name)
        .length,
      hiddenPeople: people.filter((person) => person.isHidden).length,
      unlabelledPeople: people.filter(
        (person) => !person.isHidden && !person.name,
      ).length,
      unassignedFaces: faces.filter((face) => !face.personId).length,
      videos: assets.filter((asset) => asset.assetType === "video").length,
      visibilityLanes: laneCounts,
    },
    coverage: {
      visibilityLanes: visibilityCoverage,
    },
    scope,
    unsupported: {
      albums: "not_exposed_by_onboarding_v1",
      exif: "separate_disclosed_choice_not_exposed",
      genericTags: "separate_disclosed_choice_not_exposed",
      locked: "interactive_elevated_session_required",
    },
  };
  return {
    assets,
    facesByAsset,
    people,
    preview: { ...publicPreview, previewDigest: digest(publicPreview) },
  };
};

const loadOrCreatePerson = async (
  tx,
  { actorId, person, sourceId, sourceNameCollision = false },
) => {
  if (!person.name) {
    return { conflict: true, reason: "source_person_unlabelled" };
  }
  const [projection] = await tx`
    SELECT projection.person_id, projection.source_revision, current.display_name
    FROM immich_person_projection projection
    JOIN current_person current ON current.person_id = projection.person_id
    WHERE projection.source_id = ${sourceId}
      AND projection.immich_person_id = ${person.id}
      AND projection.state = 'active'
    FOR SHARE OF projection
  `;
  if (projection) {
    return projection.source_revision === person.sourceRevision
      ? { personId: projection.person_id, reused: true }
      : { conflict: true, reason: "person_revision_changed" };
  }

  const name = normalizedName(person.name);
  if (sourceNameCollision) {
    return { conflict: true, reason: "duplicate_person_name" };
  }
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`immich-person-name:${name.toLocaleLowerCase("en")}`}, 67)
    )
  `;
  const duplicates = await tx`
    SELECT candidate.person_id, candidate.display_name
    FROM person candidate
    WHERE candidate.status = 'active'
      AND (lower(candidate.display_name) = lower(${name}) OR EXISTS (
        SELECT 1 FROM person_alias alias
        WHERE alias.person_id = candidate.person_id
          AND alias.state = 'active' AND lower(alias.label) = lower(${name})
      ))
    ORDER BY candidate.person_id
    FOR SHARE OF candidate
  `;
  if (duplicates.length > 1)
    return { conflict: true, candidates: duplicates.length };
  if (duplicates.length === 1) {
    await tx`
      INSERT INTO immich_person_projection (
        source_id, immich_person_id, person_id, source_name, source_revision,
        state, producer_receipt_id
      ) VALUES (
        ${sourceId}, ${person.id}, ${duplicates[0].person_id}, ${name},
        ${person.sourceRevision}, 'active', ${receiptId}
      ) ON CONFLICT (source_id, immich_person_id) DO NOTHING
    `;
    return { personId: duplicates[0].person_id, reused: true };
  }

  const [sort] = await tx`
    SELECT category_id FROM person_category
    WHERE slug = 'sort' AND state = 'active' LIMIT 1 FOR SHARE
  `;
  if (!sort) {
    throw typedError(
      "IMMICH_ONBOARDING_SORT_UNAVAILABLE",
      "The required Sort workflow is unavailable",
      503,
    );
  }
  const personId = `person_${randomUUID().replaceAll("-", "")}`;
  const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
  await tx`
    INSERT INTO person (
      person_id, display_name, status, subject_kind,
      created_by_receipt_id, privacy_class
    ) VALUES (${personId}, ${name}, 'active', 'person', ${receiptId}, 'private')
  `;
  await tx`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, note, producer_receipt_id, privacy_class
    ) VALUES (
      ${decisionId}, 'identity_subject', ${personId}, 'create', 'trusted_import',
      ${actorId}, 'immich_person_imported', '', ${receiptId}, 'private'
    )
  `;
  await tx`
    INSERT INTO person_category_membership_event (
      membership_event_id, person_id, category_id, action, actor_kind, actor_id,
      decision_id, producer_receipt_id, privacy_class
    ) VALUES (
      ${`categoryevent_${randomUUID().replaceAll("-", "")}`}, ${personId},
      ${sort.category_id}, 'add', 'user', ${actorId}, ${decisionId},
      ${receiptId}, 'private'
    )
  `;
  await tx`
    INSERT INTO immich_person_projection (
      source_id, immich_person_id, person_id, source_name, source_revision,
      state, producer_receipt_id
    ) VALUES (
      ${sourceId}, ${person.id}, ${personId}, ${name}, ${person.sourceRevision},
      'active', ${receiptId}
    )
  `;
  return { personId, reused: false };
};

const recordReviewItem = (tx, { assetId, faceId, reason, runId, sourceId }) =>
  tx`
    INSERT INTO immich_onboarding_review_item (
      review_item_id, run_id, source_id, immich_face_id, cimmich_asset_id,
      reason, state, public_details, producer_receipt_id
    ) VALUES (
      ${stableId("immich_review_", runId, faceId || assetId, reason)},
      ${runId}, ${sourceId}, ${faceId || null}, ${assetId || null},
      ${reason}, 'open', '{}'::jsonb, ${receiptId}
    ) ON CONFLICT (review_item_id) DO NOTHING
  `;

const providerFacesForAsset = async (tx, { assetId, inputRevision }) => {
  const rows = await tx`
    SELECT DISTINCT ON (face.face_id)
      face.face_id, face.box_x::float8 AS x, face.box_y::float8 AS y,
      face.box_w::float8 AS w, face.box_h::float8 AS h
    FROM face_observation face
    JOIN face_detection_result_observation member ON member.face_id = face.face_id
    JOIN face_detection_result result
      ON result.detection_result_id = member.detection_result_id
    WHERE face.asset_id = ${assetId} AND face.state = 'valid'
      AND face.observation_origin = 'detector_or_import'
      AND result.input_revision = ${inputRevision}
    ORDER BY face.face_id, result.created_at DESC, result.detection_result_id DESC
  `;
  return rows.map((row) => ({
    box: { h: row.h, w: row.w, x: row.x, y: row.y },
    id: row.face_id,
  }));
};

const createImportedObservation = async (tx, { assetId, face, sourceId }) => {
  const faceId = stableId("face_immich_", sourceId, face.id);
  await tx`
    INSERT INTO face_observation (
      face_id, asset_id, box_x, box_y, box_w, box_h,
      detection_confidence, quality_measurements, state, producer_receipt_id,
      observation_origin
    ) VALUES (
      ${faceId}, ${assetId}, ${face.box.x}, ${face.box.y}, ${face.box.w},
      ${face.box.h}, NULL,
      ${tx.json({ sourceKind: "immich_assigned_face", sourceRevision: face.sourceRevision })},
      'valid', ${receiptId}, 'immich_import'
    ) ON CONFLICT (face_id) DO NOTHING
  `;
  return faceId;
};

const acceptImportedIdentity = async (
  tx,
  { actorId, face, faceId, personId, sourceId },
) => {
  const [current] = await tx`
    SELECT claim.identity_claim_id, claim.person_id, claim.decision_id
    FROM identity_claim claim
    WHERE claim.face_id = ${faceId} AND claim.state = 'accepted'
    FOR SHARE OF claim
  `;
  if (current) {
    return current.person_id === personId
      ? {
          claimId: current.identity_claim_id,
          decisionId: current.decision_id,
          reused: true,
        }
      : { conflict: true };
  }
  const claimId = `claim_${randomUUID().replaceAll("-", "")}`;
  const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
  await tx`
    INSERT INTO decision (
      decision_id, subject_type, subject_id, action, actor_kind, actor_id,
      reason_code, note, producer_receipt_id, privacy_class
    ) VALUES (
      ${decisionId}, 'identity_claim', ${claimId}, 'accept', 'trusted_import',
      ${actorId}, 'immich_face_identity_imported', '', ${receiptId},
      'sensitive-biometric'
    )
  `;
  await tx`
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state,
      calibrated_confidence, evidence_refs, decision_id,
      producer_receipt_id, privacy_class
    ) VALUES (
      ${claimId}, ${faceId}, ${personId}, 'trusted_import', 'accepted', NULL,
      ${tx.json([{ sourceId, sourceFaceId: face.id, sourceRevision: face.sourceRevision }])},
      ${decisionId}, ${receiptId}, 'sensitive-biometric'
    )
  `;
  return { claimId, decisionId, reused: false };
};

export const createImmichOnboarding = ({
  companion,
  immichInventory,
  sourceId = "immich-primary",
  sql,
} = {}) => {
  if (
    !companion?.status ||
    !companion?.verifyOnboardingPermissions ||
    !companion?.listPeople ||
    !companion?.listAssetFaces
  ) {
    throw new Error(
      "Immich onboarding requires the People/Face companion projection",
    );
  }
  if (!immichInventory?.synchronize || !sql) {
    throw new Error(
      "Immich onboarding requires inventory and database services",
    );
  }
  const normalizedSourceId = boundedId(sourceId, "sourceId", 120);

  const connect = async ({
    actorId,
    apiBaseUrl,
    apiKey,
    commandId: inputCommandId,
  }) => {
    if (!companion.connect) {
      throw typedError(
        "IMMICH_COMPANION_CREDENTIAL_STORE_UNAVAILABLE",
        "This Cimmich runtime does not permit setup-managed connections",
        409,
      );
    }
    const actor = boundedId(actorId, "actorId", 120);
    const stableCommandId = commandId(inputCommandId);
    const normalizedUrl = String(apiBaseUrl || "").trim();
    const normalizedKey = String(apiKey || "").trim();
    const requestDigest = digest({
      apiBaseUrl: normalizedUrl,
      apiKey: normalizedKey,
    });
    const [existing] = await sql`
      SELECT actor_id, request_digest, response
      FROM immich_companion_connection_command
      WHERE command_id = ${stableCommandId}
    `;
    if (existing) {
      if (
        existing.actor_id !== actor ||
        existing.request_digest !== requestDigest
      ) {
        throw typedError(
          "IMMICH_ONBOARDING_COMMAND_CONFLICT",
          "commandId was already used for a different Immich connection",
          409,
        );
      }
      return { ...existing.response, replayed: true };
    }
    return sql.begin(async (tx) => {
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtextextended('cimmich:immich-companion-credential', 67)
        )
      `;
      const [raced] = await tx`
        SELECT actor_id, request_digest, response
        FROM immich_companion_connection_command
        WHERE command_id = ${stableCommandId} FOR UPDATE
      `;
      if (raced) {
        if (
          raced.actor_id !== actor ||
          raced.request_digest !== requestDigest
        ) {
          throw typedError(
            "IMMICH_ONBOARDING_COMMAND_CONFLICT",
            "commandId was already used for a different Immich connection",
            409,
          );
        }
        return { ...raced.response, replayed: true };
      }
      const connected = await companion.connect({
        apiBaseUrl: normalizedUrl,
        apiKey: normalizedKey,
      });
      const response = {
        schemaVersion: IMMICH_ONBOARDING_SCHEMA_VERSION,
        changed: true,
        connection: connected,
        replayed: false,
        state: "connected",
      };
      await tx`
        INSERT INTO immich_companion_connection_command (
          command_id, actor_id, request_digest, principal_id, response,
          producer_receipt_id
        ) VALUES (
          ${stableCommandId}, ${actor}, ${requestDigest},
          ${connected.principal.userId}, ${tx.json(response)}, ${receiptId}
        )
      `;
      return response;
    });
  };

  const preview = async ({
    scope: inputScope,
    viewingMode = "Standard",
  } = {}) => {
    const scope = normalizeImmichOnboardingScope(inputScope);
    enforceViewingMode(scope, viewingMode);
    return (await scanSource({ companion, scope })).preview;
  };

  const scanUnlabelledClusters = async ({ inputScope, viewingMode }) => {
    const scope = normalizeImmichOnboardingScope(inputScope);
    enforceViewingMode(scope, viewingMode);
    const scanned = await scanSource({ companion, scope });
    return {
      clusters: projectUnlabelledPersonClusters(scanned),
      scope,
    };
  };

  const personClusters = async ({
    scope: inputScope,
    viewingMode = "Standard",
  } = {}) => {
    const { clusters, scope } = await scanUnlabelledClusters({
      inputScope,
      viewingMode,
    });
    const rows = clusters.length
      ? await sql`
          SELECT resolution_id, immich_person_id, source_revision,
            snapshot_digest, resolution_action, person_id, decision_id
          FROM immich_person_resolution
          WHERE source_id = ${normalizedSourceId}
            AND immich_person_id = ANY(${clusters.map((cluster) => cluster.immichPersonId)})
            AND state = 'active'
        `
      : [];
    const resolutions = new Map(rows.map((row) => [row.immich_person_id, row]));
    return {
      schemaVersion: "cimmich.immich-person-resolution.v1",
      clusters: clusters.map((cluster) => {
        const resolution = resolutions.get(cluster.immichPersonId);
        const current =
          resolution &&
          resolution.source_revision === cluster.sourceRevision &&
          resolution.snapshot_digest === cluster.snapshotDigest;
        return {
          ...cluster,
          resolution: !resolution
            ? { state: "unresolved" }
            : !current
              ? { state: "stale" }
              : {
                  action: resolution.resolution_action,
                  decisionId: resolution.decision_id,
                  personId: resolution.person_id || null,
                  resolutionId: resolution.resolution_id,
                  state:
                    resolution.resolution_action === "later"
                      ? "later"
                      : "resolved",
                },
        };
      }),
      scope,
    };
  };

  const resolvePersonCluster = async ({
    action: inputAction,
    actorId,
    commandId: inputCommandId,
    expectedSourceRevision,
    immichPersonId,
    newPersonName,
    personId,
    scope: inputScope,
    snapshotDigest,
    viewingMode = "Standard",
  }) => {
    const actor = boundedId(actorId, "actorId", 120);
    const stableCommandId = commandId(inputCommandId);
    const sourcePersonId = boundedId(immichPersonId, "immichPersonId", 200);
    const action = normalizedResolutionAction(inputAction);
    const normalizedExpectedRevision = String(expectedSourceRevision || "");
    const normalizedSnapshotDigest = String(snapshotDigest || "");
    if (
      !/^[0-9a-f]{64}$/.test(normalizedExpectedRevision) ||
      !/^[0-9a-f]{64}$/.test(normalizedSnapshotDigest)
    ) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_INPUT_INVALID",
        "Current cluster revision and snapshot digest are required",
      );
    }
    const selectedPersonId =
      action === "existing_person"
        ? boundedId(personId, "personId", 120)
        : null;
    const selectedName =
      action === "create_person"
        ? normalizedOwnerPersonName(newPersonName)
        : null;
    if (
      (action !== "existing_person" && personId != null) ||
      (action !== "create_person" && newPersonName != null)
    ) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_INPUT_INVALID",
        "Resolution selector does not match its action",
      );
    }
    const scope = normalizeImmichOnboardingScope(inputScope);
    const visibleRank = viewingModeRank(viewingMode);
    const requestDigest = digest({
      action,
      expectedSourceRevision: normalizedExpectedRevision,
      immichPersonId: sourcePersonId,
      newPersonName: selectedName,
      personId: selectedPersonId,
      scope,
      snapshotDigest: normalizedSnapshotDigest,
      viewingMode,
    });
    const [existingCommand] = await sql`
      SELECT actor_id, request_digest, response
      FROM immich_person_resolution_command
      WHERE command_id = ${stableCommandId}
    `;
    if (existingCommand) {
      if (
        existingCommand.actor_id !== actor ||
        existingCommand.request_digest !== requestDigest
      ) {
        throw typedError(
          "IMMICH_PERSON_RESOLUTION_COMMAND_CONFLICT",
          "commandId was already used for a different cluster decision",
          409,
        );
      }
      return { ...existingCommand.response, replayed: true };
    }

    const { clusters } = await scanUnlabelledClusters({
      inputScope: scope,
      viewingMode,
    });
    const cluster = clusters.find(
      (candidate) => candidate.immichPersonId === sourcePersonId,
    );
    if (!cluster) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_NOT_VISIBLE",
        "Immich Person cluster is unavailable in the selected visible scope",
        404,
      );
    }
    if (
      cluster.sourceRevision !== normalizedExpectedRevision ||
      cluster.snapshotDigest !== normalizedSnapshotDigest
    ) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_STALE",
        "Immich Person cluster changed after preview",
        409,
      );
    }

    return sql.begin(async (tx) => {
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`immich-person-resolution:${normalizedSourceId}:${sourcePersonId}`}, 68)
        )
      `;
      const [racedCommand] = await tx`
        SELECT actor_id, request_digest, response
        FROM immich_person_resolution_command
        WHERE command_id = ${stableCommandId} FOR UPDATE
      `;
      if (racedCommand) {
        if (
          racedCommand.actor_id !== actor ||
          racedCommand.request_digest !== requestDigest
        ) {
          throw typedError(
            "IMMICH_PERSON_RESOLUTION_COMMAND_CONFLICT",
            "commandId was already used for a different cluster decision",
            409,
          );
        }
        return { ...racedCommand.response, replayed: true };
      }
      const [current] = await tx`
        SELECT resolution.*, person.display_name
        FROM immich_person_resolution resolution
        LEFT JOIN current_person person ON person.person_id = resolution.person_id
        WHERE resolution.source_id = ${normalizedSourceId}
          AND resolution.immich_person_id = ${sourcePersonId}
          AND resolution.state = 'active'
        FOR UPDATE OF resolution
      `;
      if (
        current &&
        (current.source_revision !== cluster.sourceRevision ||
          current.snapshot_digest !== cluster.snapshotDigest)
      ) {
        throw typedError(
          "IMMICH_PERSON_RESOLUTION_STALE",
          "The active cluster decision is bound to an older upstream revision",
          409,
        );
      }

      const unchanged =
        current &&
        current.resolution_action === action &&
        (action === "existing_person"
          ? current.person_id === selectedPersonId
          : action === "create_person"
            ? current.display_name === selectedName
            : true);
      if (unchanged) {
        const response = {
          schemaVersion: "cimmich.immich-person-resolution.v1",
          changed: false,
          cluster: {
            faceCount: cluster.faceCount,
            immichPersonId: sourcePersonId,
            snapshotDigest: cluster.snapshotDigest,
            sourceRevision: cluster.sourceRevision,
          },
          replayed: false,
          resolution: {
            action: current.resolution_action,
            decisionId: current.decision_id,
            personId: current.person_id || null,
            resolutionId: current.resolution_id,
            state: current.resolution_action === "later" ? "later" : "resolved",
          },
          undo: { available: true, decisionId: current.decision_id },
        };
        await tx`
          INSERT INTO immich_person_resolution_command (
            command_id, command_kind, actor_id, subject_id, request_digest,
            response, producer_receipt_id
          ) VALUES (
            ${stableCommandId}, 'resolve', ${actor}, ${sourcePersonId},
            ${requestDigest}, ${tx.json(response)}, ${resolutionReceiptId}
          )
        `;
        return response;
      }

      const [imported] = await tx`
        SELECT immich_person_id
        FROM immich_person_projection
        WHERE source_id = ${normalizedSourceId}
          AND immich_person_id = ${sourcePersonId}
          AND state = 'active'
        FOR SHARE
      `;
      if (imported) {
        throw typedError(
          "IMMICH_PERSON_RESOLUTION_IMPORTED_CONFLICT",
          "This Immich Person has already been imported; use the canonical Person and Face correction flows",
          409,
        );
      }

      let targetPersonId = selectedPersonId;
      let createdPerson = false;
      if (action === "existing_person") {
        const [person] = await tx`
          SELECT person_id FROM person
          WHERE person_id = ${selectedPersonId}
            AND subject_kind = 'person'
            AND status IN ('active','hidden')
            AND cimmich_visibility_person_rank(person_id) <= ${visibleRank}
          FOR SHARE
        `;
        if (!person) {
          throw typedError(
            "IMMICH_PERSON_RESOLUTION_PERSON_UNAVAILABLE",
            "Selected Person is unavailable",
            404,
          );
        }
      } else if (action === "create_person") {
        const collisions = await tx`
          SELECT candidate.person_id
          FROM person candidate
          WHERE candidate.status = 'active'
            AND candidate.subject_kind = 'person'
            AND (lower(candidate.display_name) = lower(${selectedName})
            OR EXISTS (
              SELECT 1 FROM person_alias alias
              WHERE alias.person_id = candidate.person_id
                AND alias.state = 'active' AND lower(alias.label) = lower(${selectedName})
            ))
          ORDER BY candidate.person_id
          FOR SHARE OF candidate
        `;
        if (collisions.length) {
          throw typedError(
            "IMMICH_PERSON_RESOLUTION_NAME_CONFLICT",
            "A Person with this name or alias already exists; choose that Person instead",
            409,
          );
        }
        targetPersonId = `person_${randomUUID().replaceAll("-", "")}`;
        createdPerson = true;
        await tx`
          INSERT INTO person (
            person_id, display_name, status, subject_kind,
            created_by_receipt_id, privacy_class
          ) VALUES (
            ${targetPersonId}, ${selectedName}, 'active', 'person',
            ${resolutionReceiptId}, 'private'
          )
        `;
        const [sort] = await tx`
          SELECT category_id FROM person_category
          WHERE slug = 'sort' AND state = 'active' LIMIT 1 FOR SHARE
        `;
        if (!sort) {
          throw typedError(
            "IMMICH_ONBOARDING_SORT_UNAVAILABLE",
            "The required Sort workflow is unavailable",
            503,
          );
        }
        await tx`
          INSERT INTO person_category_membership_event (
            membership_event_id, person_id, category_id, action, actor_kind,
            actor_id, decision_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${`categoryevent_${randomUUID().replaceAll("-", "")}`},
            ${targetPersonId}, ${sort.category_id}, 'add', 'user', ${actor},
            NULL, ${resolutionReceiptId}, 'private'
          )
        `;
      }

      if (current) {
        await tx`
          UPDATE immich_person_resolution SET state = 'superseded'
          WHERE resolution_id = ${current.resolution_id} AND state = 'active'
        `;
      }
      const resolutionId = `immich_person_resolution_${randomUUID().replaceAll("-", "")}`;
      const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      const decisionAction =
        action === "noise"
          ? "reject"
          : action === "later"
            ? "ignore"
            : action === "unknown"
              ? "classify"
              : "accept";
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id,
          privacy_class
        ) VALUES (
          ${decisionId}, 'immich_person_cluster', ${sourcePersonId},
          ${decisionAction}, 'user', ${actor},
          ${`immich_person_${action}`}, '', ${current?.decision_id || null},
          ${resolutionReceiptId}, 'sensitive-biometric'
        )
      `;
      await tx`
        INSERT INTO immich_person_resolution (
          resolution_id, source_id, immich_person_id, source_revision,
          snapshot_digest, representative_source_asset_id,
          representative_face_id, representative_asset_input_revision,
          face_count, resolution_action, person_id, created_person, state,
          decision_id, supersedes_resolution_id, producer_receipt_id
        ) VALUES (
          ${resolutionId}, ${normalizedSourceId}, ${sourcePersonId},
          ${cluster.sourceRevision}, ${cluster.snapshotDigest},
          ${cluster.representative.sourceAssetId},
          ${cluster.representative.faceId},
          ${cluster.representative.assetInputRevision}, ${cluster.faceCount},
          ${action}, ${targetPersonId}, ${createdPerson}, 'active',
          ${decisionId}, ${current?.resolution_id || null},
          ${resolutionReceiptId}
        )
      `;
      const response = {
        schemaVersion: "cimmich.immich-person-resolution.v1",
        changed: true,
        cluster: {
          faceCount: cluster.faceCount,
          immichPersonId: sourcePersonId,
          snapshotDigest: cluster.snapshotDigest,
          sourceRevision: cluster.sourceRevision,
        },
        createdPerson,
        replayed: false,
        resolution: {
          action,
          decisionId,
          personId: targetPersonId,
          resolutionId,
          state: action === "later" ? "later" : "resolved",
        },
        undo: { available: true, decisionId },
      };
      await tx`
        INSERT INTO immich_person_resolution_command (
          command_id, command_kind, actor_id, subject_id, request_digest,
          response, producer_receipt_id
        ) VALUES (
          ${stableCommandId}, 'resolve', ${actor}, ${sourcePersonId},
          ${requestDigest}, ${tx.json(response)}, ${resolutionReceiptId}
        )
      `;
      return response;
    });
  };

  const undoPersonClusterResolution = async ({
    actorId,
    commandId: inputCommandId,
    decisionId: inputDecisionId,
    scope: inputScope,
    viewingMode = "Standard",
  }) => {
    const actor = boundedId(actorId, "actorId", 120);
    const stableCommandId = commandId(inputCommandId);
    const decisionId = boundedId(inputDecisionId, "decisionId", 120);
    const scope = normalizeImmichOnboardingScope(inputScope);
    const requestDigest = digest({ decisionId, scope, viewingMode });
    const [existingCommand] = await sql`
      SELECT actor_id, request_digest, response
      FROM immich_person_resolution_command
      WHERE command_id = ${stableCommandId}
    `;
    if (existingCommand) {
      if (
        existingCommand.actor_id !== actor ||
        existingCommand.request_digest !== requestDigest
      ) {
        throw typedError(
          "IMMICH_PERSON_RESOLUTION_COMMAND_CONFLICT",
          "commandId was already used for a different cluster Undo",
          409,
        );
      }
      return { ...existingCommand.response, replayed: true };
    }
    const [target] = await sql`
      SELECT * FROM immich_person_resolution WHERE decision_id = ${decisionId}
    `;
    if (!target) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_UNDO_NOT_FOUND",
        "Cluster decision was not found",
        404,
      );
    }
    const { clusters } = await scanUnlabelledClusters({
      inputScope: scope,
      viewingMode,
    });
    const cluster = clusters.find(
      (candidate) => candidate.immichPersonId === target.immich_person_id,
    );
    if (!cluster) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_NOT_VISIBLE",
        "Immich Person cluster is unavailable in the selected visible scope",
        404,
      );
    }
    if (
      target.source_revision !== cluster.sourceRevision ||
      target.snapshot_digest !== cluster.snapshotDigest
    ) {
      throw typedError(
        "IMMICH_PERSON_RESOLUTION_STALE",
        "Immich Person cluster changed after this decision",
        409,
      );
    }

    return sql.begin(async (tx) => {
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`immich-person-resolution:${normalizedSourceId}:${target.immich_person_id}`}, 68)
        )
      `;
      const [current] = await tx`
        SELECT * FROM immich_person_resolution
        WHERE decision_id = ${decisionId} FOR UPDATE
      `;
      if (!current || current.state !== "active") {
        throw typedError(
          "IMMICH_PERSON_RESOLUTION_UNDO_STALE",
          "Cluster decision is no longer current",
          409,
        );
      }
      const [projectionDependency] = await tx`
        SELECT 1 AS present FROM immich_face_projection
        WHERE source_id = ${normalizedSourceId}
          AND resolution_decision_id = ${current.decision_id}
          AND state = 'active'
        LIMIT 1
      `;
      if (projectionDependency) {
        throw typedError(
          "IMMICH_PERSON_RESOLUTION_UNDO_DEPENDENCY",
          "Imported Face truth depends on this cluster decision",
          409,
        );
      }
      let restored = null;
      let prior = null;
      if (current.supersedes_resolution_id) {
        [prior] = await tx`
          SELECT * FROM immich_person_resolution
          WHERE resolution_id = ${current.supersedes_resolution_id}
          FOR SHARE
        `;
      }
      if (current.created_person) {
        const [person] = await tx`
          SELECT person_id, status, current_revision,
            EXISTS (
              SELECT 1 FROM identity_claim claim
              WHERE claim.person_id = person.person_id
                AND claim.state IN ('accepted','candidate')
            ) AS has_identity_dependency
          FROM person WHERE person_id = ${current.person_id} FOR UPDATE
        `;
        if (
          !person ||
          person.status !== "active" ||
          Number(person.current_revision) !== 1 ||
          person.has_identity_dependency
        ) {
          throw typedError(
            "IMMICH_PERSON_RESOLUTION_UNDO_STALE",
            "The Person created by this decision now has dependent state",
            409,
          );
        }
        await tx`
          UPDATE person SET status = 'purged', current_revision = current_revision + 1
          WHERE person_id = ${current.person_id} AND status = 'active'
        `;
      }
      await tx`
        UPDATE immich_person_resolution SET state = 'reverted'
        WHERE resolution_id = ${current.resolution_id} AND state = 'active'
      `;
      const undoDecisionId = `decision_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id,
          privacy_class
        ) VALUES (
          ${undoDecisionId}, 'immich_person_cluster',
          ${current.immich_person_id}, 'undo', 'user', ${actor},
          'immich_person_resolution_undo', '', ${current.decision_id},
          ${resolutionReceiptId}, 'sensitive-biometric'
        )
      `;
      if (prior) {
        if (prior.created_person) {
          const [person] = await tx`
            SELECT status, current_revision FROM person
            WHERE person_id = ${prior.person_id} FOR UPDATE
          `;
          if (
            !person ||
            person.status !== "active" ||
            Number(person.current_revision) !== 1
          ) {
            throw typedError(
              "IMMICH_PERSON_RESOLUTION_UNDO_STALE",
              "The prior created Person cannot be restored safely",
              409,
            );
          }
        }
        const restoredResolutionId = `immich_person_resolution_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO immich_person_resolution (
            resolution_id, source_id, immich_person_id, source_revision,
            snapshot_digest, representative_source_asset_id,
            representative_face_id, representative_asset_input_revision,
            face_count, resolution_action, person_id, created_person, state,
            decision_id, supersedes_resolution_id, producer_receipt_id
          ) VALUES (
            ${restoredResolutionId}, ${normalizedSourceId},
            ${current.immich_person_id}, ${cluster.sourceRevision},
            ${cluster.snapshotDigest}, ${cluster.representative.sourceAssetId},
            ${cluster.representative.faceId},
            ${cluster.representative.assetInputRevision}, ${cluster.faceCount},
            ${prior.resolution_action}, ${prior.person_id},
            ${prior.created_person}, 'active', ${undoDecisionId},
            ${current.resolution_id}, ${resolutionReceiptId}
          )
        `;
        restored = {
          action: prior.resolution_action,
          decisionId: undoDecisionId,
          personId: prior.person_id || null,
          resolutionId: restoredResolutionId,
          state: prior.resolution_action === "later" ? "later" : "resolved",
        };
      }
      const response = {
        schemaVersion: "cimmich.immich-person-resolution.v1",
        changed: true,
        decisionId: undoDecisionId,
        immichPersonId: current.immich_person_id,
        replayed: false,
        resolution: restored,
        state: "reverted",
      };
      await tx`
        INSERT INTO immich_person_resolution_command (
          command_id, command_kind, actor_id, subject_id, request_digest,
          response, producer_receipt_id
        ) VALUES (
          ${stableCommandId}, 'undo', ${actor}, ${decisionId},
          ${requestDigest}, ${tx.json(response)}, ${resolutionReceiptId}
        )
      `;
      return response;
    });
  };

  const importCurrent = async ({
    actorId,
    commandId: inputCommandId,
    previewDigest,
    scope: inputScope,
    viewingMode = "Standard",
  }) => {
    const actor = boundedId(actorId, "actorId", 120);
    const stableCommandId = commandId(inputCommandId);
    const scope = normalizeImmichOnboardingScope(inputScope);
    enforceViewingMode(scope, viewingMode);
    if (!/^[0-9a-f]{64}$/.test(String(previewDigest || ""))) {
      throw typedError(
        "IMMICH_ONBOARDING_PREVIEW_INVALID",
        "A current setup preview digest is required",
      );
    }
    const scanned = await scanSource({ companion, scope });
    if (scanned.preview.previewDigest !== previewDigest) {
      throw typedError(
        "IMMICH_ONBOARDING_PREVIEW_STALE",
        "Immich changed after preview; review the refreshed counts before import",
        409,
      );
    }
    const unlabelledClusters = scope.importPeople
      ? projectUnlabelledPersonClusters(scanned)
      : [];
    const resolutionRows = unlabelledClusters.length
      ? await sql`
          SELECT resolution.immich_person_id, resolution.source_revision,
            resolution.snapshot_digest, resolution.resolution_action,
            resolution.person_id, resolution.decision_id, person.display_name
          FROM immich_person_resolution resolution
          LEFT JOIN current_person person ON person.person_id = resolution.person_id
          WHERE resolution.source_id = ${normalizedSourceId}
            AND resolution.immich_person_id = ANY(${unlabelledClusters.map((cluster) => cluster.immichPersonId)})
            AND resolution.state = 'active'
        `
      : [];
    const resolutionByPerson = new Map(
      resolutionRows.map((row) => [row.immich_person_id, row]),
    );
    const unresolvedClusters = unlabelledClusters.filter((cluster) => {
      const resolution = resolutionByPerson.get(cluster.immichPersonId);
      return (
        !resolution ||
        resolution.resolution_action === "later" ||
        resolution.source_revision !== cluster.sourceRevision ||
        resolution.snapshot_digest !== cluster.snapshotDigest ||
        (new Set(["existing_person", "create_person"]).has(
          resolution.resolution_action,
        ) &&
          (!resolution.person_id || !resolution.display_name))
      );
    });
    if (scope.importPeople && unresolvedClusters.length > 0) {
      throw typedError(
        "IMMICH_ONBOARDING_PERSON_LABEL_REQUIRED",
        "Assigned Immich Faces require explicit owner resolution before identity import",
        409,
        {
          unlabelledAssignedFaces: unresolvedClusters.reduce(
            (count, cluster) => count + cluster.faceCount,
            0,
          ),
          unlabelledPeople: unresolvedClusters.length,
        },
      );
    }
    const scopeDigest = digest(scope);
    const requestDigest = digest({ previewDigest, scope, viewingMode });
    let [run] = await sql`
      SELECT * FROM immich_onboarding_run WHERE command_id = ${stableCommandId}
    `;
    if (run) {
      if (
        run.actor_id !== actor ||
        run.scope_digest !== scopeDigest ||
        run.preview_digest !== previewDigest ||
        run.progress?.requestDigest !== requestDigest
      ) {
        throw typedError(
          "IMMICH_ONBOARDING_COMMAND_CONFLICT",
          "commandId was already used for a different setup import",
          409,
        );
      }
      if (run.principal_id !== scanned.preview.connection.principalId) {
        throw typedError(
          "IMMICH_ONBOARDING_PRINCIPAL_CHANGED",
          "Immich principal changed during setup",
          409,
        );
      }
      if (run.state === "completed") return { ...run.result, replayed: true };
    } else {
      const status = await companion.status();
      const runId = `immich_onboarding_${randomUUID().replaceAll("-", "")}`;
      const currentAssets = scanned.assets.length
        ? await sql`
            SELECT immich_asset_id, input_revision, state
            FROM immich_asset_projection
            WHERE source_id = ${normalizedSourceId}
              AND immich_asset_id = ANY(${scanned.assets.map((asset) => asset.immichAssetId)})
          `
        : [];
      const currentAssetMap = new Map(
        currentAssets.map((asset) => [asset.immich_asset_id, asset]),
      );
      const faceAssetRevisions = new Map();
      if (scope.importPeople) {
        for (const asset of scanned.assets) {
          for (const face of scanned.facesByAsset.get(asset.immichAssetId) ||
            []) {
            faceAssetRevisions.set(face.id, asset.inputRevision);
          }
        }
      }
      const scannedFaces = scope.importPeople
        ? [...scanned.facesByAsset.values()].flat()
        : [];
      const currentFaces = scannedFaces.length
        ? await sql`
            SELECT immich_face_id, source_revision, asset_input_revision, state
            FROM immich_face_projection
            WHERE source_id = ${normalizedSourceId}
              AND immich_face_id = ANY(${scannedFaces.map((face) => face.id)})
          `
        : [];
      const currentFaceMap = new Map(
        currentFaces.map((face) => [face.immich_face_id, face]),
      );
      const scannedPeople = new Map();
      for (const face of scannedFaces) {
        if (face.person) scannedPeople.set(face.person.id, face.person);
      }
      const currentPeople = scannedPeople.size
        ? await sql`
            SELECT immich_person_id, source_revision, state
            FROM immich_person_projection
            WHERE source_id = ${normalizedSourceId}
              AND immich_person_id = ANY(${[...scannedPeople.keys()]})
          `
        : [];
      const currentPersonMap = new Map(
        currentPeople.map((person) => [person.immich_person_id, person]),
      );
      const assetsCurrent = scanned.assets.every((asset) => {
        const current = currentAssetMap.get(asset.immichAssetId);
        return (
          current?.state === "active" &&
          current.input_revision === asset.inputRevision
        );
      });
      const facesCurrent = scannedFaces.every((face) => {
        const current = currentFaceMap.get(face.id);
        return (
          current?.state === "active" &&
          current.source_revision === face.sourceRevision &&
          current.asset_input_revision === faceAssetRevisions.get(face.id)
        );
      });
      const peopleCurrent = [...scannedPeople.values()].every((person) => {
        const anonymousResolution = !person.name
          ? resolutionByPerson.get(person.id)
          : null;
        if (
          anonymousResolution &&
          ["unknown", "noise"].includes(anonymousResolution.resolution_action)
        ) {
          return true;
        }
        const current = currentPersonMap.get(person.id);
        return (
          current?.state === "active" &&
          current.source_revision === person.sourceRevision
        );
      });
      if (
        scanned.assets.length > 0 &&
        assetsCurrent &&
        facesCurrent &&
        peopleCurrent
      ) {
        const response = {
          schemaVersion: IMMICH_ONBOARDING_SCHEMA_VERSION,
          changed: false,
          commandId: stableCommandId,
          import: {
            assignedFaces: scannedFaces.filter((face) => face.personId).length,
          },
          next: {
            action:
              scope.providerMode === "configured"
                ? "resume_provider_analysis"
                : "configure_provider_or_build_when_ready",
            automaticIdentityAuthority: "none",
            sourcePackActivation: "not_performed",
          },
          replayed: false,
          runId,
          state: "no_change",
        };
        await sql`
          INSERT INTO immich_onboarding_run (
            run_id, command_id, actor_id, source_id, principal_id,
            immich_version, scope, scope_digest, preview_digest, state,
            progress, result, producer_receipt_id, completed_at
          ) VALUES (
            ${runId}, ${stableCommandId}, ${actor}, ${normalizedSourceId},
            ${status.principal.userId}, ${status.immichVersion}, ${sql.json(scope)},
            ${scopeDigest}, ${previewDigest}, 'completed',
            ${sql.json({ processedAssets: 0, requestDigest })}, ${sql.json(response)},
            ${receiptId}, now()
          )
        `;
        return response;
      }
      [run] = await sql`
        INSERT INTO immich_onboarding_run (
          run_id, command_id, actor_id, source_id, principal_id,
          immich_version, scope, scope_digest, preview_digest, state,
          progress, producer_receipt_id
        ) VALUES (
          ${runId}, ${stableCommandId}, ${actor}, ${normalizedSourceId},
          ${status.principal.userId}, ${status.immichVersion}, ${sql.json(scope)},
          ${scopeDigest}, ${previewDigest}, 'importing',
          ${sql.json({ processedAssets: 0, requestDigest })}, ${receiptId}
        ) RETURNING *
      `;
    }

    if (run.state === "conflict") {
      throw typedError(
        "IMMICH_ONBOARDING_IMPORT_CONFLICT",
        "The setup import cannot resume until its source conflict is resolved",
        409,
      );
    }
    [run] = await sql`
      UPDATE immich_onboarding_run SET state = 'importing',
        progress = progress - 'lastErrorCode', updated_at = now()
      WHERE run_id = ${run.run_id}
        AND state IN ('importing','interrupted')
      RETURNING *
    `;
    if (!run) {
      throw typedError(
        "IMMICH_ONBOARDING_IMPORT_STATE_INVALID",
        "The setup import is not in a resumable state",
        409,
      );
    }

    const status = await companion.status();
    if (status.principal.userId !== run.principal_id) {
      await sql`
        UPDATE immich_onboarding_run SET state = 'conflict', updated_at = now()
        WHERE run_id = ${run.run_id}
      `;
      throw typedError(
        "IMMICH_ONBOARDING_PRINCIPAL_CHANGED",
        "Immich principal changed during setup",
        409,
      );
    }

    try {
      const inventory = await immichInventory.synchronize({
        visibilities: scope.visibilities,
      });
      const duplicateSourceNames = duplicateImmichPersonNames(
        [...scanned.facesByAsset.values()].flat(),
      );
      const counters = {
        ambiguous: 0,
        assignedFaces: 0,
        createdPeople: 0,
        exactProviderBinds: 0,
        importedSourceFaces: 0,
        personConflicts: 0,
        reviewItems: 0,
        unassignedFaces: 0,
      };

      for (const asset of scanned.assets) {
        const faces = scope.importPeople
          ? scanned.facesByAsset.get(asset.immichAssetId) || []
          : [];
        if (!faces.length) continue;
        await sql.begin(async (tx) => {
          const [projection] = await tx`
          SELECT cimmich_asset_id, input_revision, state
          FROM immich_asset_projection
          WHERE source_id = ${normalizedSourceId}
            AND immich_asset_id = ${asset.immichAssetId}
          FOR SHARE
        `;
          if (
            !projection ||
            projection.state !== "active" ||
            projection.input_revision !== asset.inputRevision
          ) {
            for (const face of faces) {
              await recordReviewItem(tx, {
                assetId: projection?.cimmich_asset_id || null,
                faceId: face.id,
                reason: "stale_asset_revision",
                runId: run.run_id,
                sourceId: normalizedSourceId,
              });
              counters.reviewItems += 1;
            }
            return;
          }
          const providerFaces = await providerFacesForAsset(tx, {
            assetId: projection.cimmich_asset_id,
            inputRevision: asset.inputRevision,
          });
          const matches = reconcileImmichFacesByGeometry({
            providerFaces,
            sourceFaces: faces.map((face) => ({ box: face.box, id: face.id })),
          });
          const usedProviderFaces = new Set();
          for (const face of faces) {
            const [prior] = await tx`
            SELECT source_revision, asset_input_revision, state
            FROM immich_face_projection
            WHERE source_id = ${normalizedSourceId} AND immich_face_id = ${face.id}
          `;
            if (
              prior?.state === "active" &&
              prior.source_revision === face.sourceRevision &&
              prior.asset_input_revision === asset.inputRevision
            ) {
              continue;
            }
            if (prior) {
              await recordReviewItem(tx, {
                assetId: projection.cimmich_asset_id,
                faceId: face.id,
                reason: "stale_asset_revision",
                runId: run.run_id,
                sourceId: normalizedSourceId,
              });
              counters.reviewItems += 1;
              continue;
            }
            if (!face.person) {
              counters.unassignedFaces += 1;
              await tx`
              INSERT INTO immich_face_projection (
                source_id, immich_face_id, immich_asset_id, cimmich_asset_id,
                asset_input_revision, source_revision, box_x, box_y, box_w, box_h,
                reconciliation_state, state, run_id, producer_receipt_id
              ) VALUES (
                ${normalizedSourceId}, ${face.id}, ${asset.immichAssetId},
                ${projection.cimmich_asset_id}, ${asset.inputRevision},
                ${face.sourceRevision}, ${face.box.x}, ${face.box.y}, ${face.box.w},
                ${face.box.h}, 'unassigned', 'active', ${run.run_id}, ${receiptId}
              ) ON CONFLICT (source_id, immich_face_id) DO NOTHING
            `;
              await recordReviewItem(tx, {
                assetId: projection.cimmich_asset_id,
                faceId: face.id,
                reason: "source_face_unassigned",
                runId: run.run_id,
                sourceId: normalizedSourceId,
              });
              counters.reviewItems += 1;
              continue;
            }
            counters.assignedFaces += 1;
            const ownerResolution = face.person.name
              ? null
              : resolutionByPerson.get(face.person.id);
            if (
              ownerResolution &&
              ["unknown", "noise"].includes(ownerResolution.resolution_action)
            ) {
              const sourceFaceId =
                ownerResolution.resolution_action === "unknown"
                  ? await createImportedObservation(tx, {
                      assetId: projection.cimmich_asset_id,
                      face,
                      sourceId: normalizedSourceId,
                    })
                  : null;
              if (sourceFaceId) counters.importedSourceFaces += 1;
              await tx`
              INSERT INTO immich_face_projection (
                source_id, immich_face_id, immich_asset_id, cimmich_asset_id,
                immich_person_id, cimmich_face_id, source_face_id,
                resolution_decision_id,
                asset_input_revision, source_revision, box_x, box_y, box_w, box_h,
                reconciliation_state, state, run_id, producer_receipt_id
              ) VALUES (
                ${normalizedSourceId}, ${face.id}, ${asset.immichAssetId},
                ${projection.cimmich_asset_id}, ${face.person.id},
                ${sourceFaceId}, ${sourceFaceId}, ${ownerResolution.decision_id},
                ${asset.inputRevision}, ${face.sourceRevision}, ${face.box.x},
                ${face.box.y}, ${face.box.w}, ${face.box.h},
                ${ownerResolution.resolution_action === "unknown" ? "owner_unknown" : "owner_noise"},
                'active', ${run.run_id}, ${receiptId}
              ) ON CONFLICT (source_id, immich_face_id) DO NOTHING
            `;
              continue;
            }
            let subject;
            if (ownerResolution) {
              await tx`
              INSERT INTO immich_person_projection (
                source_id, immich_person_id, person_id, source_name,
                source_revision, state, producer_receipt_id
              ) VALUES (
                ${normalizedSourceId}, ${face.person.id},
                ${ownerResolution.person_id}, ${ownerResolution.display_name},
                ${face.person.sourceRevision}, 'active', ${receiptId}
              ) ON CONFLICT (source_id, immich_person_id) DO NOTHING
            `;
              subject = {
                personId: ownerResolution.person_id,
                reused: true,
              };
            } else {
              subject = await loadOrCreatePerson(tx, {
                actorId: actor,
                person: face.person,
                sourceId: normalizedSourceId,
                sourceNameCollision: duplicateSourceNames.has(
                  normalizedName(face.person.name).toLocaleLowerCase("en"),
                ),
              });
            }
            if (subject.conflict) {
              counters.personConflicts += 1;
              await tx`
              INSERT INTO immich_face_projection (
                source_id, immich_face_id, immich_asset_id, cimmich_asset_id,
                immich_person_id, asset_input_revision, source_revision,
                box_x, box_y, box_w, box_h, reconciliation_state, state,
                run_id, producer_receipt_id
              ) VALUES (
                ${normalizedSourceId}, ${face.id}, ${asset.immichAssetId},
                ${projection.cimmich_asset_id}, ${face.person.id},
                ${asset.inputRevision}, ${face.sourceRevision}, ${face.box.x},
                ${face.box.y}, ${face.box.w}, ${face.box.h}, 'person_conflict',
                'active', ${run.run_id}, ${receiptId}
              ) ON CONFLICT (source_id, immich_face_id) DO NOTHING
            `;
              await recordReviewItem(tx, {
                assetId: projection.cimmich_asset_id,
                faceId: face.id,
                reason: subject.reason || "duplicate_person_name",
                runId: run.run_id,
                sourceId: normalizedSourceId,
              });
              counters.reviewItems += 1;
              continue;
            }
            if (!subject.reused) counters.createdPeople += 1;
            const match = matches.get(face.id);
            let cimmichFaceId;
            let providerFaceId = null;
            let state;
            if (match?.state === "exact") {
              cimmichFaceId = match.providerFaceId;
              providerFaceId = match.providerFaceId;
              state = "exact_provider_bind";
              usedProviderFaces.add(match.providerFaceId);
            } else {
              cimmichFaceId = await createImportedObservation(tx, {
                assetId: projection.cimmich_asset_id,
                face,
                sourceId: normalizedSourceId,
              });
              counters.importedSourceFaces += 1;
              state =
                match?.state === "ambiguous"
                  ? "ambiguous_provider_bind"
                  : "missing_provider_face";
              await recordReviewItem(tx, {
                assetId: projection.cimmich_asset_id,
                faceId: face.id,
                reason: match?.reason || "missing_provider_face",
                runId: run.run_id,
                sourceId: normalizedSourceId,
              });
              counters.reviewItems += 1;
              if (match?.state === "ambiguous") counters.ambiguous += 1;
            }
            const accepted = await acceptImportedIdentity(tx, {
              actorId: actor,
              face,
              faceId: cimmichFaceId,
              personId: subject.personId,
              sourceId: normalizedSourceId,
            });
            if (accepted.conflict) {
              if (providerFaceId) {
                cimmichFaceId = await createImportedObservation(tx, {
                  assetId: projection.cimmich_asset_id,
                  face,
                  sourceId: normalizedSourceId,
                });
                const fallback = await acceptImportedIdentity(tx, {
                  actorId: actor,
                  face,
                  faceId: cimmichFaceId,
                  personId: subject.personId,
                  sourceId: normalizedSourceId,
                });
                providerFaceId = null;
                state = "identity_conflict";
                await recordReviewItem(tx, {
                  assetId: projection.cimmich_asset_id,
                  faceId: face.id,
                  reason: "provider_identity_conflict",
                  runId: run.run_id,
                  sourceId: normalizedSourceId,
                });
                counters.reviewItems += 1;
                Object.assign(accepted, fallback);
              } else {
                throw new Error(
                  "Imported Face identity conflicts with its stable source observation",
                );
              }
            }
            if (state === "exact_provider_bind")
              counters.exactProviderBinds += 1;
            await tx`
            INSERT INTO immich_face_projection (
              source_id, immich_face_id, immich_asset_id, cimmich_asset_id,
              immich_person_id, person_id, cimmich_face_id, source_face_id,
              provider_face_id, identity_claim_id, decision_id,
              asset_input_revision, source_revision, box_x, box_y, box_w, box_h,
              reconciliation_state, state, run_id, producer_receipt_id
            ) VALUES (
              ${normalizedSourceId}, ${face.id}, ${asset.immichAssetId},
              ${projection.cimmich_asset_id}, ${face.person.id}, ${subject.personId},
              ${cimmichFaceId}, ${providerFaceId ? null : cimmichFaceId},
              ${providerFaceId}, ${accepted.claimId}, ${accepted.decisionId},
              ${asset.inputRevision}, ${face.sourceRevision}, ${face.box.x},
              ${face.box.y}, ${face.box.w}, ${face.box.h}, ${state}, 'active',
              ${run.run_id}, ${receiptId}
            ) ON CONFLICT (source_id, immich_face_id) DO NOTHING
          `;
          }
          for (const provider of providerFaces) {
            if (!usedProviderFaces.has(provider.id)) {
              await recordReviewItem(tx, {
                assetId: projection.cimmich_asset_id,
                faceId: null,
                reason: "extra_provider_face",
                runId: run.run_id,
                sourceId: normalizedSourceId,
              });
              counters.reviewItems += 1;
            }
          }
        });
        await sql`
        UPDATE immich_onboarding_run SET
          progress = jsonb_set(progress, '{processedAssets}',
            to_jsonb(coalesce((progress->>'processedAssets')::int, 0) + 1)),
          updated_at = now()
        WHERE run_id = ${run.run_id}
      `;
      }

      const [finalCounts] = await sql`
      SELECT
        count(*) FILTER (WHERE face.immich_person_id IS NOT NULL)::int AS assigned_faces,
        count(*) FILTER (WHERE face.reconciliation_state = 'exact_provider_bind')::int AS exact_provider_binds,
        count(*) FILTER (WHERE face.reconciliation_state = 'ambiguous_provider_bind')::int AS ambiguous,
        count(*) FILTER (WHERE face.reconciliation_state = 'unassigned')::int AS unassigned_faces,
        count(*) FILTER (WHERE face.source_face_id IS NOT NULL)::int AS imported_source_faces,
        count(*) FILTER (WHERE face.reconciliation_state = 'person_conflict')::int AS person_conflicts,
        count(DISTINCT face.person_id) FILTER (WHERE face.person_id IS NOT NULL)::int AS projected_people,
        (SELECT count(*)::int FROM immich_onboarding_review_item review
          WHERE review.run_id = ${run.run_id} AND review.state = 'open') AS review_items
      FROM immich_face_projection face
      WHERE face.run_id = ${run.run_id} AND face.state = 'active'
    `;
      const result = {
        schemaVersion: IMMICH_ONBOARDING_SCHEMA_VERSION,
        changed: true,
        commandId: stableCommandId,
        import: {
          ambiguous: Number(finalCounts?.ambiguous || 0),
          assignedFaces: Number(finalCounts?.assigned_faces || 0),
          exactProviderBinds: Number(finalCounts?.exact_provider_binds || 0),
          importedSourceFaces: Number(finalCounts?.imported_source_faces || 0),
          personConflicts: Number(finalCounts?.person_conflicts || 0),
          projectedPeople: Number(finalCounts?.projected_people || 0),
          reviewItems: Number(finalCounts?.review_items || 0),
          unassignedFaces: Number(finalCounts?.unassigned_faces || 0),
        },
        inventory: {
          activeAssets: inventory.source?.activeAssets ?? scanned.assets.length,
          runId: inventory.run?.runId || null,
        },
        next: {
          action:
            scope.providerMode === "configured"
              ? "resume_provider_analysis"
              : "configure_provider_or_build_when_ready",
          automaticIdentityAuthority: "none",
          sourcePackActivation: "not_performed",
        },
        replayed: false,
        runId: run.run_id,
        state:
          Number(finalCounts?.review_items || 0) > 0
            ? "completed_with_review"
            : "completed",
      };
      await sql`
        UPDATE immich_onboarding_run SET state = 'completed', result = ${sql.json(result)},
          completed_at = now(), updated_at = now()
        WHERE run_id = ${run.run_id} AND state = 'importing'
      `;
      return result;
    } catch {
      await sql`
        UPDATE immich_onboarding_run SET state = 'interrupted',
          progress = progress || ${sql.json({
            lastErrorCode: "IMMICH_ONBOARDING_IMPORT_INTERRUPTED",
          })},
          updated_at = now()
        WHERE run_id = ${run.run_id} AND state = 'importing'
      `;
      throw typedError(
        "IMMICH_ONBOARDING_IMPORT_INTERRUPTED",
        "The setup import was interrupted and can be resumed with the same command",
        503,
        { resume: "same_command" },
      );
    }
  };

  const status = async () => {
    const connection = await verifiedCompanionStatus(companion);
    const [latest] = await sql`
      SELECT command_id, run_id, state, scope, preview_digest, progress, result,
        started_at, updated_at, completed_at
      FROM immich_onboarding_run
      WHERE source_id = ${normalizedSourceId}
      ORDER BY started_at DESC, run_id DESC LIMIT 1
    `;
    return {
      schemaVersion: IMMICH_ONBOARDING_SCHEMA_VERSION,
      connection,
      latestRun: latest
        ? {
            commandId: latest.command_id,
            completedAt: latest.completed_at || null,
            previewDigest: latest.preview_digest,
            progress: latest.progress,
            result: latest.result || null,
            runId: latest.run_id,
            scope: latest.scope,
            startedAt: latest.started_at,
            state: latest.state,
            updatedAt: latest.updated_at,
          }
        : null,
      next:
        connection.state === "ready"
          ? latest?.state === "completed"
            ? "review_summary"
            : new Set(["importing", "interrupted"]).has(latest?.state)
              ? "resume_import"
              : latest?.state === "conflict"
                ? "resolve_conflict"
                : "preview"
          : "connect",
    };
  };

  return Object.freeze({
    connect,
    importCurrent,
    personClusters,
    preview,
    resolvePersonCluster,
    status,
    undoPersonClusterResolution,
  });
};
