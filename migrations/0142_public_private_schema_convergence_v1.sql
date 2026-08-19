BEGIN;

-- Public Preview 12 and the private production line independently used schema
-- version 131. Reconcile both exact historical ledgers into one schema. Every
-- operation is replay-safe because either predecessor may already be present.

ALTER TABLE asset_label
  ADD COLUMN IF NOT EXISTS label_kind text NOT NULL DEFAULT 'label' CHECK (
    label_kind IN ('label','collection','favorite','archive')
  );

ALTER TABLE asset_label
  DROP CONSTRAINT IF EXISTS asset_label_normalized_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS asset_label_kind_normalized_name_unique
  ON asset_label(label_kind, normalized_name);

CREATE UNIQUE INDEX IF NOT EXISTS asset_label_one_favorite_kind
  ON asset_label(label_kind)
  WHERE label_kind = 'favorite' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS asset_label_one_archive_kind
  ON asset_label(label_kind)
  WHERE label_kind = 'archive' AND status = 'active';

INSERT INTO asset_label (
  label_id, display_name, normalized_name, label_kind,
  created_by_actor_id, privacy_class
) VALUES
  (
    'label_00000000000000000000000000000001', 'Favourite',
    '__cimmich_system_favorite__', 'favorite', 'system:migration-0142',
    'private'
  ),
  (
    'label_00000000000000000000000000000002', 'Archived',
    '__cimmich_system_archive__', 'archive', 'system:migration-0142',
    'private'
  )
ON CONFLICT DO NOTHING;

ALTER TABLE bulk_album_operation_checkpoint
  ADD COLUMN IF NOT EXISTS organization_decision_id text
    REFERENCES asset_label_decision(decision_id),
  ADD COLUMN IF NOT EXISTS legacy_immich_album_id text;

UPDATE bulk_album_operation_checkpoint
SET legacy_immich_album_id = album_id
WHERE state = 'applied' AND legacy_immich_album_id IS NULL;

UPDATE bulk_album_operation
SET state = 'kept', completed_at = coalesce(completed_at, now()),
  updated_at = now()
WHERE state IN ('applying','applied','partial','undoing');

COMMENT ON COLUMN asset_label.label_kind IS
  'Cimmich-owned organisation kind. Collections, favourite state and archive state never mutate Immich.';
COMMENT ON COLUMN bulk_album_operation_checkpoint.organization_decision_id IS
  'Exact Cimmich asset-label decision used by collection Undo after schema 131.';
COMMENT ON COLUMN bulk_album_operation_checkpoint.legacy_immich_album_id IS
  'Preserved identifier from a pre-131 Immich album receipt. Cimmich never writes through it.';

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_source_pack_candidate_freshness_v1', 'system',
  'cimmich-source-pack-candidate-freshness', 'v1', now(), now(),
  encode(digest('cimmich.source-pack-candidate-freshness.v1', 'sha256'), 'hex'),
  'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

CREATE OR REPLACE FUNCTION cimmich_supersede_source_pack_candidates(
  p_pack_id text
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  INSERT INTO decision (
    decision_id, subject_type, subject_id, action, actor_kind, actor_id,
    reason_code, note, producer_receipt_id, privacy_class
  )
  SELECT
    'decision_pack_stale_' || substr(
      encode(digest('source-pack-not-active:' || claim.identity_claim_id, 'sha256'), 'hex'),
      1, 40
    ),
    'identity_claim', claim.identity_claim_id, 'ignore', 'policy',
    'cimmich-source-pack-candidate-freshness-v1',
    'source_pack_not_active',
    'Supersede machine proposal because its evaluated SourcePack is no longer active',
    'receipt_cimmich_source_pack_candidate_freshness_v1',
    'sensitive-biometric'
  FROM identity_claim claim
  WHERE claim.state = 'candidate'
    AND claim.origin = 'prime_match'
    AND coalesce(claim.evidence_refs->>'assignment_decision', '') =
      'source_pack_prime_match'
    AND coalesce(nullif(claim.evidence_refs->>'source_pack_id', ''), '') =
      coalesce(p_pack_id, '')
  ON CONFLICT (decision_id) DO NOTHING;

  UPDATE identity_claim claim
  SET state = 'superseded',
      decision_id = 'decision_pack_stale_' || substr(
        encode(digest('source-pack-not-active:' || claim.identity_claim_id, 'sha256'), 'hex'),
        1, 40
      )
  WHERE claim.state = 'candidate'
    AND claim.origin = 'prime_match'
    AND coalesce(claim.evidence_refs->>'assignment_decision', '') =
      'source_pack_prime_match'
    AND coalesce(nullif(claim.evidence_refs->>'source_pack_id', ''), '') =
      coalesce(p_pack_id, '');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION cimmich_retire_source_pack_candidates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM cimmich_supersede_source_pack_candidates(OLD.pack_id);
    RETURN OLD;
  END IF;
  IF OLD.state = 'active' AND (
    NEW.state <> 'active'
    OR NEW.evaluation_status <> 'passed'
    OR OLD.evaluation_summary->'matcherPolicy'->>'policyVersion'
      IS DISTINCT FROM
      NEW.evaluation_summary->'matcherPolicy'->>'policyVersion'
  ) THEN
    PERFORM cimmich_supersede_source_pack_candidates(NEW.pack_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_pack_retires_candidates ON source_pack;
CREATE TRIGGER source_pack_retires_candidates
AFTER UPDATE OF state, evaluation_status, evaluation_summary OR DELETE ON source_pack
FOR EACH ROW
EXECUTE FUNCTION cimmich_retire_source_pack_candidates();

CREATE OR REPLACE FUNCTION cimmich_enforce_candidate_source_pack_freshness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pack_id text;
  v_pack_state text;
  v_evaluation_status text;
  v_policy_version text;
BEGIN
  IF NEW.state <> 'candidate' OR NEW.origin <> 'prime_match' THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.evidence_refs->>'assignment_decision', '') <>
      'source_pack_prime_match' THEN
    RETURN NEW;
  END IF;

  v_pack_id := nullif(NEW.evidence_refs->>'source_pack_id', '');
  IF v_pack_id IS NULL THEN
    RAISE EXCEPTION 'Prime-match candidate requires a current SourcePack'
      USING ERRCODE = '23514';
  END IF;

  SELECT pack.state, pack.evaluation_status,
    pack.evaluation_summary->'matcherPolicy'->>'policyVersion'
  INTO v_pack_state, v_evaluation_status, v_policy_version
  FROM source_pack pack
  WHERE pack.pack_id = v_pack_id
  FOR SHARE;

  IF v_pack_state IS DISTINCT FROM 'active'
    OR v_evaluation_status IS DISTINCT FROM 'passed'
    OR v_policy_version IS DISTINCT FROM NEW.evidence_refs->>'policy_version' THEN
    RAISE EXCEPTION 'Prime-match candidate SourcePack is not current'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS identity_candidate_source_pack_freshness ON identity_claim;
CREATE TRIGGER identity_candidate_source_pack_freshness
BEFORE INSERT OR UPDATE OF state, origin, evidence_refs ON identity_claim
FOR EACH ROW
EXECUTE FUNCTION cimmich_enforce_candidate_source_pack_freshness();

SELECT cimmich_supersede_source_pack_candidates(stale.pack_id)
FROM (
  SELECT DISTINCT nullif(claim.evidence_refs->>'source_pack_id', '') AS pack_id
  FROM identity_claim claim
  LEFT JOIN source_pack pack
    ON pack.pack_id = claim.evidence_refs->>'source_pack_id'
  WHERE claim.state = 'candidate'
    AND claim.origin = 'prime_match'
    AND coalesce(claim.evidence_refs->>'assignment_decision', '') =
      'source_pack_prime_match'
    AND coalesce(pack.state, 'missing') <> 'active'
) stale;

COMMIT;
