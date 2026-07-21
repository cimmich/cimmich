BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_source_pack_activation_current_claim_guard_v1',
    'system', 'cimmich-source-pack-activation-current-claim-guard', 'v1',
    now(), now(),
    encode(digest('cimmich-source-pack-activation-current-claim-guard-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_source_pack_activation_gate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_manifest_mismatches integer;
  v_untrusted_references integer;
BEGIN
  IF NEW.state <> 'active' THEN RETURN NEW; END IF;
  IF NEW.evaluation_status <> 'passed' THEN
    RAISE EXCEPTION 'SourcePack activation requires passed evaluation'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM source_pack_reference reference WHERE reference.pack_id = NEW.pack_id
  ) THEN
    RAISE EXCEPTION 'SourcePack activation requires at least one reference'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_manifest_mismatches FROM (
    SELECT coalesce(reference.reference_id, manifest.reference_id) AS reference_id
    FROM (
      SELECT reference_id, vector_digest FROM source_pack_reference
      WHERE pack_id = NEW.pack_id
    ) reference
    FULL OUTER JOIN (
      SELECT item->>'referenceId' AS reference_id,
        item->>'vectorDigest' AS vector_digest
      FROM jsonb_array_elements(
        coalesce(NEW.manifest->'referenceDigests', '[]'::jsonb)
      ) item
    ) manifest ON manifest.reference_id = reference.reference_id
      AND manifest.vector_digest = reference.vector_digest
    WHERE reference.reference_id IS NULL OR manifest.reference_id IS NULL
  ) mismatches;
  IF v_manifest_mismatches <> 0 THEN
    RAISE EXCEPTION 'SourcePack activation manifest/reference mismatch'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_untrusted_references
  FROM source_pack_reference reference
  LEFT JOIN LATERAL (
    SELECT count(*) AS member_count, count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM current_face_identity identity
        JOIN face_observation face ON face.face_id = identity.face_id
        JOIN identity_claim claim
          ON claim.identity_claim_id = identity.identity_claim_id
        LEFT JOIN decision ON decision.decision_id = claim.decision_id
        WHERE identity.face_id = member.face_id
          AND identity.state = 'accepted'
          AND identity.person_id = reference.person_id
          AND (identity.origin IN ('trusted_import','user')
            OR decision.actor_kind = 'user')
          AND (face.observation_origin <> 'manual_user' OR EXISTS (
            SELECT 1 FROM current_manual_face_matching_evidence lifecycle
            WHERE lifecycle.face_id = member.face_id
              AND lifecycle.identity_claim_id = identity.identity_claim_id
              AND lifecycle.model_family = reference.model_family
              AND lifecycle.model_version = reference.model_version
              AND lifecycle.config_digest = reference.config_digest
              AND lifecycle.vector_digest = reference.vector_digest
          ))
      )
    ) AS trusted_count
    FROM unnest(
      CASE WHEN reference.reference_kind = 'face'
        THEN ARRAY[reference.face_id] ELSE reference.member_face_ids END
    ) member(face_id)
  ) trust ON true
  WHERE reference.pack_id = NEW.pack_id
    AND (
      reference.model_family <> NEW.model_family
      OR reference.model_version <> NEW.model_version
      OR reference.config_digest <> NEW.config_digest
      OR reference.dimension <> NEW.dimension
      OR trust.member_count = 0
      OR trust.trusted_count <> trust.member_count
    );
  IF v_untrusted_references <> 0 THEN
    RAISE EXCEPTION 'SourcePack activation contains ineligible or untrusted identity evidence'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM source_pack_evaluation evaluation
    WHERE evaluation.pack_id = NEW.pack_id AND evaluation.status = 'passed'
      AND coalesce((evaluation.leakage_assertions->>'passed')::boolean, false)
      AND coalesce((evaluation.metrics->>'verifiedUnknowns')::integer, 0) > 0
  ) THEN
    RAISE EXCEPTION 'SourcePack activation requires leakage-safe verified-unknown proof'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
