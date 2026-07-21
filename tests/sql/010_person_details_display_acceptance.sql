BEGIN;

DO $$
DECLARE
  v_constraint_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM producer_receipt
    WHERE producer_receipt_id = 'receipt_cimmich_person_details_display_v1'
  ) THEN
    RAISE EXCEPTION 'Person Details display producer receipt is missing';
  END IF;

  IF (SELECT count(*) FROM person_details_display_default
      WHERE owner_id = 'local-primary') <> 9 THEN
    RAISE EXCEPTION 'Person Details display defaults are incomplete';
  END IF;

  IF EXISTS (
    SELECT section_key FROM person_details_display_default
    WHERE owner_id = 'local-primary'
    GROUP BY section_key HAVING count(*) > 1
  ) OR EXISTS (
    SELECT display_order FROM person_details_display_default
    WHERE owner_id = 'local-primary'
    GROUP BY display_order HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Person Details defaults are not uniquely ordered';
  END IF;

  BEGIN
    INSERT INTO person_details_display_override (
      owner_id, person_id, section_key, visibility
    ) VALUES (
      'local-primary', 'pet_cafe_fixture', 'about', 'hide'
    );
    RAISE EXCEPTION 'Pet received a human Person Details override';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO person_details_display_override (
      owner_id, person_id, section_key, visibility
    ) VALUES (
      'local-primary', 'person_profile_acceptance_fixture', 'email', 'hide'
    );
    RAISE EXCEPTION 'Retired split Contact section was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT count(*)::int INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid IN (
    'person_details_display_default'::regclass,
    'person_details_display_override'::regclass,
    'person_details_display_command'::regclass
  ) AND contype IN ('c','f','p','u');
  IF v_constraint_count < 13 THEN
    RAISE EXCEPTION 'Person Details display constraint surface is unexpectedly small: %',
      v_constraint_count;
  END IF;
END;
$$;

COMMIT;
