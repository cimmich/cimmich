BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_source_pack_activation_performance_v1', 'system',
    'cimmich-source-pack-activation-performance', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

-- Active identity is unique per face. SourcePack activation can therefore
-- validate its immutable references directly against the accepted claim rather
-- than repeatedly expanding and sorting the current_face_identity view.
CREATE INDEX IF NOT EXISTS identity_claim_accepted_face_person_cover
    ON identity_claim(face_id, person_id)
    INCLUDE (origin, decision_id)
    WHERE state = 'accepted';

CREATE INDEX IF NOT EXISTS source_pack_reference_activation_lookup
    ON source_pack_reference(pack_id, person_id, reference_kind)
    INCLUDE (face_id, member_face_ids, model_family, model_version, config_digest, dimension);

CREATE OR REPLACE FUNCTION enforce_source_pack_activation_gate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_manifest_mismatches integer;
  v_untrusted_references integer;
BEGIN
  IF NEW.state <> 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.evaluation_status <> 'passed' THEN
    RAISE EXCEPTION 'SourcePack activation requires passed evaluation' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM source_pack_reference r WHERE r.pack_id = NEW.pack_id) THEN
    RAISE EXCEPTION 'SourcePack activation requires at least one reference' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_manifest_mismatches
  FROM (
    SELECT coalesce(r.reference_id, m.reference_id) AS reference_id
    FROM (
      SELECT reference_id, vector_digest
      FROM source_pack_reference
      WHERE pack_id = NEW.pack_id
    ) r
    FULL OUTER JOIN (
      SELECT item->>'referenceId' AS reference_id, item->>'vectorDigest' AS vector_digest
      FROM jsonb_array_elements(coalesce(NEW.manifest->'referenceDigests', '[]'::jsonb)) item
    ) m ON m.reference_id = r.reference_id AND m.vector_digest = r.vector_digest
    WHERE r.reference_id IS NULL OR m.reference_id IS NULL
  ) mismatches;
  IF v_manifest_mismatches <> 0 THEN
    RAISE EXCEPTION 'SourcePack activation manifest/reference mismatch' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_untrusted_references
  FROM source_pack_reference r
  WHERE r.pack_id = NEW.pack_id
    AND (
      r.model_family <> NEW.model_family
      OR r.model_version <> NEW.model_version
      OR r.config_digest <> NEW.config_digest
      OR r.dimension <> NEW.dimension
      OR EXISTS (
        SELECT 1
        FROM unnest(
          CASE WHEN r.reference_kind = 'face' THEN ARRAY[r.face_id] ELSE r.member_face_ids END
        ) member(face_id)
        LEFT JOIN identity_claim claim
          ON claim.face_id = member.face_id
         AND claim.person_id = r.person_id
         AND claim.state = 'accepted'
        LEFT JOIN decision ON decision.decision_id = claim.decision_id
        WHERE claim.identity_claim_id IS NULL
           OR NOT (
             claim.origin IN ('trusted_import','user')
             OR decision.actor_kind = 'user'
           )
      )
    );
  IF v_untrusted_references <> 0 THEN
    RAISE EXCEPTION 'SourcePack activation contains mismatched, corrected, or untrusted identity evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM source_pack_evaluation e
    WHERE e.pack_id = NEW.pack_id
      AND e.status = 'passed'
      AND coalesce((e.leakage_assertions->>'passed')::boolean, false)
      AND coalesce((e.metrics->>'verifiedUnknowns')::integer, 0) > 0
  ) THEN
    RAISE EXCEPTION 'SourcePack activation requires leakage-safe verified-unknown proof' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- A passed pack is only safe while every referenced identity remains accepted.
-- Human correction is authoritative and must take effect before a successor is
-- compiled, evaluated, and activated. Retire (never mutate) any active pack
-- that contains the corrected face, including prototype membership.
CREATE OR REPLACE FUNCTION retire_source_pack_for_identity_correction()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_face_id text := OLD.face_id;
  v_person_id text := OLD.person_id;
  v_invalidated boolean := false;
BEGIN
  IF OLD.state = 'accepted' THEN
    IF TG_OP = 'DELETE' THEN
      v_invalidated := true;
    ELSE
      v_invalidated := NEW.state IS DISTINCT FROM 'accepted'
        OR NEW.person_id IS DISTINCT FROM OLD.person_id
        OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.decision_id IS DISTINCT FROM OLD.decision_id;
    END IF;
  END IF;
  IF v_invalidated THEN
    UPDATE source_pack pack
    SET state = 'retired'
    WHERE pack.state = 'active'
      AND EXISTS (
        SELECT 1
        FROM source_pack_reference reference
        WHERE reference.pack_id = pack.pack_id
          AND reference.person_id = v_person_id
          AND (
            reference.face_id = v_face_id
            OR v_face_id = ANY(reference.member_face_ids)
          )
      );
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS identity_correction_retires_source_pack ON identity_claim;
CREATE TRIGGER identity_correction_retires_source_pack
AFTER UPDATE OF state, person_id, origin, decision_id OR DELETE ON identity_claim
FOR EACH ROW EXECUTE FUNCTION retire_source_pack_for_identity_correction();

-- Repair any already-active row made stale before this dependency existed.
UPDATE source_pack pack
SET state = 'retired'
WHERE pack.state = 'active'
  AND EXISTS (
    SELECT 1
    FROM source_pack_reference reference
    WHERE reference.pack_id = pack.pack_id
      AND EXISTS (
        SELECT 1
        FROM unnest(
          CASE
            WHEN reference.reference_kind = 'face' THEN ARRAY[reference.face_id]
            ELSE reference.member_face_ids
          END
        ) member(face_id)
        LEFT JOIN identity_claim claim
          ON claim.face_id = member.face_id
         AND claim.person_id = reference.person_id
         AND claim.state = 'accepted'
        LEFT JOIN decision ON decision.decision_id = claim.decision_id
        WHERE claim.identity_claim_id IS NULL
           OR NOT (
             claim.origin IN ('trusted_import','user')
             OR decision.actor_kind = 'user'
           )
      )
  );

COMMIT;
