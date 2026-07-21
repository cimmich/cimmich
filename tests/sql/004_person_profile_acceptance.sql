BEGIN;

DO $$
DECLARE
  v_constraint_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM producer_receipt
    WHERE producer_receipt_id = 'receipt_cimmich_person_profile_v1'
  ) THEN
    RAISE EXCEPTION 'Person Profile producer receipt is missing';
  END IF;

  IF (SELECT count(*) FROM person_profile_display_default
      WHERE owner_id = 'local-primary') <> 8 THEN
    RAISE EXCEPTION 'Person Profile hero defaults are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM person_category
    WHERE category_id = 'category_acquaintances'
      AND category_kind = 'relationship' AND state = 'active'
  ) OR NOT EXISTS (
    SELECT 1 FROM person_category
    WHERE category_id = 'category_others'
      AND category_kind = 'relationship' AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'Person Profile relationship catalogue is incomplete';
  END IF;

  INSERT INTO person (
    person_id, display_name, status, subject_kind,
    created_by_receipt_id, privacy_class
  ) VALUES
    ('person_profile_constraint_human', 'Constraint Human', 'active', 'person',
     'receipt_service_fixture', 'private'),
    ('person_profile_constraint_pet', 'Constraint Pet', 'active', 'pet',
     'receipt_service_fixture', 'private');

  BEGIN
    INSERT INTO person_profile (person_id, about)
    VALUES ('person_profile_constraint_pet', 'Must fail');
    RAISE EXCEPTION 'Pet received a human Person Profile';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO person_profile (
      person_id, gender_identity_kind, gender_identity_label
    ) VALUES (
      'person_profile_constraint_human', 'woman', 'Not permitted'
    );
    RAISE EXCEPTION 'Invalid gender identity/label pair was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO person_profile (person_id, about)
  VALUES ('person_profile_constraint_human', 'Constraint fixture');

  BEGIN
    INSERT INTO person_profile_item (
      item_id, person_id, item_kind, label, value_text, date_value
    ) VALUES (
      'profile_item_invalid_date', 'person_profile_constraint_human',
      'important_date', 'Birthday', 'Not a date', DATE '2020-01-01'
    );
    RAISE EXCEPTION 'Invalid typed date item was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO person_profile_display_override (
      owner_id, person_id, field_key, visibility
    ) VALUES (
      'local-primary', 'person_profile_constraint_human', 'about', 'sometimes'
    );
    RAISE EXCEPTION 'Invalid Person Profile visibility was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT count(*)::int INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid IN (
    'person_profile'::regclass,
    'person_profile_item'::regclass,
    'person_profile_display_default'::regclass,
    'person_profile_display_override'::regclass,
    'person_profile_command'::regclass
  ) AND contype IN ('c','f','p','u');
  IF v_constraint_count < 25 THEN
    RAISE EXCEPTION 'Person Profile database constraint surface is unexpectedly small: %',
      v_constraint_count;
  END IF;

  DELETE FROM person WHERE person_id IN (
    'person_profile_constraint_human', 'person_profile_constraint_pet'
  );

  INSERT INTO person (
    person_id, display_name, status, subject_kind,
    created_by_receipt_id, privacy_class
  ) VALUES (
    'person_profile_acceptance_fixture', 'Synthetic Profile Person',
    'active', 'person', 'receipt_service_fixture', 'private'
  );
END;
$$;

COMMIT;
