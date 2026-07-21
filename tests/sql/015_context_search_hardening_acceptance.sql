BEGIN;

DO $$
DECLARE
  v_index_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM producer_receipt
    WHERE producer_receipt_id = 'receipt_cimmich_context_search_hardening_v1'
  ) THEN
    RAISE EXCEPTION 'Context/search hardening receipt is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm search support is missing';
  END IF;

  SELECT count(*)::int INTO v_index_count FROM pg_indexes
  WHERE schemaname = 'public' AND indexname IN (
    'context_entity_active_name_trgm',
    'context_entity_active_description_trgm',
    'context_alias_active_label_trgm',
    'person_active_name_trgm',
    'person_active_description_trgm',
    'person_alias_active_label_trgm',
    'asset_active_capture_time'
  );
  IF v_index_count <> 7 THEN
    RAISE EXCEPTION 'Expected seven context/search indexes, found %', v_index_count;
  END IF;

  INSERT INTO context_entity (
    entity_id, entity_kind, place_kind, display_name
  ) VALUES
    ('place_46000000000000000000000000000001', 'place', 'unlocated', 'Hardening parent'),
    ('place_46000000000000000000000000000002', 'place', 'unlocated', 'Hardening child');
  INSERT INTO context_entity (
    entity_id, entity_kind, object_kind, display_name
  ) VALUES
    ('object_46000000000000000000000000000001', 'object', 'other', 'Hardening object one'),
    ('object_46000000000000000000000000000002', 'object', 'other', 'Hardening object two');
  UPDATE context_entity
  SET parent_entity_id = 'place_46000000000000000000000000000001'
  WHERE entity_id = 'place_46000000000000000000000000000002';

  BEGIN
    UPDATE context_entity
    SET parent_entity_id = 'place_46000000000000000000000000000002'
    WHERE entity_id = 'place_46000000000000000000000000000001';
    RAISE EXCEPTION 'Context parent cycle was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE context_entity SET status = 'archived'
    WHERE entity_id = 'place_46000000000000000000000000000001';
    RAISE EXCEPTION 'Parent with a current child was archived';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO context_relation_link (
      link_id, entity_id, target_kind, target_id, relation_kind, state,
      decision_id
    ) VALUES (
      'contextrel_46000000000000000000000000000001',
      'object_46000000000000000000000000000001', 'object',
      'object_46000000000000000000000000000002', 'parent', 'accepted',
      'decision_identity_fixture'
    );
    RAISE EXCEPTION 'Object parent relation was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  DELETE FROM context_entity WHERE entity_id IN (
    'place_46000000000000000000000000000002',
    'place_46000000000000000000000000000001',
    'object_46000000000000000000000000000001',
    'object_46000000000000000000000000000002'
  );
END;
$$;

COMMIT;
