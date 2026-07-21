BEGIN;

CREATE FUNCTION prevent_source_pack_content_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pack_id IS DISTINCT FROM OLD.pack_id
    OR NEW.pack_digest IS DISTINCT FROM OLD.pack_digest
    OR NEW.predecessor_pack_id IS DISTINCT FROM OLD.predecessor_pack_id
    OR NEW.model_family IS DISTINCT FROM OLD.model_family
    OR NEW.model_version IS DISTINCT FROM OLD.model_version
    OR NEW.config_digest IS DISTINCT FROM OLD.config_digest
    OR NEW.dimension IS DISTINCT FROM OLD.dimension
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.source_revision_digest IS DISTINCT FROM OLD.source_revision_digest
    OR NEW.evidence_cutoff IS DISTINCT FROM OLD.evidence_cutoff
    OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.producer_receipt_id IS DISTINCT FROM OLD.producer_receipt_id
    OR NEW.privacy_class IS DISTINCT FROM OLD.privacy_class
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'SourcePack content is immutable; compile a successor pack' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_pack_content_immutable
BEFORE UPDATE ON source_pack
FOR EACH ROW EXECUTE FUNCTION prevent_source_pack_content_update();

CREATE FUNCTION prevent_source_pack_reference_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SourcePack references are immutable; compile a successor pack' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER source_pack_reference_immutable
BEFORE UPDATE ON source_pack_reference
FOR EACH ROW EXECUTE FUNCTION prevent_source_pack_reference_update();

CREATE FUNCTION enforce_source_pack_activation_gate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_manifest_mismatches integer;
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

CREATE TRIGGER source_pack_activation_guard
BEFORE UPDATE OF state ON source_pack
FOR EACH ROW EXECUTE FUNCTION enforce_source_pack_activation_gate();

COMMIT;
