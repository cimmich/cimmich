BEGIN;

DO $$
DECLARE
  v_constraint_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM producer_receipt
    WHERE producer_receipt_id = 'receipt_cimmich_context_entity_v1'
  ) THEN
    RAISE EXCEPTION 'Context entity producer receipt is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM producer_receipt
    WHERE producer_receipt_id = 'receipt_cimmich_context_search_projection_v1'
  ) THEN
    RAISE EXCEPTION 'Context search projection receipt is missing';
  END IF;

  INSERT INTO context_entity (
    entity_id, entity_kind, place_kind, display_name, geometry
  ) VALUES (
    'place_00000000000000000000000000000001', 'place', 'point',
    'Synthetic SQL place', '{"latitude":-33.86,"longitude":151.21}'
  );
  INSERT INTO context_entity (
    entity_id, entity_kind, event_kind, display_name, date_start, date_end,
    date_precision
  ) VALUES (
    'event_00000000000000000000000000000001', 'event', 'trip',
    'Synthetic SQL trip', '2025-01-01', '2025-01-02', 'exact'
  );
  INSERT INTO context_entity (
    entity_id, entity_kind, object_kind, display_name
  ) VALUES (
    'object_00000000000000000000000000000001', 'object', 'vehicle',
    'Synthetic SQL car'
  );

  BEGIN
    INSERT INTO context_entity (
      entity_id, entity_kind, place_kind, display_name, geometry
    ) VALUES (
      'place_00000000000000000000000000000002', 'place', 'point',
      'Invalid point', '{"latitude":100,"longitude":151.21}'
    );
    RAISE EXCEPTION 'Out-of-range Place geometry was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE context_entity
    SET parent_entity_id = 'event_00000000000000000000000000000001'
    WHERE entity_id = 'place_00000000000000000000000000000001';
    RAISE EXCEPTION 'Cross-kind context parent was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO context_relation_link (
      link_id, entity_id, target_kind, target_id, relation_kind, state,
      decision_id
    ) VALUES (
      'contextrel_00000000000000000000000000000001',
      'event_00000000000000000000000000000001', 'pet',
      'person_service_fixture', 'participant', 'accepted',
      'decision_identity_fixture'
    );
    RAISE EXCEPTION 'Participant role accepted a Pet target';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO context_asset_link (
      link_id, entity_id, asset_id, association_kind, state, decision_id
    ) VALUES (
      'contextasset_00000000000000000000000000000001',
      'object_00000000000000000000000000000001', 'asset_service_fixture',
      'captured_at', 'accepted', 'decision_identity_fixture'
    );
    RAISE EXCEPTION 'Place-only association was accepted for an Object';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT count(*)::int INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid IN (
    'context_entity'::regclass,
    'context_entity_alias'::regclass,
    'context_asset_link'::regclass,
    'context_relation_link'::regclass,
    'context_command'::regclass,
    'context_operation'::regclass
  ) AND contype IN ('c','f','p','u');
  IF v_constraint_count < 40 THEN
    RAISE EXCEPTION 'Context entity constraint surface is unexpectedly small: %',
      v_constraint_count;
  END IF;

  DELETE FROM context_entity WHERE entity_id IN (
    'place_00000000000000000000000000000001',
    'event_00000000000000000000000000000001',
    'object_00000000000000000000000000000001'
  );
END;
$$;

COMMIT;
