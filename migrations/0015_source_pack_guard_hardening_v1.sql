BEGIN;

-- SourcePack safety is a property of every active row, not only the transition
-- that happened to activate it. Recheck the complete contract on INSERT and on
-- every update that could weaken an active pack.
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
  LEFT JOIN LATERAL (
    SELECT count(*) AS member_count, count(*) FILTER (
      WHERE cfi.state = 'accepted'
        AND cfi.person_id = r.person_id
        AND (cfi.origin IN ('trusted_import','user') OR decision.actor_kind = 'user')
    ) AS trusted_count
    FROM unnest(
      CASE WHEN r.reference_kind = 'face' THEN ARRAY[r.face_id] ELSE r.member_face_ids END
    ) member(face_id)
    LEFT JOIN current_face_identity cfi ON cfi.face_id = member.face_id
    LEFT JOIN identity_claim claim ON claim.identity_claim_id = cfi.identity_claim_id
    LEFT JOIN decision ON decision.decision_id = claim.decision_id
  ) trust ON true
  WHERE r.pack_id = NEW.pack_id
    AND (
      r.model_family <> NEW.model_family
      OR r.model_version <> NEW.model_version
      OR r.config_digest <> NEW.config_digest
      OR r.dimension <> NEW.dimension
      OR trust.member_count = 0
      OR trust.trusted_count <> trust.member_count
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

DROP TRIGGER IF EXISTS source_pack_activation_guard ON source_pack;
CREATE TRIGGER source_pack_activation_guard
BEFORE INSERT OR UPDATE OF state, evaluation_status ON source_pack
FOR EACH ROW EXECUTE FUNCTION enforce_source_pack_activation_gate();

CREATE OR REPLACE FUNCTION enforce_source_pack_reference_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pack_id text := coalesce(NEW.pack_id, OLD.pack_id);
  v_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'SourcePack references are immutable; compile a successor pack' USING ERRCODE = '23514';
  END IF;

  SELECT state INTO v_state FROM source_pack WHERE pack_id = v_pack_id;
  IF v_state IN ('active','retired','rejected') THEN
    RAISE EXCEPTION 'Terminal SourcePack references are immutable; compile a successor pack' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_pack_reference_immutable ON source_pack_reference;
CREATE TRIGGER source_pack_reference_immutable
BEFORE INSERT OR UPDATE OR DELETE ON source_pack_reference
FOR EACH ROW EXECUTE FUNCTION enforce_source_pack_reference_immutability();

COMMIT;
