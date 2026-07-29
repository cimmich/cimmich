import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const xmpSidecarImportVersion = "cimmich.xmp-sidecar-import.v1";
export const xmpSidecarReaderVersion = "cimmich.xmp-sidecar-reader.v3";
export const xmpSidecarImportConfigDigest = createHash("sha256")
  .update(
    JSON.stringify({
      duplicateIouFloor: 0.85,
      namePolicy: "exact-or-trailing-private-tier-1-2",
      reader: xmpSidecarReaderVersion,
      schemaVersion: xmpSidecarImportVersion,
    }),
  )
  .digest("hex");

const receiptId = "receipt_cimmich_xmp_sidecar_face_import_v1";
const hex64 = /^[0-9a-f]{64}$/;
const cleanText = (value, label, maximum = 500) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw Object.assign(new Error(`XMP sidecar ${label} is invalid`), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  return normalized;
};
const requiredDigest = (value, label) => {
  const normalized = String(value || "");
  if (!hex64.test(normalized)) {
    throw Object.assign(new Error(`XMP sidecar ${label} is invalid`), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  return normalized;
};
const digest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string"
        ? value
        : JSON.stringify(value, Object.keys(value).sort()),
    )
    .digest("hex");
const stableId = (prefix, ...parts) =>
  `${prefix}${createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 40)}`;

export const normalizeXmpPersonName = (value) => {
  const rawName = cleanText(value, "face name");
  const normalizedName = rawName.replace(/\s+[12]$/, "").trim();
  return Object.freeze({
    normalization:
      normalizedName === rawName
        ? "exact_trimmed"
        : "strip_trailing_private_tier_hint",
    normalizedName,
    rawName,
  });
};

const numeric = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw Object.assign(new Error(`XMP sidecar ${label} is invalid`), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  return number;
};

const normalizeBox = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("XMP sidecar face box is invalid"), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  const box = Object.freeze({
    h: numeric(value.h, "face box height"),
    w: numeric(value.w, "face box width"),
    x: numeric(value.x, "face box x"),
    y: numeric(value.y, "face box y"),
  });
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.w <= 0 ||
    box.h <= 0 ||
    box.x + box.w > 1.000001 ||
    box.y + box.h > 1.000001
  ) {
    throw Object.assign(new Error("XMP sidecar face box is out of bounds"), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  return box;
};

const exactKeys = (value, keys, label) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\u001f") !==
      [...keys].sort().join("\u001f")
  ) {
    throw Object.assign(new Error(`XMP sidecar ${label} shape is invalid`), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
};

const normalizeXmpSidecarPacket = (value) => {
  exactKeys(
    value,
    [
      "byteLength",
      "contentDigest",
      "faces",
      "kind",
      "sidecarDigest",
      "sourceLocatorDigest",
    ],
    "asset packet",
  );
  if (value.kind !== "asset" || !Array.isArray(value.faces)) {
    throw Object.assign(new Error("XMP sidecar asset packet is invalid"), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  const byteLength = Number(value.byteLength);
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    value.faces.length < 1 ||
    value.faces.length > 1000
  ) {
    throw Object.assign(new Error("XMP sidecar asset bounds are invalid"), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  const faces = value.faces.map((face) => {
    exactKeys(face, ["box", "rawName", "regionKey", "source"], "face");
    if (!["mwg-rs", "microsoft-photo"].includes(face.source)) {
      throw Object.assign(new Error("XMP sidecar face source is invalid"), {
        code: "XMP_SIDECAR_INPUT_INVALID",
      });
    }
    const name = normalizeXmpPersonName(face.rawName);
    return Object.freeze({
      box: normalizeBox(face.box),
      ...name,
      regionKey: requiredDigest(face.regionKey, "region key"),
      source: face.source,
    });
  });
  if (new Set(faces.map((face) => face.regionKey)).size !== faces.length) {
    throw Object.assign(new Error("XMP sidecar region keys are duplicated"), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  return Object.freeze({
    byteLength,
    contentDigest: requiredDigest(value.contentDigest, "content digest"),
    faces: Object.freeze(faces),
    sidecarDigest: requiredDigest(value.sidecarDigest, "sidecar digest"),
    sourceLocatorDigest: requiredDigest(
      value.sourceLocatorDigest,
      "source locator digest",
    ),
  });
};

const intersectionOverUnion = (left, right) => {
  const x1 = Math.max(Number(left.box_x), right.x);
  const y1 = Math.max(Number(left.box_y), right.y);
  const x2 = Math.min(Number(left.box_x) + Number(left.box_w), right.x + right.w);
  const y2 = Math.min(Number(left.box_y) + Number(left.box_h), right.y + right.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union =
    Number(left.box_w) * Number(left.box_h) +
    right.w * right.h -
    intersection;
  return union > 0 ? intersection / union : 0;
};

const resolveContent = async (sql, contentDigest) => {
  const rows = await sql`
    SELECT DISTINCT fingerprint.content_id, link.asset_id
    FROM media_content_fingerprint fingerprint
    JOIN asset_content_link link ON link.content_id = fingerprint.content_id
      AND link.state = 'active' AND link.link_kind = 'exact_bytes'
    JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
    WHERE fingerprint.hash_algorithm = 'sha256'
      AND fingerprint.content_digest = ${contentDigest}
      AND fingerprint.verification = 'byte_verified'
    ORDER BY link.asset_id
  `;
  if (rows.length === 0) return null;
  if (new Set(rows.map((row) => row.asset_id)).size !== 1) {
    throw Object.assign(new Error("XMP content identity is ambiguous"), {
      code: "XMP_CONTENT_IDENTITY_AMBIGUOUS",
    });
  }
  return rows[0];
};

const resolvePerson = async (sql, normalizedName) => {
  const rows = await sql`
    SELECT DISTINCT person.person_id, person.display_name
    FROM current_person person
    WHERE person.subject_kind = 'person'
      AND (
        lower(person.display_name) = lower(${normalizedName})
        OR EXISTS (
          SELECT 1 FROM unnest(person.aliases) alias
          WHERE lower(alias) = lower(${normalizedName})
        )
      )
    ORDER BY person.person_id
  `;
  return rows;
};

const findExistingFace = async (sql, { assetId, box, personId }) => {
  const rows = await sql`
    SELECT face.face_id, face.box_x, face.box_y, face.box_w, face.box_h,
      identity.identity_claim_id
    FROM face_observation face
    JOIN current_face_identity identity ON identity.face_id = face.face_id
      AND identity.person_id = ${personId} AND identity.state = 'accepted'
    WHERE face.asset_id = ${assetId} AND face.state = 'valid'
    ORDER BY face.face_id
  `;
  return rows.filter((row) => intersectionOverUnion(row, box) >= 0.85);
};

const sameNumber = (left, right) =>
  Math.abs(Number(left) - Number(right)) <= 0.000000001;

const projectOutcome = ({
  content,
  evidenceId,
  existingFace,
  face,
  forcedResolutionState = null,
  people,
}) => {
  const person = people.length === 1 ? people[0] : null;
  const faceId = existingFace?.face_id || stableId("face_xmp_", evidenceId);
  const resolutionState =
    forcedResolutionState ||
    (people.length > 1
      ? "ambiguous_name"
      : !person
        ? "created_unresolved"
        : existingFace
          ? "reused_mapped"
          : "created_mapped");
  const identityClaimId = ["created_mapped", "reused_mapped"].includes(
    resolutionState,
  )
    ? existingFace?.identity_claim_id ||
      (person ? stableId("claim_xmp_", evidenceId) : null)
    : null;
  return Object.freeze({
    assetId: content.asset_id,
    contentId: content.content_id,
    evidenceId,
    face,
    faceId,
    identityClaimId,
    person,
    resolutionState,
  });
};

const existingEvidence = async (
  sql,
  { contentId, regionKey, sourceId },
) => {
  const rows = await sql`
    SELECT * FROM xmp_sidecar_face_evidence
    WHERE source_id = ${sourceId} AND content_id = ${contentId}
      AND region_key = ${regionKey}
  `;
  if (rows.length > 1) {
    throw Object.assign(new Error("XMP evidence is ambiguous"), {
      code: "XMP_EVIDENCE_AMBIGUOUS",
    });
  }
  return rows[0] || null;
};

const validateEvidenceReplay = (row, outcome) => {
  if (
    row.evidence_id !== outcome.evidenceId ||
    row.asset_id !== outcome.assetId ||
    row.face_id !== outcome.faceId ||
    row.person_id !== (outcome.person?.person_id ?? null) ||
    row.identity_claim_id !== outcome.identityClaimId ||
    row.raw_name !== outcome.face.rawName ||
    row.normalized_name !== outcome.face.normalizedName ||
    row.resolution_state !== outcome.resolutionState ||
    !sameNumber(row.box_x, outcome.face.box.x) ||
    !sameNumber(row.box_y, outcome.face.box.y) ||
    !sameNumber(row.box_w, outcome.face.box.w) ||
    !sameNumber(row.box_h, outcome.face.box.h)
  ) {
    throw Object.assign(new Error("XMP evidence replay conflicts"), {
      code: "XMP_EVIDENCE_REPLAY_CONFLICT",
    });
  }
};

const insertSource = async (
  sql,
  { evidenceId, sidecarDigest, sourceId, sourceLocatorDigest },
) =>
  sql`
    INSERT INTO xmp_sidecar_face_source (
      source_id, source_locator_digest, evidence_id, sidecar_digest
    ) VALUES (
      ${sourceId}, ${sourceLocatorDigest}, ${evidenceId}, ${sidecarDigest}
    )
    ON CONFLICT (source_id, source_locator_digest, evidence_id)
    DO UPDATE SET sidecar_digest = excluded.sidecar_digest
  `;

const commitOutcome = async (
  sql,
  { outcome, sidecarDigest, sourceId, sourceLocatorDigest },
) => {
  const current = await existingEvidence(sql, {
    contentId: outcome.contentId,
    regionKey: outcome.face.regionKey,
    sourceId,
  });
  if (current) {
    validateEvidenceReplay(current, outcome);
    await insertSource(sql, {
      evidenceId: outcome.evidenceId,
      sidecarDigest,
      sourceId,
      sourceLocatorDigest,
    });
    return { replayed: 1, [outcome.resolutionState]: 1 };
  }
  if (!outcome.resolutionState.startsWith("reused_")) {
    await sql`
      INSERT INTO face_observation (
        face_id, asset_id, box_x, box_y, box_w, box_h,
        detection_confidence, quality_measurements, state,
        producer_receipt_id, observation_origin
      ) VALUES (
        ${outcome.faceId}, ${outcome.assetId},
        ${outcome.face.box.x}, ${outcome.face.box.y},
        ${outcome.face.box.w}, ${outcome.face.box.h}, NULL,
        ${sql.json({
          normalization: outcome.face.normalization,
          regionSource: outcome.face.source,
          sourceKind: "xmp_sidecar",
        })},
        'valid', ${receiptId}, 'xmp_sidecar_import'
      )
      ON CONFLICT (face_id) DO NOTHING
    `;
  }
  if (outcome.resolutionState === "created_mapped") {
    const decisionId = stableId("decision_xmp_", outcome.evidenceId);
    await sql`
      INSERT INTO decision (
        decision_id, subject_type, subject_id, action, actor_kind, actor_id,
        reason_code, note, producer_receipt_id, privacy_class
      ) VALUES (
        ${decisionId}, 'identity_claim', ${outcome.identityClaimId},
        'accept', 'trusted_import', 'xmp-sidecar-import',
        'xmp_sidecar_face_import', '', ${receiptId}, 'sensitive-biometric'
      )
      ON CONFLICT (decision_id) DO NOTHING
    `;
    await sql`
      INSERT INTO identity_claim (
        identity_claim_id, face_id, person_id, origin, state,
        calibrated_confidence, evidence_refs, decision_id,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${outcome.identityClaimId}, ${outcome.faceId},
        ${outcome.person.person_id}, 'trusted_import', 'accepted', NULL,
        ${sql.json([
          {
            normalization: outcome.face.normalization,
            regionKey: outcome.face.regionKey,
            sourceKind: "xmp_sidecar",
          },
        ])},
        ${decisionId}, ${receiptId}, 'sensitive-biometric'
      )
      ON CONFLICT (identity_claim_id) DO NOTHING
    `;
  }
  await sql`
    INSERT INTO xmp_sidecar_face_evidence (
      evidence_id, source_id, content_id, asset_id, face_id, person_id,
      identity_claim_id, region_key, raw_name, normalized_name,
      box_x, box_y, box_w, box_h, resolution_state
    ) VALUES (
      ${outcome.evidenceId}, ${sourceId}, ${outcome.contentId},
      ${outcome.assetId}, ${outcome.faceId},
      ${outcome.person?.person_id ?? null}, ${outcome.identityClaimId},
      ${outcome.face.regionKey}, ${outcome.face.rawName},
      ${outcome.face.normalizedName}, ${outcome.face.box.x},
      ${outcome.face.box.y}, ${outcome.face.box.w}, ${outcome.face.box.h},
      ${outcome.resolutionState}
    )
  `;
  await insertSource(sql, {
    evidenceId: outcome.evidenceId,
    sidecarDigest,
    sourceId,
    sourceLocatorDigest,
  });
  return { replayed: 0, [outcome.resolutionState]: 1 };
};

const addCounts = (target, values) => {
  for (const [key, value] of Object.entries(values)) {
    if (Number.isFinite(Number(value))) {
      target[key] = Number(target[key] || 0) + Number(value);
    }
  }
  return target;
};

const prepareFace = async (sql, { content, face, sourceId }) => {
  const evidenceId = stableId(
    "xmp_face_evidence_",
    sourceId,
    content.content_id,
    face.regionKey,
  );
  const current = await existingEvidence(sql, {
    contentId: content.content_id,
    regionKey: face.regionKey,
    sourceId,
  });
  if (current) {
    return Object.freeze({
      assetId: current.asset_id,
      contentId: current.content_id,
      evidenceId: current.evidence_id,
      face,
      faceId: current.face_id,
      identityClaimId: current.identity_claim_id,
      person: current.person_id
        ? { person_id: current.person_id }
        : null,
      resolutionState: current.resolution_state,
    });
  }
  const people = await resolvePerson(sql, face.normalizedName);
  let matches = [];
  if (people.length === 1) {
    matches = await findExistingFace(sql, {
      assetId: content.asset_id,
      box: face.box,
      personId: people[0].person_id,
    });
  }
  if (matches.length > 1) {
    return projectOutcome({
      content,
      evidenceId,
      existingFace: null,
      face,
      forcedResolutionState: "geometry_conflict",
      people,
    });
  }
  return projectOutcome({
    content,
    evidenceId,
    existingFace: matches[0] || null,
    face,
    people,
  });
};

const publicErrorCode = (error) =>
  /^[A-Z][A-Z0-9_]{2,79}$/.test(String(error?.code || ""))
    ? String(error.code)
    : "XMP_SIDECAR_IMPORT_FAILED";

const prepareXmpSidecarRun = async (
  sql,
  { actorId, commandId, limitAssets, sourceId },
) => {
  const actor = cleanText(actorId, "actor ID", 120);
  const command = cleanText(commandId, "command ID", 120);
  const source = cleanText(sourceId, "source ID", 120);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(command) ||
    !Number.isInteger(limitAssets) ||
    limitAssets < 1 ||
    limitAssets > 100000
  ) {
    throw Object.assign(new Error("XMP sidecar run options are invalid"), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  const requestDigest = digest({
    configDigest: xmpSidecarImportConfigDigest,
    limitAssets,
    sourceId: source,
  });
  const runId = `xmp_sidecar_run_${digest(command).slice(0, 32)}`;
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      SELECT * FROM xmp_sidecar_import_run WHERE command_id = ${command}
      FOR UPDATE
    `;
    if (rows.length > 1) {
      throw Object.assign(new Error("XMP sidecar command is ambiguous"), {
        code: "XMP_SIDECAR_RUN_CONFLICT",
      });
    }
    if (rows[0]) {
      const row = rows[0];
      if (
        row.actor_id !== actor ||
        row.source_id !== source ||
        row.config_digest !== xmpSidecarImportConfigDigest ||
        row.request_digest !== requestDigest
      ) {
        throw Object.assign(new Error("XMP sidecar command conflicts"), {
          code: "XMP_SIDECAR_RUN_CONFLICT",
        });
      }
      if (row.state === "failed") {
        await transaction`
          UPDATE xmp_sidecar_import_run SET
            state = 'processing', completed_at = NULL, last_error_code = NULL
          WHERE run_id = ${row.run_id}
        `;
      }
      return {
        completed: row.state === "completed",
        result: row.result,
        runId: row.run_id,
      };
    }
    await transaction`
      INSERT INTO xmp_sidecar_import_run (
        run_id, command_id, actor_id, source_id, config_digest, request_digest
      ) VALUES (
        ${runId}, ${command}, ${actor}, ${source},
        ${xmpSidecarImportConfigDigest}, ${requestDigest}
      )
    `;
    return { completed: false, result: null, runId };
  });
};

const loadRunItem = async (sql, { runId, sourceLocatorDigest }) => {
  const rows = await sql`
    SELECT * FROM xmp_sidecar_import_item
    WHERE run_id = ${runId}
      AND source_locator_digest = ${sourceLocatorDigest}
  `;
  return rows[0] || null;
};

const processXmpSidecarAsset = async (
  sql,
  { execute = false, packet, runId = null, sourceId },
) => {
  const normalized = normalizeXmpSidecarPacket(packet);
  const source = cleanText(sourceId, "source ID", 120);
  if (execute && !runId) {
    throw Object.assign(new Error("XMP execute requires a run"), {
      code: "XMP_SIDECAR_INPUT_INVALID",
    });
  }
  if (execute) {
    const item = await loadRunItem(sql, {
      runId,
      sourceLocatorDigest: normalized.sourceLocatorDigest,
    });
    if (item) {
      if (
        item.sidecar_digest !== normalized.sidecarDigest ||
        item.content_digest !== normalized.contentDigest ||
        Number(item.face_count) !== normalized.faces.length
      ) {
        throw Object.assign(new Error("XMP run item replay conflicts"), {
          code: "XMP_SIDECAR_ITEM_REPLAY_CONFLICT",
        });
      }
      return { ...item.result, itemReplayed: 1 };
    }
  }
  const content = await resolveContent(sql, normalized.contentDigest);
  if (!content) {
    const result = {
      faceCount: normalized.faces.length,
      outcome: "unbound_content",
      unboundAssets: 1,
    };
    if (execute) {
      await sql`
        INSERT INTO xmp_sidecar_import_item (
          run_id, source_locator_digest, sidecar_digest, content_digest,
          state, face_count, result
        ) VALUES (
          ${runId}, ${normalized.sourceLocatorDigest},
          ${normalized.sidecarDigest}, ${normalized.contentDigest},
          'completed', ${normalized.faces.length}, ${sql.json(result)}
        )
      `;
    }
    return result;
  }
  const outcomes = [];
  for (const face of normalized.faces) {
    outcomes.push(await prepareFace(sql, { content, face, sourceId: source }));
  }
  const predicted = { boundAssets: 1, faceCount: outcomes.length };
  for (const outcome of outcomes) {
    predicted[outcome.resolutionState] =
      Number(predicted[outcome.resolutionState] || 0) + 1;
  }
  if (!execute) return { ...predicted, outcome: "predicted" };
  return sql.begin(async (transaction) => {
    const committed = { boundAssets: 1, faceCount: outcomes.length };
    for (const outcome of outcomes) {
      addCounts(
        committed,
        await commitOutcome(transaction, {
          outcome,
          sidecarDigest: normalized.sidecarDigest,
          sourceId: source,
          sourceLocatorDigest: normalized.sourceLocatorDigest,
        }),
      );
    }
    const result = { ...committed, outcome: "committed" };
    await transaction`
      INSERT INTO xmp_sidecar_import_item (
        run_id, source_locator_digest, sidecar_digest, content_digest,
        state, face_count, result
      ) VALUES (
        ${runId}, ${normalized.sourceLocatorDigest},
        ${normalized.sidecarDigest}, ${normalized.contentDigest},
        'completed', ${normalized.faces.length}, ${transaction.json(result)}
      )
    `;
    return result;
  });
};

const completeXmpSidecarRun = async (
  sql,
  { providerSummary, runId },
) =>
  sql.begin(async (transaction) => {
    const items = await transaction`
      SELECT result FROM xmp_sidecar_import_item
      WHERE run_id = ${runId}
      ORDER BY source_locator_digest
    `;
    const result = {
      automaticIdentityAuthority: "trusted_sidecar_names_only",
      configDigest: xmpSidecarImportConfigDigest,
      sourceMediaWrite: "none",
      state: "completed",
    };
    for (const item of items) addCounts(result, item.result);
    result.items = items.length;
    result.scannedSidecars = Number(providerSummary?.scannedSidecars || 0);
    result.skippedSidecars = Number(providerSummary?.skippedSidecars || 0);
    await transaction`
      UPDATE xmp_sidecar_import_run SET
        state = 'completed', result = ${transaction.json(result)},
        completed_at = now(), last_error_code = NULL
      WHERE run_id = ${runId} AND state = 'processing'
    `;
    return result;
  });

const failXmpSidecarRun = async (sql, { error, runId }) => {
  const errorCode = publicErrorCode(error);
  await sql`
    UPDATE xmp_sidecar_import_run SET
      state = 'failed', completed_at = now(), last_error_code = ${errorCode}
    WHERE run_id = ${runId} AND state = 'processing'
  `;
  return errorCode;
};

export const scanXmpSidecars = async function* ({
  limitAssets,
  providerPath,
  pythonPath,
  root,
}) {
  const child = spawn(
    cleanText(pythonPath, "Python path", 1000),
    [
      cleanText(providerPath, "provider path", 1000),
      "--root",
      cleanText(root, "source root", 2000),
      "--limit-assets",
      String(limitAssets),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Register lifecycle listeners before consuming stdout. A fast reader can
  // exit while the importer is still resolving emitted packets; attaching the
  // close listener afterwards would then wait forever for an event already
  // delivered.
  const completion = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code) => resolve({ code }));
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4096) stderr += chunk;
  });
  let headerSeen = false;
  let summarySeen = false;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      child.kill();
      throw Object.assign(new Error("XMP reader output is invalid"), {
        code: "XMP_SIDECAR_PROVIDER_INVALID",
      });
    }
    if (value?.kind === "header") {
      exactKeys(value, ["kind", "schemaVersion"], "provider header");
      if (headerSeen || value.schemaVersion !== xmpSidecarReaderVersion) {
        child.kill();
        throw Object.assign(new Error("XMP reader header is invalid"), {
          code: "XMP_SIDECAR_PROVIDER_INVALID",
        });
      }
      headerSeen = true;
      continue;
    }
    if (!headerSeen || summarySeen) {
      child.kill();
      throw Object.assign(new Error("XMP reader sequence is invalid"), {
        code: "XMP_SIDECAR_PROVIDER_INVALID",
      });
    }
    if (value?.kind === "summary") {
      exactKeys(
        value,
        ["emittedAssets", "kind", "scannedSidecars", "skippedSidecars"],
        "provider summary",
      );
      summarySeen = true;
      yield { kind: "summary", value };
      continue;
    }
    yield { kind: "asset", value };
  }
  const completed = await completion;
  if (
    completed.error ||
    completed.code !== 0 ||
    !headerSeen ||
    !summarySeen
  ) {
    throw Object.assign(new Error("XMP reader failed"), {
      code: "XMP_SIDECAR_PROVIDER_FAILED",
      privateDetails: stderr.slice(0, 4096),
    });
  }
};

export const runXmpSidecarImport = async (
  sql,
  {
    actorId = "cimmich-operator",
    commandId,
    execute = false,
    limitAssets = 1000,
    packets = null,
    providerPath,
    pythonPath = "/usr/bin/python3",
    root,
    sourceId,
  } = {},
) => {
  if (!String(sourceId || "").trim()) {
    throw new Error("XMP sidecar import requires an explicit sourceId");
  }
  let run = null;
  if (execute) {
    run = await prepareXmpSidecarRun(sql, {
      actorId,
      commandId,
      limitAssets,
      sourceId,
    });
    if (run.completed) return { ...run.result, replayed: true };
  }
  const summary = {
    automaticIdentityAuthority: "trusted_sidecar_names_only",
    configDigest: xmpSidecarImportConfigDigest,
    dryRun: !execute,
    sourceMediaWrite: "none",
  };
  let providerSummary = null;
  try {
    const stream =
      packets ||
      scanXmpSidecars({
        limitAssets,
        providerPath,
        pythonPath,
        root,
      });
    for await (const entry of stream) {
      if (entry.kind === "summary") {
        providerSummary = entry.value;
        continue;
      }
      addCounts(
        summary,
        await processXmpSidecarAsset(sql, {
          execute,
          packet: entry.value,
          runId: run?.runId || null,
          sourceId,
        }),
      );
    }
    if (!providerSummary) {
      throw Object.assign(new Error("XMP reader summary is missing"), {
        code: "XMP_SIDECAR_PROVIDER_INVALID",
      });
    }
    if (!execute) {
      return {
        ...summary,
        scannedSidecars: Number(providerSummary.scannedSidecars || 0),
        skippedSidecars: Number(providerSummary.skippedSidecars || 0),
        state: "dry_run_complete",
      };
    }
    return await completeXmpSidecarRun(sql, {
      providerSummary,
      runId: run.runId,
    });
  } catch (error) {
    if (execute && run?.runId) {
      await failXmpSidecarRun(sql, { error, runId: run.runId });
    }
    throw error;
  }
};
