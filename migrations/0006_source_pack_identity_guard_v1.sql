BEGIN;

CREATE OR REPLACE FUNCTION enforce_source_pack_activation_gate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_manifest_mismatches integer;
  v_untrusted_references integer;
BEGIN
  IF NEW.state = 'active' AND OLD.state IS DISTINCT FROM 'active' THEN
    IF NEW.evaluation_status <> 'passed' THEN
      RAISE EXCEPTION 'SourcePack activation requires passed evaluation' USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_manifest_mismatches
    FROM (
      SELECT coalesce(r.reference_id, m.reference_id) AS reference_id
      FROM (SELECT * FROM source_pack_reference WHERE pack_id = NEW.pack_id) r
      FULL OUTER JOIN (
        SELECT item->>'referenceId' AS reference_id, item->>'vectorDigest' AS vector_digest
        FROM jsonb_array_elements(NEW.manifest->'referenceDigests') item
      ) m ON m.reference_id = r.reference_id AND m.vector_digest = r.vector_digest
      WHERE r.reference_id IS NULL OR m.reference_id IS NULL
    ) mismatches;
    IF v_manifest_mismatches <> 0 THEN
      RAISE EXCEPTION 'SourcePack activation manifest/reference mismatch' USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_untrusted_references
    FROM source_pack_reference r
    LEFT JOIN current_face_identity cfi
      ON cfi.face_id = r.face_id AND cfi.person_id = r.person_id
    LEFT JOIN identity_claim ic ON ic.identity_claim_id = cfi.identity_claim_id
    LEFT JOIN decision d ON d.decision_id = ic.decision_id
    WHERE r.pack_id = NEW.pack_id AND r.reference_kind = 'face'
      AND NOT coalesce(
        cfi.state = 'accepted' AND (cfi.origin IN ('trusted_import','user') OR d.actor_kind = 'user'),
        false
      );
    IF v_untrusted_references <> 0 THEN
      RAISE EXCEPTION 'SourcePack activation contains corrected or untrusted identity evidence' USING ERRCODE = '23514';
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
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
