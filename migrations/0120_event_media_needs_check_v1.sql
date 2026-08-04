BEGIN;

-- Place coordinates can carry owner-visible provenance and uncertainty without
-- inventing a second location record or touching an asset's original EXIF.
-- Preserve every existing geometry shape while admitting only the two bounded
-- metadata keys validated by the service.
ALTER TABLE context_entity
  DROP CONSTRAINT context_entity_place_geometry;

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_place_geometry CHECK (
    (entity_kind <> 'place' AND geometry IS NULL)
    OR (entity_kind = 'place' AND place_kind = 'unlocated' AND geometry IS NULL)
    OR (entity_kind = 'place' AND place_kind = 'point'
      AND jsonb_typeof(geometry) = 'object'
      AND geometry ?& ARRAY['latitude','longitude']
      AND geometry - ARRAY['latitude','longitude','provenance','uncertaintyMeters'] = '{}'::jsonb
      AND jsonb_typeof(geometry->'latitude') = 'number'
      AND jsonb_typeof(geometry->'longitude') = 'number'
      AND (geometry->>'latitude')::numeric BETWEEN -90 AND 90
      AND (geometry->>'longitude')::numeric BETWEEN -180 AND 180
      AND (NOT geometry ? 'provenance'
        OR (jsonb_typeof(geometry->'provenance') = 'string'
          AND geometry->>'provenance' IN ('confirmed','contextual','manual','photo_gps')))
      AND (NOT geometry ? 'uncertaintyMeters'
        OR (jsonb_typeof(geometry->'uncertaintyMeters') = 'number'
          AND (geometry->>'uncertaintyMeters')::numeric BETWEEN 0 AND 1000000)))
    OR (entity_kind = 'place' AND place_kind = 'area'
      AND jsonb_typeof(geometry) = 'object'
      AND (
        (geometry ?& ARRAY['north','south','east','west']
          AND geometry - ARRAY['north','south','east','west','provenance','uncertaintyMeters'] = '{}'::jsonb
          AND jsonb_typeof(geometry->'north') = 'number'
          AND jsonb_typeof(geometry->'south') = 'number'
          AND jsonb_typeof(geometry->'east') = 'number'
          AND jsonb_typeof(geometry->'west') = 'number'
          AND (geometry->>'north')::numeric BETWEEN -90 AND 90
          AND (geometry->>'south')::numeric BETWEEN -90 AND 90
          AND (geometry->>'east')::numeric BETWEEN -180 AND 180
          AND (geometry->>'west')::numeric BETWEEN -180 AND 180
          AND (geometry->>'north')::numeric >= (geometry->>'south')::numeric)
        OR (geometry ? 'points'
          AND geometry - ARRAY['points','provenance','uncertaintyMeters'] = '{}'::jsonb
          AND jsonb_typeof(geometry->'points') = 'array'
          AND jsonb_array_length(geometry->'points') BETWEEN 3 AND 500)
      )
      AND (NOT geometry ? 'provenance'
        OR (jsonb_typeof(geometry->'provenance') = 'string'
          AND geometry->>'provenance' IN ('confirmed','contextual','manual','photo_gps')))
      AND (NOT geometry ? 'uncertaintyMeters'
        OR (jsonb_typeof(geometry->'uncertaintyMeters') = 'number'
          AND (geometry->>'uncertaintyMeters')::numeric BETWEEN 0 AND 1000000)))
    OR (entity_kind = 'place' AND place_kind = 'route'
      AND jsonb_typeof(geometry) = 'object'
      AND geometry ? 'points'
      AND geometry - ARRAY['points','provenance','uncertaintyMeters'] = '{}'::jsonb
      AND jsonb_typeof(geometry->'points') = 'array'
      AND jsonb_array_length(geometry->'points') BETWEEN 2 AND 500
      AND (NOT geometry ? 'provenance'
        OR (jsonb_typeof(geometry->'provenance') = 'string'
          AND geometry->>'provenance' IN ('confirmed','contextual','manual','photo_gps')))
      AND (NOT geometry ? 'uncertaintyMeters'
        OR (jsonb_typeof(geometry->'uncertaintyMeters') = 'number'
          AND (geometry->>'uncertaintyMeters')::numeric BETWEEN 0 AND 1000000)))
  );

-- Event admission needs an explicit holding lane. A candidate photo must not
-- silently become defining Main media merely because it was selected in a
-- large folder/date batch.
ALTER TABLE context_asset_link
  DROP CONSTRAINT context_asset_link_association_kind_check;

ALTER TABLE context_asset_link
  ADD CONSTRAINT context_asset_link_association_kind_check CHECK (
    association_kind IN (
      'captured_at', 'depicts', 'owned_at', 'direct', 'route_stop',
      'context', 'needs_check', 'manual'
    )
  );

CREATE OR REPLACE FUNCTION enforce_context_asset_link_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entity_kind text;
  v_entity_status text;
  v_asset_state text;
BEGIN
  SELECT entity_kind, status INTO v_entity_kind, v_entity_status
  FROM context_entity WHERE entity_id = NEW.entity_id;
  SELECT state INTO v_asset_state FROM asset WHERE asset_id = NEW.asset_id;
  IF v_entity_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Context asset link requires a current entity'
      USING ERRCODE = '23514';
  END IF;
  IF v_asset_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Context asset link requires an active asset'
      USING ERRCODE = '23514';
  END IF;
  IF (v_entity_kind = 'place' AND NEW.association_kind NOT IN
      ('captured_at','depicts','route_stop','manual'))
     OR (v_entity_kind = 'object' AND NEW.association_kind NOT IN
      ('depicts','owned_at','manual'))
     OR (v_entity_kind = 'event' AND NEW.association_kind NOT IN
      ('direct','route_stop','context','needs_check','manual')) THEN
    RAISE EXCEPTION 'Association kind is invalid for this context entity'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_link_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM context_asset_link previous
    WHERE previous.link_id = NEW.supersedes_link_id
      AND previous.entity_id = NEW.entity_id
      AND previous.asset_id = NEW.asset_id
  ) THEN
    RAISE EXCEPTION 'Context asset link supersession crossed scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
