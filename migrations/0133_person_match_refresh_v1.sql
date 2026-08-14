BEGIN;

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_person_match_refresh_v1', 'system',
  'cimmich-person-match-refresh', 'v1', now(), now(),
  encode(digest('cimmich.person-match-refresh.v1', 'sha256'), 'hex'),
  'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

ALTER TABLE identity_claim
  DROP CONSTRAINT identity_claim_origin_check;
ALTER TABLE identity_claim
  ADD CONSTRAINT identity_claim_origin_check CHECK (origin IN (
    'user','trusted_import','import','prime_match','secondary_match',
    'specialty_match','cluster_propagation','person_refresh_match'
  ));

CREATE TABLE person_match_refresh_run (
  run_id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('processing','active','superseded','failed')),
  model_family text NOT NULL,
  model_version text NOT NULL,
  config_digest text NOT NULL,
  policy_version text NOT NULL,
  score_floor float8 NOT NULL CHECK (score_floor BETWEEN 0 AND 1),
  margin_floor float8 NOT NULL CHECK (margin_floor BETWEEN 0 AND 1),
  reference_set_digest text NOT NULL CHECK (reference_set_digest ~ '^[0-9a-f]{64}$'),
  reference_count integer NOT NULL DEFAULT 0 CHECK (reference_count >= 0),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  actor_id text NOT NULL,
  producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'processing') = (completed_at IS NULL))
);
CREATE UNIQUE INDEX person_match_refresh_one_active
  ON person_match_refresh_run(person_id) WHERE state = 'active';
CREATE INDEX person_match_refresh_person_recent
  ON person_match_refresh_run(person_id, created_at DESC, run_id DESC);

CREATE TABLE person_match_refresh_reference (
  run_id text NOT NULL REFERENCES person_match_refresh_run(run_id) ON DELETE CASCADE,
  face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE RESTRICT,
  asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE RESTRICT,
  vector_digest text NOT NULL,
  PRIMARY KEY (run_id, face_id)
);

CREATE OR REPLACE FUNCTION cimmich_person_candidate_reviewable(
  claim_origin text,
  evidence_refs jsonb,
  evaluated_pack_id text
) RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT (
    claim_origin = 'prime_match'
    AND evaluated_pack_id IS NOT NULL
    AND coalesce(evidence_refs->>'assignment_decision', '') =
      'source_pack_prime_match'
  ) OR (
    claim_origin = 'cluster_propagation'
    AND coalesce(evidence_refs->>'assignment_decision', '') =
      'cluster_propagation_candidate'
  ) OR (
    claim_origin = 'person_refresh_match'
    AND coalesce(evidence_refs->>'assignment_decision', '') =
      'person_refresh_prime_match'
    AND EXISTS (
      SELECT 1
      FROM person_match_refresh_run run
      WHERE run.run_id = evidence_refs->>'refresh_run_id'
        AND run.person_id = evidence_refs->>'person_id'
        AND run.state = 'active'
        AND run.reference_set_digest = evidence_refs->>'reference_set_digest'
        AND run.policy_version = evidence_refs->>'policy_version'
        AND NOT EXISTS (
          SELECT 1
          FROM person_match_refresh_reference reference
          WHERE reference.run_id = run.run_id
            AND NOT EXISTS (
              SELECT 1
              FROM current_face_physical_member reference_member
              JOIN current_face_physical_member identity_member
                ON identity_member.physical_face_id = reference_member.physical_face_id
              JOIN identity_claim accepted
                ON accepted.face_id = identity_member.face_id
                AND accepted.state = 'accepted'
                AND accepted.person_id = run.person_id
              WHERE reference_member.face_id = reference.face_id
            )
        )
    )
  )
$$;

CREATE OR REPLACE FUNCTION cimmich_enforce_candidate_source_pack_freshness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pack_id text;
  v_pack_state text;
  v_evaluation_status text;
  v_policy_version text;
  v_refresh_state text;
  v_refresh_person_id text;
  v_refresh_digest text;
BEGIN
  IF NEW.state <> 'candidate' THEN
    RETURN NEW;
  END IF;
  IF NEW.origin = 'person_refresh_match'
    AND coalesce(NEW.evidence_refs->>'assignment_decision', '') =
      'person_refresh_prime_match' THEN
    SELECT run.state, run.person_id, run.reference_set_digest,
      run.policy_version
    INTO v_refresh_state, v_refresh_person_id, v_refresh_digest,
      v_policy_version
    FROM person_match_refresh_run run
    WHERE run.run_id = NEW.evidence_refs->>'refresh_run_id'
    FOR SHARE;
    IF v_refresh_state NOT IN ('processing','active')
      OR v_refresh_person_id IS DISTINCT FROM NEW.person_id
      OR v_refresh_person_id IS DISTINCT FROM NEW.evidence_refs->>'person_id'
      OR v_refresh_digest IS DISTINCT FROM
        NEW.evidence_refs->>'reference_set_digest'
      OR v_policy_version IS DISTINCT FROM
        NEW.evidence_refs->>'policy_version' THEN
      RAISE EXCEPTION 'Person-refresh candidate run is not current'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.origin <> 'prime_match'
    OR coalesce(NEW.evidence_refs->>'assignment_decision', '') <>
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
    OR v_policy_version IS DISTINCT FROM
      NEW.evidence_refs->>'policy_version' THEN
    RAISE EXCEPTION 'Prime-match candidate SourcePack is not current'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cimmich_supersede_person_refresh_candidates(
  p_run_id text
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
  SELECT 'decision_person_refresh_stale_' || substr(encode(digest(
      'person-refresh-not-active:' || claim.identity_claim_id, 'sha256'
    ), 'hex'), 1, 40),
    'identity_claim', claim.identity_claim_id, 'ignore', 'policy',
    'cimmich-person-match-refresh-v1', 'person_refresh_not_active',
    'Supersede Person-refresh proposal because a newer matcher-photo scan replaced it',
    'receipt_cimmich_person_match_refresh_v1', 'sensitive-biometric'
  FROM identity_claim claim
  WHERE claim.state = 'candidate'
    AND claim.origin = 'person_refresh_match'
    AND claim.evidence_refs->>'refresh_run_id' = p_run_id
  ON CONFLICT (decision_id) DO NOTHING;

  UPDATE identity_claim claim
  SET state = 'superseded',
    decision_id = 'decision_person_refresh_stale_' || substr(encode(digest(
      'person-refresh-not-active:' || claim.identity_claim_id, 'sha256'
    ), 'hex'), 1, 40)
  WHERE claim.state = 'candidate'
    AND claim.origin = 'person_refresh_match'
    AND claim.evidence_refs->>'refresh_run_id' = p_run_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION cimmich_retire_person_refresh_candidates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM cimmich_supersede_person_refresh_candidates(OLD.run_id);
    RETURN OLD;
  END IF;
  IF OLD.state = 'active' AND NEW.state <> 'active' THEN
    PERFORM cimmich_supersede_person_refresh_candidates(OLD.run_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_match_refresh_retires_candidates
AFTER UPDATE OF state OR DELETE ON person_match_refresh_run
FOR EACH ROW EXECUTE FUNCTION cimmich_retire_person_refresh_candidates();

COMMIT;
