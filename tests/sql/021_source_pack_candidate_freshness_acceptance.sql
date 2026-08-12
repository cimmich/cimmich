\set ON_ERROR_STOP on

INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, observed_asset_count, state, privacy_class
) VALUES (
  'snapshot_candidate_freshness_fixture', 'fixture.v1', repeat('6', 64),
  'candidate-freshness-fixture', now(), now(), 1, 'complete', 'private'
);

INSERT INTO asset (
  asset_id, locator_token, media_kind, mime_type, width, height,
  source_snapshot_id, state, privacy_class
) VALUES (
  'asset_candidate_freshness_fixture', 'candidate-freshness.jpg',
  'image', 'image/jpeg', 100, 100,
  'snapshot_candidate_freshness_fixture', 'active', 'private'
);

INSERT INTO person (
  person_id, display_name, status, subject_kind, created_by_receipt_id,
  privacy_class
)
SELECT 'person_candidate_freshness_fixture', 'Candidate Freshness Fixture',
  'active', 'person', producer_receipt_id, 'sensitive-biometric'
FROM producer_receipt
ORDER BY created_at, producer_receipt_id
LIMIT 1;

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id, privacy_class
)
SELECT 'face_candidate_freshness_fixture',
  'asset_candidate_freshness_fixture', 0.1, 0.1, 0.2, 0.2, 0.9,
  '{}'::jsonb, 'valid', producer_receipt_id, 'sensitive-biometric'
FROM producer_receipt
ORDER BY created_at, producer_receipt_id
LIMIT 1;

DO $$
DECLARE
  v_fixture_pack text := 'sourcepack_candidate_freshness_fixture';
  v_fixture_claim text := 'claim_candidate_freshness_fixture';
  v_rejected boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM identity_claim claim
    JOIN source_pack pack
      ON pack.pack_id = claim.evidence_refs->>'source_pack_id'
    WHERE claim.state = 'candidate'
      AND claim.origin = 'prime_match'
      AND pack.state <> 'active'
  ) THEN
    RAISE EXCEPTION 'inactive SourcePack candidate survived schema 131';
  END IF;

  INSERT INTO source_pack (
    pack_id, pack_digest, model_family, model_version, config_digest,
    dimension, policy_version, source_revision_digest, evidence_cutoff,
    manifest, state, evaluation_status, evaluation_summary,
    producer_receipt_id, privacy_class
  )
  SELECT v_fixture_pack, repeat('9', 64), 'fixture-family', 'fixture-v1',
    repeat('8', 64), 512, 'cimmich-best-prime-v1', repeat('7', 64), now(),
    '{}'::jsonb, 'retired', 'passed',
    jsonb_build_object(
      'matcherPolicy', jsonb_build_object(
        'policyVersion', 'cimmich-best-prime-v1'
      )
    ),
    producer_receipt_id, 'sensitive-biometric'
  FROM producer_receipt
  ORDER BY created_at, producer_receipt_id
  LIMIT 1;

  BEGIN
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state,
      calibrated_confidence, evidence_refs, decision_id,
      producer_receipt_id, privacy_class
    )
    SELECT v_fixture_claim, face.face_id, person.person_id,
      'prime_match', 'candidate', 0.9,
      jsonb_build_object(
        'assignment_decision', 'source_pack_prime_match',
        'policy_version', 'cimmich-best-prime-v1',
        'source_pack_id', v_fixture_pack
      ),
      NULL, face.producer_receipt_id, 'sensitive-biometric'
    FROM face_observation face
    JOIN person ON person.person_id = 'person_candidate_freshness_fixture'
    WHERE face.face_id = 'face_candidate_freshness_fixture';
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'retired SourcePack candidate insert was not rejected';
  END IF;

  -- Construct the synthetic active state without invoking the unrelated
  -- evaluation fixture, then exercise the real writer guard and retirement
  -- trigger with triggers fully enabled.
  SET LOCAL session_replication_role = replica;
  UPDATE source_pack SET state = 'active' WHERE pack_id = v_fixture_pack;
  SET LOCAL session_replication_role = origin;

  INSERT INTO identity_claim (
    identity_claim_id, face_id, person_id, origin, state,
    calibrated_confidence, evidence_refs, decision_id,
    producer_receipt_id, privacy_class
  )
  SELECT v_fixture_claim, face.face_id, person.person_id,
    'prime_match', 'candidate', 0.9,
    jsonb_build_object(
      'assignment_decision', 'source_pack_prime_match',
      'policy_version', 'cimmich-best-prime-v1',
      'source_pack_id', v_fixture_pack
    ),
    NULL, face.producer_receipt_id, 'sensitive-biometric'
  FROM face_observation face
  JOIN person ON person.person_id = 'person_candidate_freshness_fixture'
  WHERE face.face_id = 'face_candidate_freshness_fixture';

  UPDATE source_pack SET state = 'retired' WHERE pack_id = v_fixture_pack;

  IF NOT EXISTS (
    SELECT 1 FROM identity_claim
    WHERE identity_claim_id = v_fixture_claim
      AND state = 'superseded'
      AND decision_id = 'decision_pack_stale_' || substr(
        encode(digest('source-pack-not-active:' || v_fixture_claim, 'sha256'), 'hex'),
        1, 40
      )
  ) THEN
    RAISE EXCEPTION 'active SourcePack retirement did not supersede candidate';
  END IF;

  DELETE FROM identity_claim WHERE identity_claim_id = v_fixture_claim;
  DELETE FROM decision
  WHERE decision_id = 'decision_pack_stale_' || substr(
    encode(digest('source-pack-not-active:' || v_fixture_claim, 'sha256'), 'hex'),
    1, 40
  );
  DELETE FROM source_pack WHERE pack_id = v_fixture_pack;
END;
$$;

DELETE FROM face_observation WHERE face_id = 'face_candidate_freshness_fixture';
DELETE FROM person WHERE person_id = 'person_candidate_freshness_fixture';
DELETE FROM asset WHERE asset_id = 'asset_candidate_freshness_fixture';
DELETE FROM source_snapshot WHERE snapshot_id = 'snapshot_candidate_freshness_fixture';

SELECT 'Cimmich SourcePack candidate freshness acceptance: PASS' AS result;
