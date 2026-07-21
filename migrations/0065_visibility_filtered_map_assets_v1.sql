BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_visibility_filtered_map_assets_v1', 'system',
    'cimmich.visibility-filtered-map-assets', 'v1', now(), now(),
    encode(digest('cimmich.visibility-filtered-map-assets.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

INSERT INTO cimmich_visibility_projection_surface (
    surface_key, coverage_state, asset_derived, route_family, reason_code,
    producer_receipt_id
) VALUES (
    'map_assets', 'enforced', true, '/v1/map/visible-assets', NULL,
    'receipt_cimmich_visibility_filtered_map_assets_v1'
) ON CONFLICT (surface_key) DO UPDATE SET
    coverage_state = excluded.coverage_state,
    asset_derived = excluded.asset_derived,
    route_family = excluded.route_family,
    reason_code = NULL,
    producer_receipt_id = excluded.producer_receipt_id,
    updated_at = now();

COMMIT;
