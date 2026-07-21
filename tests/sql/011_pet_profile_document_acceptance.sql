BEGIN;

DO $$
DECLARE
  v_constraint_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM producer_receipt
    WHERE producer_receipt_id = 'receipt_cimmich_pet_profile_document_v1'
  ) THEN
    RAISE EXCEPTION 'Pet profile/document producer receipt is missing';
  END IF;

  BEGIN
    UPDATE person SET breed_label = 'Not a human field'
    WHERE person_id = 'person_service_fixture';
    RAISE EXCEPTION 'Human Person received a Pet breed';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO pet_document_link (
      link_id, pet_id, asset_id, document_kind, state, decision_id,
      producer_receipt_id
    ) VALUES (
      'petdoc_00000000000000000000000000000001',
      'person_service_fixture', 'asset_service_fixture', 'other', 'accepted',
      'decision_identity_fixture', 'receipt_cimmich_pet_profile_document_v1'
    );
    RAISE EXCEPTION 'Human Person received a Pet document';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO pet_document_link (
      link_id, pet_id, asset_id, document_kind, state, decision_id,
      producer_receipt_id
    ) VALUES (
      'petdoc_00000000000000000000000000000002',
      'person_service_fixture', 'asset_service_fixture', 'medical_guess',
      'accepted', 'decision_identity_fixture',
      'receipt_cimmich_pet_profile_document_v1'
    );
    RAISE EXCEPTION 'Unknown Pet document kind was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT count(*)::int INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid IN (
    'pet_document_link'::regclass,
    'pet_document_command'::regclass,
    'pet_document_operation'::regclass
  ) AND contype IN ('c','f','p','u');
  IF v_constraint_count < 22 THEN
    RAISE EXCEPTION 'Pet document constraint surface is unexpectedly small: %',
      v_constraint_count;
  END IF;
END;
$$;

COMMIT;
