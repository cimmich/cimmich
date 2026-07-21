BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_context_search_projection_v1', 'system',
    'cimmich-context-search-projection', 'v1', now(), now(),
    encode(digest('cimmich-context-search-projection-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

UPDATE cimmich_visibility_projection_surface
SET coverage_state = 'enforced', reason_code = NULL,
    route_family = '/v1/places|/v1/objects', updated_at = now(),
    producer_receipt_id = 'receipt_cimmich_context_search_projection_v1'
WHERE surface_key = 'places';

UPDATE cimmich_visibility_projection_surface
SET coverage_state = 'enforced', reason_code = NULL,
    updated_at = now(),
    producer_receipt_id = 'receipt_cimmich_context_search_projection_v1'
WHERE surface_key IN ('events','smart_search');

DO $$
BEGIN
  IF (
    SELECT count(*) FROM cimmich_visibility_projection_surface
    WHERE surface_key IN ('places','events','smart_search')
      AND coverage_state = 'enforced' AND reason_code IS NULL
  ) <> 3 THEN
    RAISE EXCEPTION 'Native context/search projections were not fully enforced';
  END IF;
END;
$$;

COMMIT;
