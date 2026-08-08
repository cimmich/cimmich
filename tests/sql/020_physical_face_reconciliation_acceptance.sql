DO $$
DECLARE
  v_active_group_id text;
BEGIN
  SELECT physical_face_id INTO v_active_group_id
  FROM physical_face
  WHERE asset_id = 'asset_physical_face_active';

  IF v_active_group_id IS NULL THEN
    RAISE EXCEPTION 'physical Face active group was not materialized';
  END IF;
  IF (SELECT state FROM physical_face WHERE physical_face_id = v_active_group_id)
      <> 'active' THEN
    RAISE EXCEPTION 'single accepted Person group was not active';
  END IF;
  IF (SELECT canonical_face_id FROM physical_face WHERE physical_face_id = v_active_group_id)
      <> 'face_physical_active_local' THEN
    RAISE EXCEPTION 'local detector Face was not canonical';
  END IF;
  IF (SELECT count(*) FROM physical_face_member
      WHERE physical_face_id = v_active_group_id) <> 3 THEN
    RAISE EXCEPTION 'parallel observations were not grouped once';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM current_physical_face_identity
    WHERE physical_face_id = v_active_group_id
      AND canonical_face_id = 'face_physical_active_local'
      AND person_id = 'person_physical_face_one' AND state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'accepted imported identity did not project to canonical Face';
  END IF;
  IF (SELECT state FROM identity_claim
      WHERE identity_claim_id = 'claim_physical_active_candidate') <> 'superseded' THEN
    RAISE EXCEPTION 'defective graph-v1 candidate was not retired';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM physical_face_reconciliation_action
    WHERE subject_id = 'claim_physical_active_candidate'
      AND reason_code = 'possible_people_graph_v1_parallel_observation_repair'
  ) THEN
    RAISE EXCEPTION 'candidate repair action was not recorded';
  END IF;
  IF (SELECT count(*) FROM identity_claim
      WHERE identity_claim_id IN (
        'claim_physical_active_accept',
        'claim_physical_conflict_one',
        'claim_physical_conflict_two'
      ) AND state = 'accepted') <> 3 THEN
    RAISE EXCEPTION 'accepted identity truth changed during reconciliation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM physical_face
    WHERE asset_id = 'asset_physical_face_conflict'
      AND state = 'conflict' AND accepted_person_count = 2
  ) THEN
    RAISE EXCEPTION 'different-Person overlap was not quarantined';
  END IF;
  IF EXISTS (
    SELECT 1 FROM current_matchable_physical_face
    WHERE asset_id = 'asset_physical_face_conflict'
  ) THEN
    RAISE EXCEPTION 'conflicting physical Face entered matching';
  END IF;
  IF (SELECT count(*) FROM current_display_face
      WHERE asset_id = 'asset_physical_face_conflict') <> 3 THEN
    RAISE EXCEPTION 'conflict quarantine hid raw observations from review';
  END IF;
END
$$;
