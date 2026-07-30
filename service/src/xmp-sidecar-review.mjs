import { createHash } from "node:crypto";

export const xmpSidecarReviewSchemaVersion =
  "cimmich.xmp-sidecar-name-review.v1";

const receiptId = "receipt_cimmich_xmp_name_resolution_v1";
const unresolvedStates = Object.freeze([
  "created_unresolved",
  "ambiguous_name",
  "geometry_conflict",
]);
const groupPattern = /^xmp_name_[0-9a-f]{64}$/;
const commandPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/;

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

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

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const nameGroupId = (sourceId, normalizedName) =>
  `xmp_name_${createHash("sha256")
    .update(`${sourceId}\u001f${normalizedName}`)
    .digest("hex")}`;

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor is required",
      400,
      "XMP_NAME_RESOLUTION_ACTOR_REQUIRED",
    );
  }
  return actor;
};

const cleanCommandId = (value) => {
  const commandId = String(value || "").trim();
  if (!commandPattern.test(commandId)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "XMP_NAME_RESOLUTION_COMMAND_INVALID",
    );
  }
  return commandId;
};

const cleanGroupId = (value) => {
  const groupId = String(value || "").trim();
  if (!groupPattern.test(groupId)) {
    throw typedError(
      "The unresolved XMP name group is invalid",
      400,
      "XMP_NAME_GROUP_INVALID",
    );
  }
  return groupId;
};

const cleanName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw typedError(
      "Person name must contain 1 to 160 characters",
      400,
      "XMP_NAME_PERSON_NAME_INVALID",
    );
  }
  return name;
};

const cleanPersonId = (value) => {
  const personId = String(value || "").trim();
  if (
    !personId ||
    personId.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(personId)
  ) {
    throw typedError(
      "The destination Person is invalid",
      400,
      "XMP_NAME_PERSON_INVALID",
    );
  }
  return personId;
};

const cleanLimit = (value) => {
  const limit = Number.parseInt(String(value || "24"), 10);
  return Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 24;
};

const projectGroupRows = (rows, bridgeFields) => {
  const groups = new Map();
  for (const row of rows) {
    const groupId = nameGroupId(row.source_id, row.normalized_name);
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        assetCount: Number(row.asset_count),
        conflictingIdentityCount: Number(row.conflicting_identity_count),
        faceCount: Number(row.face_count),
        firstCaptureTime: row.first_capture_time || null,
        groupId,
        lastCaptureTime: row.last_capture_time || null,
        normalizedName: row.normalized_name,
        previews: [],
        rawNameVariants: row.raw_name_variants || [],
        sourceId: row.source_id,
      });
    }
    if (!row.face_id) continue;
    const bridge = bridgeFields(row.asset_id);
    groups.get(groupId).previews.push({
      assetId: row.asset_id,
      box: {
        h: Number(row.box_h),
        w: Number(row.box_w),
        x: Number(row.box_x),
        y: Number(row.box_y),
      },
      faceId: row.face_id,
      height: Number(row.height || 0),
      sourceAssetId: row.source_asset_id || bridge.sourceAssetId || "",
      width: Number(row.width || 0),
    });
  }
  return [...groups.values()];
};

const loadCommand = async (sql, commandId) => {
  const [row] = await sql`
    SELECT actor_id, group_id, request_digest, response_body, state
    FROM xmp_sidecar_name_resolution_command
    WHERE command_id = ${commandId}
  `;
  return row || null;
};

const validateReplay = (row, { actorId, groupId, requestDigest }) => {
  if (
    row.actor_id !== actorId ||
    row.group_id !== groupId ||
    row.request_digest !== requestDigest
  ) {
    throw typedError(
      "commandId was already used for a different XMP name resolution",
      409,
      "XMP_NAME_RESOLUTION_COMMAND_CONFLICT",
    );
  }
  if (row.state !== "completed") {
    throw typedError(
      "The XMP name resolution is already in progress",
      409,
      "XMP_NAME_RESOLUTION_COMMAND_CONFLICT",
    );
  }
  return { ...row.response_body, replayed: true };
};

export const createXmpSidecarReviewStore = (
  sql,
  { bridgeFields = () => ({}), presentationRank = () => 2 } = {},
) => ({
  async list({ limit = 24 } = {}) {
    const boundedLimit = cleanLimit(limit);
    const rows = await sql`
      WITH unresolved AS (
        SELECT evidence.source_id, evidence.normalized_name,
          evidence.raw_name, evidence.evidence_id, evidence.face_id,
          evidence.asset_id, face.box_x, face.box_y, face.box_w, face.box_h,
          asset.capture_time, asset.width, asset.height,
          identity.person_id AS current_person_id,
          projection.immich_asset_id AS source_asset_id
        FROM xmp_sidecar_face_evidence evidence
        JOIN face_observation face ON face.face_id = evidence.face_id
          AND face.state = 'valid'
        JOIN asset ON asset.asset_id = evidence.asset_id
          AND asset.state = 'active'
          AND cimmich_visibility_asset_rank(asset.asset_id)
            <= ${presentationRank()}
        LEFT JOIN current_face_identity identity
          ON identity.face_id = evidence.face_id
          AND identity.state = 'accepted'
        LEFT JOIN LATERAL (
          SELECT immich_asset_id
          FROM immich_asset_projection
          WHERE cimmich_asset_id = evidence.asset_id AND state = 'active'
          ORDER BY source_id
          LIMIT 1
        ) projection ON true
        WHERE evidence.resolution_state IN ${sql(unresolvedStates)}
          AND evidence.person_id IS NULL
      ),
      grouped AS (
        SELECT source_id, normalized_name,
          count(*)::int AS face_count,
          count(DISTINCT asset_id)::int AS asset_count,
          count(*) FILTER (WHERE current_person_id IS NOT NULL)::int
            AS conflicting_identity_count,
          min(capture_time) AS first_capture_time,
          max(capture_time) AS last_capture_time,
          array_agg(DISTINCT raw_name ORDER BY raw_name) AS raw_name_variants
        FROM unresolved
        GROUP BY source_id, normalized_name
        ORDER BY count(*) DESC, normalized_name, source_id
        LIMIT ${boundedLimit}
      ),
      representative_asset AS (
        SELECT DISTINCT ON (
          unresolved.source_id, unresolved.normalized_name,
          unresolved.asset_id
        )
          unresolved.*
        FROM unresolved
        JOIN grouped USING (source_id, normalized_name)
        ORDER BY unresolved.source_id, unresolved.normalized_name,
          unresolved.asset_id,
          (unresolved.box_w * unresolved.box_h) DESC,
          unresolved.face_id
      ),
      ranked_preview AS (
        SELECT representative_asset.*,
          row_number() OVER (
            PARTITION BY source_id, normalized_name
            ORDER BY (box_w * box_h) DESC, capture_time, asset_id, face_id
          ) AS preview_rank
        FROM representative_asset
      )
      SELECT grouped.*, preview.asset_id, preview.face_id,
        preview.box_x, preview.box_y, preview.box_w, preview.box_h,
        preview.width, preview.height, preview.source_asset_id
      FROM grouped
      LEFT JOIN ranked_preview preview
        ON preview.source_id = grouped.source_id
        AND preview.normalized_name = grouped.normalized_name
        AND preview.preview_rank <= 3
      ORDER BY grouped.face_count DESC, grouped.normalized_name,
        grouped.source_id, preview.preview_rank
    `;
    const items = projectGroupRows(rows, bridgeFields);
    const [{ remaining_group_count: remainingGroupCount = 0 } = {}] = await sql`
      SELECT count(*)::int AS remaining_group_count
      FROM (
        SELECT evidence.source_id, evidence.normalized_name
        FROM xmp_sidecar_face_evidence evidence
        JOIN face_observation face ON face.face_id = evidence.face_id
          AND face.state = 'valid'
        JOIN asset ON asset.asset_id = evidence.asset_id
          AND asset.state = 'active'
          AND cimmich_visibility_asset_rank(asset.asset_id)
            <= ${presentationRank()}
        WHERE evidence.resolution_state IN ${sql(unresolvedStates)}
          AND evidence.person_id IS NULL
        GROUP BY evidence.source_id, evidence.normalized_name
      ) unresolved_groups
    `;
    return {
      items,
      remainingGroupCount: Number(remainingGroupCount),
      schemaVersion: xmpSidecarReviewSchemaVersion,
    };
  },

  async resolve({ actorId, commandId, groupId, newPersonName, personId }) {
    const actor = cleanActor(actorId);
    const stableCommandId = cleanCommandId(commandId);
    const stableGroupId = cleanGroupId(groupId);
    const selectors = [
      personId !== undefined ? "existing_person" : null,
      newPersonName !== undefined ? "new_person" : null,
    ].filter(Boolean);
    if (selectors.length !== 1) {
      throw typedError(
        "Choose exactly one existing Person or one new Person name",
        400,
        "XMP_NAME_RESOLUTION_SELECTOR_INVALID",
      );
    }
    const selectorKind = selectors[0];
    const requested =
      selectorKind === "existing_person"
        ? { personId: cleanPersonId(personId) }
        : { newPersonName: cleanName(newPersonName) };
    const requestDigest = digest({
      groupId: stableGroupId,
      selectorKind,
      ...requested,
    });
    const early = await loadCommand(sql, stableCommandId);
    if (early) {
      return validateReplay(early, {
        actorId: actor,
        groupId: stableGroupId,
        requestDigest,
      });
    }

    return sql.begin(async (tx) => {
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${stableCommandId}, 96)
        )
      `;
      const replay = await loadCommand(tx, stableCommandId);
      if (replay) {
        return validateReplay(replay, {
          actorId: actor,
          groupId: stableGroupId,
          requestDigest,
        });
      }
      const evidence = await tx`
        SELECT evidence.evidence_id, evidence.face_id,
          evidence.source_id, evidence.normalized_name,
          identity.identity_claim_id AS current_claim_id,
          identity.person_id AS current_person_id
        FROM xmp_sidecar_face_evidence evidence
        JOIN face_observation face ON face.face_id = evidence.face_id
          AND face.state = 'valid'
        LEFT JOIN current_face_identity identity
          ON identity.face_id = evidence.face_id
          AND identity.state = 'accepted'
        WHERE evidence.resolution_state IN ${tx(unresolvedStates)}
          AND evidence.person_id IS NULL
          AND (
            'xmp_name_' || encode(
              digest(
                evidence.source_id || chr(31) || evidence.normalized_name,
                'sha256'
              ),
              'hex'
            )
          ) = ${stableGroupId}
        ORDER BY evidence.evidence_id
        FOR UPDATE OF evidence, face
      `;
      if (evidence.length === 0) {
        const [completed] = await tx`
          SELECT command_id
          FROM xmp_sidecar_name_resolution_command
          WHERE group_id = ${stableGroupId} AND state = 'completed'
        `;
        throw typedError(
          completed
            ? "This XMP name group was already resolved"
            : "The unresolved XMP name group was not found",
          completed ? 409 : 404,
          completed ? "XMP_NAME_ALREADY_RESOLVED" : "XMP_NAME_GROUP_NOT_FOUND",
        );
      }
      const sourceId = evidence[0].source_id;
      const normalizedName = evidence[0].normalized_name;
      if (
        evidence.some(
          (row) =>
            row.source_id !== sourceId ||
            row.normalized_name !== normalizedName,
        )
      ) {
        throw typedError(
          "The unresolved XMP name group is ambiguous",
          409,
          "XMP_NAME_GROUP_CONFLICT",
        );
      }
      await tx`
        INSERT INTO xmp_sidecar_name_resolution_command (
          command_id, actor_id, group_id, source_id, normalized_name,
          selector_kind, requested_person_id, requested_person_name,
          request_digest
        ) VALUES (
          ${stableCommandId}, ${actor}, ${stableGroupId}, ${sourceId},
          ${normalizedName}, ${selectorKind},
          ${selectorKind === "existing_person" ? requested.personId : null},
          ${selectorKind === "new_person" ? requested.newPersonName : null},
          ${requestDigest}
        )
      `;

      let target;
      let createdPerson = false;
      if (selectorKind === "existing_person") {
        [target] = await tx`
          SELECT person_id, display_name
          FROM person
          WHERE person_id = ${requested.personId}
            AND status = 'active' AND subject_kind = 'person'
          FOR UPDATE
        `;
        if (!target) {
          throw typedError(
            "The destination Person is not active",
            404,
            "XMP_NAME_PERSON_NOT_FOUND",
          );
        }
      } else {
        const duplicates = await tx`
          SELECT person_id, display_name
          FROM current_person person
          WHERE person.status = 'active' AND person.subject_kind = 'person'
            AND (
              lower(person.display_name) = lower(${requested.newPersonName})
              OR EXISTS (
                SELECT 1 FROM unnest(person.aliases) alias
                WHERE lower(alias) = lower(${requested.newPersonName})
              )
            )
          ORDER BY person_id
          LIMIT 2
        `;
        if (duplicates.length > 0) {
          throw typedError(
            "A Person with that display name or alias already exists",
            409,
            "XMP_NAME_PERSON_ALREADY_EXISTS",
            { people: duplicates },
          );
        }
        const personId = `person_${createHash("sha256")
          .update(`${stableCommandId}\u001fperson`)
          .digest("hex")
          .slice(0, 32)}`;
        [target] = await tx`
          INSERT INTO person (
            person_id, display_name, status, subject_kind,
            created_by_receipt_id, privacy_class
          ) VALUES (
            ${personId}, ${requested.newPersonName}, 'active', 'person',
            ${receiptId}, 'sensitive-biometric'
          )
          RETURNING person_id, display_name
        `;
        createdPerson = true;
      }

      const conflictingFaces = evidence.filter(
        (row) =>
          row.current_person_id && row.current_person_id !== target.person_id,
      );
      if (conflictingFaces.length > 0) {
        throw typedError(
          "One or more Faces now belong to another accepted Person",
          409,
          "XMP_NAME_FACE_IDENTITY_CONFLICT",
          { conflictingFaceCount: conflictingFaces.length },
        );
      }

      const exactPeople = await tx`
        SELECT person.person_id, person.display_name
        FROM current_person person
        WHERE person.status = 'active' AND person.subject_kind = 'person'
          AND (
            lower(person.display_name) = lower(${normalizedName})
            OR EXISTS (
              SELECT 1 FROM unnest(person.aliases) alias
              WHERE lower(alias) = lower(${normalizedName})
            )
          )
        ORDER BY person.person_id
      `;
      if (exactPeople.some((person) => person.person_id !== target.person_id)) {
        throw typedError(
          "The imported name now belongs to another Person",
          409,
          "XMP_NAME_ALIAS_CONFLICT",
          { people: exactPeople },
        );
      }

      const decisionId = `decision_xmp_owner_${digest({
        commandId: stableCommandId,
        targetPersonId: target.person_id,
      }).slice(0, 32)}`;
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'xmp_sidecar_name', ${stableGroupId}, 'accept',
          'user', ${actor}, 'xmp_sidecar_name_owner_resolution',
          'Resolve imported sidecar name to one Person',
          ${receiptId}, 'sensitive-biometric'
        )
      `;

      const withoutIdentity = evidence.filter(
        (row) => !row.current_claim_id,
      ).length;
      if (withoutIdentity > 0) {
        await tx`
          INSERT INTO identity_claim (
            identity_claim_id, face_id, person_id, origin, state,
            calibrated_confidence, evidence_refs, decision_id,
            producer_receipt_id, privacy_class
          )
          SELECT
            'claim_xmp_owner_' || substr(
              encode(
                digest(
                  evidence.evidence_id || chr(31) || ${decisionId},
                  'sha256'
                ),
                'hex'
              ),
              1,
              40
            ),
            evidence.face_id, ${target.person_id}, 'user', 'accepted', NULL,
            jsonb_build_array(
              jsonb_build_object(
                'groupId', to_jsonb(${stableGroupId}::text),
                'sourceKind', 'xmp_sidecar_owner_resolution'
              )
            ),
            ${decisionId}, ${receiptId}, 'sensitive-biometric'
          FROM xmp_sidecar_face_evidence evidence
          LEFT JOIN current_face_identity identity
            ON identity.face_id = evidence.face_id
            AND identity.state = 'accepted'
          WHERE evidence.resolution_state IN ${tx(unresolvedStates)}
            AND evidence.person_id IS NULL
            AND identity.identity_claim_id IS NULL
            AND (
              'xmp_name_' || encode(
                digest(
                  evidence.source_id || chr(31) || evidence.normalized_name,
                  'sha256'
                ),
                'hex'
              )
            ) = ${stableGroupId}
        `;
      }

      let aliasAdded = false;
      if (
        !exactPeople.some((person) => person.person_id === target.person_id)
      ) {
        const aliasId = `alias_xmp_${digest({
          commandId: stableCommandId,
          normalizedName,
          targetPersonId: target.person_id,
        }).slice(0, 40)}`;
        await tx`
          INSERT INTO person_alias (
            alias_id, person_id, label, alias_kind, state, source_system,
            source_subject_id, producer_receipt_id, privacy_class
          ) VALUES (
            ${aliasId}, ${target.person_id}, ${normalizedName}, 'imported',
            'active', 'xmp_sidecar', ${stableGroupId}, ${receiptId}, 'private'
          )
        `;
        aliasAdded = true;
      }

      const updated = await tx`
        UPDATE xmp_sidecar_face_evidence evidence
        SET person_id = identity.person_id,
          identity_claim_id = identity.identity_claim_id,
          resolution_state = 'owner_resolved',
          owner_resolution_command_id = ${stableCommandId},
          owner_resolution_decision_id = ${decisionId}
        FROM current_face_identity identity
        WHERE identity.face_id = evidence.face_id
          AND identity.person_id = ${target.person_id}
          AND identity.state = 'accepted'
          AND evidence.resolution_state IN ${tx(unresolvedStates)}
          AND evidence.person_id IS NULL
          AND (
            'xmp_name_' || encode(
              digest(
                evidence.source_id || chr(31) || evidence.normalized_name,
                'sha256'
              ),
              'hex'
            )
          ) = ${stableGroupId}
        RETURNING evidence.evidence_id
      `;
      if (updated.length !== evidence.length) {
        throw typedError(
          "The XMP name group changed during resolution",
          409,
          "XMP_NAME_GROUP_CONFLICT",
        );
      }

      if (createdPerson) {
        const [sortCategory] = await tx`
          SELECT category_id
          FROM person_category
          WHERE slug = 'sort' AND state = 'active'
          LIMIT 1
        `;
        if (sortCategory) {
          await tx`
            INSERT INTO person_category_membership_event (
              membership_event_id, person_id, category_id, action,
              actor_kind, actor_id, decision_id, producer_receipt_id,
              privacy_class
            ) VALUES (
              ${`categoryevent_xmp_${digest(stableCommandId).slice(0, 32)}`},
              ${target.person_id}, ${sortCategory.category_id}, 'add', 'user',
              ${actor}, ${decisionId}, ${receiptId}, 'private'
            )
          `;
        }
      }
      await tx`
        UPDATE person
        SET current_revision = current_revision + 1
        WHERE person_id = ${target.person_id}
      `;

      const response = {
        aliasAdded,
        commandId: stableCommandId,
        createdClaimCount: withoutIdentity,
        createdPerson,
        decisionId,
        groupId: stableGroupId,
        personId: target.person_id,
        personName: target.display_name,
        replayed: false,
        resolvedFaceCount: evidence.length,
        reusedClaimCount: evidence.length - withoutIdentity,
        schemaVersion: xmpSidecarReviewSchemaVersion,
        state: "resolved",
      };
      await tx`
        UPDATE xmp_sidecar_name_resolution_command
        SET target_person_id = ${target.person_id},
          decision_id = ${decisionId},
          state = 'completed',
          resolved_face_count = ${evidence.length},
          response_body = ${tx.json(response)},
          completed_at = now()
        WHERE command_id = ${stableCommandId}
      `;
      return response;
    });
  },
});
