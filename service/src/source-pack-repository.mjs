import { parseVector, vectorText } from "./prime-curator.mjs";
import { compileSourcePack } from "./source-pack.mjs";
import { lowQualityReasons } from "./low-quality-policy.mjs";

const receiptId = "receipt_cimmich_source_pack_compiler_v1";

export const loadSourcePackFaces = async (
  sql,
  {
    configDigest = "",
    modelFamily = "",
    modelVersion = "",
    personId = "",
  } = {},
) => {
  const rows = await sql`
    WITH accepted_physical_identity AS MATERIALIZED (
      SELECT DISTINCT ON (member.physical_face_id, identity.person_id)
        member.physical_face_id, member.canonical_face_id,
        identity.face_id AS claim_face_id, identity.person_id,
        identity.origin, identity.identity_claim_id
      FROM current_face_identity identity
      JOIN current_face_physical_member member ON member.face_id = identity.face_id
      WHERE identity.state = 'accepted'
      ORDER BY member.physical_face_id, identity.person_id,
        identity.identity_claim_id
    ), gallery_state AS MATERIALIZED (
      SELECT DISTINCT ON (member.physical_face_id, gallery.person_id)
        member.physical_face_id, gallery.person_id, gallery.bucket_kind,
        gallery.actor_kind, gallery.latest_action
      FROM current_reference_gallery gallery
      JOIN current_face_physical_member member ON member.face_id = gallery.face_id
      WHERE gallery.bucket_kind IN ('prime','secondary','lq')
        AND gallery.membership_state = 'active'
      ORDER BY member.physical_face_id, gallery.person_id,
        CASE gallery.bucket_kind
          WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1 ELSE 2
        END
    ), user_bucket_override AS MATERIALIZED (
      SELECT DISTINCT member.physical_face_id, bucket.person_id
      FROM bucket_membership_event event
      JOIN reference_bucket bucket ON bucket.bucket_id = event.bucket_id
      JOIN current_face_physical_member member ON member.face_id = event.face_id
      WHERE bucket.bucket_kind IN ('prime','secondary','lq','head')
        AND event.actor_kind = 'user'
    ), head_override AS MATERIALIZED (
      SELECT DISTINCT member.physical_face_id, gallery.person_id
      FROM current_reference_gallery gallery
      JOIN current_face_physical_member member ON member.face_id = gallery.face_id
      WHERE gallery.bucket_kind = 'head'
        AND gallery.membership_state = 'active'
    ), face_modifiers AS MATERIALIZED (
      SELECT modifier.face_id, jsonb_agg(
        jsonb_build_object(
          'key', modifier.modifier_key,
          'label', modifier.modifier_label,
          'class', modifier.modifier_class,
          'actorKind', modifier.actor_kind,
          'confidence', modifier.confidence,
          'metadata', modifier.metadata
        ) ORDER BY modifier.modifier_key
      ) AS items
      FROM current_face_modifier modifier
      GROUP BY modifier.face_id
    ), face_contexts AS MATERIALIZED (
      SELECT context.face_id, jsonb_agg(
        jsonb_build_object(
          'contextId', context.context_id,
          'contextKind', context.context_kind,
          'label', context.label,
          'memberCount', context.member_count,
          'memberIndex', context.member_index,
          'confidence', context.context_confidence,
          'groupingFeatures', context.grouping_features
        ) ORDER BY context.context_kind, context.context_id
      ) AS items
      FROM current_face_capture_context context
      GROUP BY context.face_id
    )
    SELECT cfi.identity_claim_id, cfi.person_id, cfi.origin AS identity_origin,
      'accepted'::text AS identity_state, d.actor_kind AS decision_actor_kind,
      fo.face_id, fo.asset_id, fo.observation_origin, a.capture_time,
      round(a.width * fo.box_w)::int AS face_pixel_width,
      round(a.height * fo.box_h)::int AS face_pixel_height,
      fo.detection_confidence::float8 AS detection,
      CASE WHEN fo.observation_origin = 'manual_user'
        THEN manual_evidence.quality_score
        WHEN nullif(fo.quality_measurements->>'quality_score', '') IS NOT NULL
        THEN (fo.quality_measurements->>'quality_score')::float8
        ELSE least(
          greatest(coalesce(fo.detection_confidence, 0), 0),
          least(
            1,
            least(a.width * fo.box_w, a.height * fo.box_h) / 96::float8
          )
        )
      END AS quality,
      CASE WHEN fo.observation_origin = 'manual_user' THEN 'manual_evidence'
        WHEN nullif(fo.quality_measurements->>'quality_score', '') IS NOT NULL
          THEN 'measured'
        ELSE 'detector_geometry_proxy'
      END AS quality_source,
      coalesce(fo.quality_measurements->>'effective_gallery_permission', 'unknown') AS gallery_permission,
      coalesce(fo.quality_measurements->>'source_instance_suffix', '') AS source_instance_suffix,
      fe.model_family, fe.model_version, fe.config_digest, fe.dimension,
      fe.embedding::text AS embedding, fe.vector_digest,
      manual_evidence.evidence_tier AS manual_evidence_tier,
      gallery.bucket_kind AS current_bucket_kind,
      coalesce(gallery.actor_kind = 'user' AND gallery.latest_action = 'pin' AND gallery.bucket_kind = 'prime', false) AS pinned_prime,
      coalesce(gallery.actor_kind = 'user' AND gallery.latest_action = 'pin' AND gallery.bucket_kind = 'secondary', false) AS user_pinned_secondary,
      coalesce(gallery.actor_kind = 'user' AND gallery.latest_action = 'pin' AND gallery.bucket_kind = 'lq', false) AS user_pinned_lq,
      (
        NOT coalesce(
          gallery.bucket_kind = 'prime' AND gallery.latest_action = 'pin',
          false
        )
        AND (
          user_override.physical_face_id IS NOT NULL
          OR head.physical_face_id IS NOT NULL
        )
      ) AS blocked_prime,
      coalesce(modifiers.items, '[]'::jsonb) AS face_modifiers,
      coalesce(contexts.items, '[]'::jsonb) AS capture_contexts,
      coalesce(review.needs_sort, false) AS person_needs_sort,
      jsonb_strip_nulls(jsonb_build_object(
        'blur_score', fo.quality_measurements->'blur_score',
        'frontal_score', fo.quality_measurements->'frontal_score',
        'quality_bucket', fo.quality_measurements->'quality_bucket'
      )) AS condition_features
    FROM accepted_physical_identity cfi
    JOIN current_person subject ON subject.person_id = cfi.person_id AND subject.subject_kind = 'person'
    JOIN identity_claim ic ON ic.identity_claim_id = cfi.identity_claim_id
    JOIN face_observation fo ON fo.face_id = cfi.canonical_face_id AND fo.state = 'valid'
    JOIN asset a ON a.asset_id = fo.asset_id
    JOIN face_embedding fe ON fe.face_id = fo.face_id AND fe.state = 'active'
    LEFT JOIN current_manual_face_matching_evidence manual_evidence
      ON manual_evidence.face_id = cfi.claim_face_id
      AND manual_evidence.identity_claim_id = cfi.identity_claim_id
      AND manual_evidence.model_family = fe.model_family
      AND manual_evidence.model_version = fe.model_version
      AND manual_evidence.config_digest = fe.config_digest
      AND manual_evidence.embedding_id = fe.embedding_id
      AND manual_evidence.vector_digest = fe.vector_digest
    LEFT JOIN decision d ON d.decision_id = ic.decision_id
    LEFT JOIN current_person_review_state review ON review.person_id = cfi.person_id
    LEFT JOIN gallery_state gallery
      ON gallery.physical_face_id = cfi.physical_face_id
      AND gallery.person_id = cfi.person_id
    LEFT JOIN user_bucket_override user_override
      ON user_override.physical_face_id = cfi.physical_face_id
      AND user_override.person_id = cfi.person_id
    LEFT JOIN head_override head
      ON head.physical_face_id = cfi.physical_face_id
      AND head.person_id = cfi.person_id
    LEFT JOIN face_modifiers modifiers ON modifiers.face_id = fo.face_id
    LEFT JOIN face_contexts contexts ON contexts.face_id = fo.face_id
    WHERE (fo.observation_origin <> 'manual_user'
        OR manual_evidence.recognition_evidence_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM current_person_category category
        WHERE category.person_id = cfi.person_id AND category.slug = 'holding'
      )
      AND (${String(personId)} = '' OR cfi.person_id = ${String(personId)})
      AND (${String(modelFamily)} = '' OR fe.model_family = ${String(modelFamily)})
      AND (${String(modelVersion)} = '' OR fe.model_version = ${String(modelVersion)})
      AND (${String(configDigest)} = '' OR fe.config_digest = ${String(configDigest)})
    ORDER BY cfi.person_id, fe.model_family, fe.model_version, fe.config_digest, fo.face_id
  `;
  const bodyRows = rows.filter(
    (row) => String(row.source_instance_suffix || "") === "2",
  );
  const competitors = bodyRows.length
    ? await sql`
        WITH target(face_id, person_id) AS (
          SELECT * FROM unnest(
            ${bodyRows.map((row) => row.face_id)}::text[],
            ${bodyRows.map((row) => row.person_id)}::text[]
          )
        )
        SELECT target.face_id,
          max(1 - (embedding.embedding <=> other.embedding))::float8
            AS max_other_prime_similarity
        FROM target
        JOIN face_embedding embedding ON embedding.face_id = target.face_id
          AND embedding.state = 'active'
        JOIN current_reference_prototype other
          ON other.person_id <> target.person_id
          AND other.model_family = embedding.model_family
          AND other.model_version = embedding.model_version
          AND other.config_digest = embedding.config_digest
        GROUP BY target.face_id
      `
    : [];
  const competitorByFace = new Map(
    competitors.map((row) => [row.face_id, row.max_other_prime_similarity]),
  );
  return rows.map((row) => ({
    assetId: row.asset_id,
    blockedPrime:
      row.observation_origin === "manual_user" ||
      row.blocked_prime ||
      row.current_bucket_kind === "lq",
    captureTime: row.capture_time,
    conditionFeatures: row.condition_features || {},
    configDigest: row.config_digest,
    currentBucketKind: row.current_bucket_kind,
    decisionActorKind: row.decision_actor_kind,
    detection: row.detection,
    dimension: row.dimension,
    faceId: row.face_id,
    facePixelHeight: row.face_pixel_height,
    facePixelWidth: row.face_pixel_width,
    galleryPermission: row.gallery_permission,
    identityClaimId: row.identity_claim_id,
    identityOrigin: row.identity_origin,
    identityState: row.identity_state,
    modelFamily: row.model_family,
    modelVersion: row.model_version,
    maxOtherPrimeSimilarity: competitorByFace.get(row.face_id) ?? null,
    personId: row.person_id,
    personNeedsSort: row.person_needs_sort,
    pinnedPrime:
      row.observation_origin === "manual_user" ? false : row.pinned_prime,
    quality: row.quality,
    qualitySource: row.quality_source,
    sourceInstanceSuffix: row.source_instance_suffix,
    sourceTierHint:
      row.observation_origin === "manual_user"
        ? row.manual_evidence_tier === "low_quality"
          ? "low_quality"
          : "secondary"
        : row.source_instance_suffix === "" ||
            row.source_instance_suffix === "blank"
          ? "prime"
          : row.source_instance_suffix === "1"
            ? "secondary"
            : row.source_instance_suffix === "2"
              ? "body_presence"
              : "unknown",
    modifiers: row.face_modifiers || [],
    captureContexts: row.capture_contexts || [],
    lowQualityReasons: lowQualityReasons({
      detection: row.detection,
      facePixelHeight: row.face_pixel_height,
      facePixelWidth: row.face_pixel_width,
      quality: row.quality,
    }).filter(
      (reason) =>
        row.observation_origin !== "manual_user" ||
        reason !== "low_detection_confidence",
    ),
    userPinnedLq: row.user_pinned_lq,
    userPinnedSecondary: row.user_pinned_secondary,
    vector: parseVector(row.embedding),
    vectorDigest: row.vector_digest,
  }));
};

export const persistSourcePack = async (
  sql,
  pack,
  { execute = false } = {},
) => {
  if (!execute) {
    return { created: false, execute, packId: pack.packId, ...pack.summary };
  }
  return sql.begin(async (tx) => {
    const [existing] =
      await tx`SELECT pack_id FROM source_pack WHERE pack_digest = ${pack.packDigest}`;
    if (existing) {
      return {
        created: false,
        execute,
        packId: existing.pack_id,
        ...pack.summary,
      };
    }
    const now = new Date();
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, privacy_class
      ) VALUES (
        ${receiptId}, 'system', 'cimmich-source-pack-compiler', 'v1', ${now}, ${now}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
    `;
    await tx`
      INSERT INTO source_pack (
        pack_id, pack_digest, predecessor_pack_id, model_family, model_version,
        config_digest, dimension, policy_version, source_revision_digest,
        evidence_cutoff, manifest, state, evaluation_status, producer_receipt_id, privacy_class
      ) VALUES (
        ${pack.packId}, ${pack.packDigest}, ${pack.predecessorPackId}, ${pack.modelFamily},
        ${pack.modelVersion}, ${pack.configDigest}, ${pack.dimension}, ${pack.policyVersion},
        ${pack.sourceRevisionDigest}, ${pack.evidenceCutoff}, ${tx.json(pack.manifest)},
        'proposed', 'untested', ${receiptId}, 'sensitive-biometric'
      )
    `;
    for (const reference of pack.references) {
      await tx`
        INSERT INTO source_pack_reference (
          pack_id, reference_id, person_id, bucket_kind, reference_kind, face_id,
          member_face_ids, model_family, model_version, config_digest, dimension,
          normalized, embedding, vector_digest, quality_score, condition_features,
          routing_state, provenance, privacy_class
        ) VALUES (
          ${pack.packId}, ${reference.referenceId}, ${reference.personId}, ${reference.bucketKind},
          ${reference.referenceKind}, ${reference.faceId}, ${reference.memberFaceIds},
          ${pack.modelFamily}, ${pack.modelVersion}, ${pack.configDigest}, ${pack.dimension}, true,
          ${vectorText(reference.embedding)}::vector, ${reference.vectorDigest}, ${reference.qualityScore},
          ${tx.json(reference.conditionFeatures)}, ${reference.routingState}, ${tx.json(reference.provenance)},
          'sensitive-biometric'
        )
      `;
    }
    return { created: true, execute, packId: pack.packId, ...pack.summary };
  });
};

export const compileAndPersistSourcePack = async (
  sql,
  options,
  { execute = false } = {},
) => {
  const faces = await loadSourcePackFaces(sql, options);
  const pack = compileSourcePack(faces, options);
  const persistence = await persistSourcePack(sql, pack, { execute });
  return { pack, persistence };
};
