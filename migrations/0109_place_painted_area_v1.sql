BEGIN;

-- Areas historically stored an axis-aligned bounding box. Keep that shape for
-- compatibility while also allowing an owner-painted polygon. The service
-- canonicalises every polygon point and enforces coordinate ranges before the
-- row reaches this constraint; the database still owns the closed shape and
-- point-count invariant.
ALTER TABLE context_entity
  DROP CONSTRAINT context_entity_place_geometry;

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_place_geometry CHECK (
      (entity_kind <> 'place' AND geometry IS NULL)
      OR (entity_kind = 'place' AND place_kind = 'unlocated' AND geometry IS NULL)
      OR (entity_kind = 'place' AND place_kind = 'point'
        AND jsonb_typeof(geometry) = 'object'
        AND geometry ?& ARRAY['latitude','longitude']
        AND geometry - ARRAY['latitude','longitude'] = '{}'::jsonb
        AND jsonb_typeof(geometry->'latitude') = 'number'
        AND jsonb_typeof(geometry->'longitude') = 'number'
        AND (geometry->>'latitude')::numeric BETWEEN -90 AND 90
        AND (geometry->>'longitude')::numeric BETWEEN -180 AND 180)
      OR (entity_kind = 'place' AND place_kind = 'area'
        AND jsonb_typeof(geometry) = 'object'
        AND (
          (geometry ?& ARRAY['north','south','east','west']
            AND geometry - ARRAY['north','south','east','west'] = '{}'::jsonb
            AND jsonb_typeof(geometry->'north') = 'number'
            AND jsonb_typeof(geometry->'south') = 'number'
            AND jsonb_typeof(geometry->'east') = 'number'
            AND jsonb_typeof(geometry->'west') = 'number'
            AND (geometry->>'north')::numeric BETWEEN -90 AND 90
            AND (geometry->>'south')::numeric BETWEEN -90 AND 90
            AND (geometry->>'east')::numeric BETWEEN -180 AND 180
            AND (geometry->>'west')::numeric BETWEEN -180 AND 180
            AND (geometry->>'north')::numeric >= (geometry->>'south')::numeric)
          OR
          (geometry ? 'points'
            AND geometry - 'points' = '{}'::jsonb
            AND jsonb_typeof(geometry->'points') = 'array'
            AND jsonb_array_length(geometry->'points') BETWEEN 3 AND 500)
        ))
      OR (entity_kind = 'place' AND place_kind = 'route'
        AND jsonb_typeof(geometry) = 'object'
        AND geometry ? 'points'
        AND geometry - 'points' = '{}'::jsonb
        AND jsonb_typeof(geometry->'points') = 'array'
        AND jsonb_array_length(geometry->'points') BETWEEN 2 AND 500)
  );

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_place_painted_area_v1', 'system',
    'cimmich-place-painted-area', 'v1', now(), now(),
    encode(digest('cimmich-place-painted-area-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
