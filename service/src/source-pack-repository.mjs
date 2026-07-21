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
    SELECT cfi.identity_claim_id, cfi.person_id, cfi.origin AS identity_origin,
      cfi.state AS identity_state, d.actor_kind AS decision_actor_kind,
      fo.face_id, fo.asset_id, fo.observation_origin, a.capture_time,
      round(a.width * fo.box_w)::int AS face_pixel_width,
      round(a.height * fo.box_h)::int AS face_pixel_height,
      fo.detection_confidence::float8 AS detection,
      CASE WHEN fo.observation_origin = 'manual_user'
        THEN manual_evidence.quality_score
        ELSE coalesce((fo.quality_measurements->>'quality_score')::float8, 0)
      END AS quality,
      coalesce(fo.quality_measurements->>'effective_gallery_permission', 'unknown') AS gallery_permission,
      coalesce(fo.quality_measurements->>'source_instance_suffix', '') AS source_instance_suffix,
      fe.model_family, fe.model_version, fe.config_digest, fe.dimension,
      fe.embedding::text AS embedding, fe.vector_digest,
      manual_evidence.evidence_tier AS manual_evidence_tier,
      competitor.max_other_prime_similarity,
      gallery.bucket_kind AS current_bucket_kind,
      coalesce(gallery.actor_kind = 'user' AND gallery.latest_action = 'pin' AND gallery.bucket_kind = 'prime', false) AS pinned_prime,
      coalesce(gallery.actor_kind = 'user' AND gallery.latest_action = 'pin' AND gallery.bucket_kind = 'secondary', false) AS user_pinned_secondary,
      coalesce(gallery.actor_kind = 'user' AND gallery.latest_action = 'pin' AND gallery.bucket_kind = 'lq', false) AS user_pinned_lq,
      coalesce(user_override.blocked, false) AS blocked_prime,
      coalesce(modifiers.items, '[]'::jsonb) AS face_modifiers,
      coalesce(contexts.items, '[]'::jsonb) AS capture_contexts,
      coalesce(review.needs_sort, false) AS person_needs_sort,
      jsonb_strip_nulls(jsonb_build_object(
        'blur_score', fo.quality_measurements->'blur_score',
        'frontal_score', fo.quality_measurements->'frontal_score',
        'quality_bucket', fo.quality_measurements->'quality_bucket'
      )) AS condition_features
    FROM current_face_identity cfi
    JOIN current_person subject ON subject.person_id = cfi.person_id AND subject.subject_kind = 'person'
    JOIN identity_claim ic ON ic.identity_claim_id = cfi.identity_claim_id
    JOIN face_observation fo ON fo.face_id = cfi.face_id AND fo.state = 'valid'
    JOIN asset a ON a.asset_id = fo.asset_id
    JOIN face_embedding fe ON fe.face_id = fo.face_id AND fe.state = 'active'
    LEFT JOIN current_manual_face_matching_evidence manual_evidence
      ON manual_evidence.face_id = fo.face_id
      AND manual_evidence.identity_claim_id = cfi.identity_claim_id
      AND manual_evidence.model_family = fe.model_family
      AND manual_evidence.model_version = fe.model_version
      AND manual_evidence.config_digest = fe.config_digest
      AND manual_evidence.embedding_id = fe.embedding_id
      AND manual_evidence.vector_digest = fe.vector_digest
    LEFT JOIN LATERAL (
      SELECT max(1 - (fe.embedding <=> other.embedding))::float8 AS max_other_prime_similarity
      FROM current_reference_prototype other
      WHERE other.person_id <> cfi.person_id
        AND other.model_family = fe.model_family
        AND other.model_version = fe.model_version
        AND other.config_digest = fe.config_digest
    ) competitor ON true
    LEFT JOIN decision d ON d.decision_id = ic.decision_id
    LEFT JOIN current_person_review_state review ON review.person_id = cfi.person_id
    LEFT JOIN LATERAL (
      SELECT g.bucket_kind, g.actor_kind, g.latest_action
      FROM current_reference_gallery g
      WHERE g.person_id = cfi.person_id AND g.face_id = fo.face_id
        AND g.bucket_kind IN ('prime','secondary','lq') AND g.membership_state = 'active'
      ORDER BY CASE g.bucket_kind WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END
      LIMIT 1
    ) gallery ON true
    LEFT JOIN LATERAL (
      SELECT true AS blocked
      WHERE NOT coalesce(gallery.bucket_kind = 'prime' AND gallery.latest_action = 'pin', false)
        AND (
          EXISTS (
            SELECT 1
            FROM bucket_membership_event e
            JOIN reference_bucket b ON b.bucket_id = e.bucket_id
            WHERE b.person_id = cfi.person_id AND e.face_id = fo.face_id
              AND b.bucket_kind IN ('prime','secondary','lq','head') AND e.actor_kind = 'user'
          )
          OR EXISTS (
            SELECT 1
            FROM current_reference_gallery head
            WHERE head.person_id = cfi.person_id AND head.face_id = fo.face_id
              AND head.bucket_kind = 'head' AND head.membership_state = 'active'
          )
        )
      LIMIT 1
    ) user_override ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
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
      WHERE modifier.face_id = fo.face_id
    ) modifiers ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
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
      WHERE context.face_id = fo.face_id
    ) contexts ON true
    WHERE cfi.state = 'accepted'
      AND (fo.observation_origin <> 'manual_user'
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
    maxOtherPrimeSimilarity: row.max_other_prime_similarity,
    personId: row.person_id,
    personNeedsSort: row.person_needs_sort,
    pinnedPrime:
      row.observation_origin === "manual_user" ? false : row.pinned_prime,
    quality: row.quality,
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
