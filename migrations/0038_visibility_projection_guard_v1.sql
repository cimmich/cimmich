BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_visibility_projection_guard_v1', 'system',
    'cimmich.visibility-projection', 'v1', now(), now(),
    encode(digest('cimmich.visibility-projection.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE cimmich_visibility_projection_surface (
    surface_key text PRIMARY KEY
        CHECK (surface_key ~ '^[a-z][a-z0-9_]{1,63}$'),
    coverage_state text NOT NULL
        CHECK (coverage_state IN ('enforced','blocked')),
    asset_derived boolean NOT NULL DEFAULT true,
    route_family text NOT NULL
        CHECK (length(btrim(route_family)) BETWEEN 1 AND 160),
    reason_code text,
    producer_receipt_id text NOT NULL
        REFERENCES producer_receipt(producer_receipt_id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private'
        CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    CHECK (
        (coverage_state = 'enforced' AND reason_code IS NULL)
        OR
        (coverage_state = 'blocked'
            AND reason_code IS NOT NULL
            AND reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
    )
);

INSERT INTO cimmich_visibility_projection_surface (
    surface_key, coverage_state, asset_derived, route_family, reason_code,
    producer_receipt_id
) VALUES
    ('asset_detail', 'enforced', true, '/v1/assets/:assetId/subjects', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('asset_evidence', 'enforced', true, '/v1/assets/evidence', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('basic_search', 'enforced', true, '/v1/search/media', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('events', 'blocked', true, '/v1/events', 'LEGACY_STATIC_PROJECTION',
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('machine_suggestions', 'enforced', true, '/v1/review/machine-suggestions', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('people', 'enforced', true, '/v1/people', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('person_assets', 'enforced', true, '/v1/people/:personId/assets', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('person_review', 'enforced', true, '/v1/people/:personId/candidates|identity', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('pet_media', 'enforced', true, '/v1/pets/:petId/media', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('pets', 'enforced', true, '/v1/pets', NULL,
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('places', 'blocked', true, '/v1/places', 'LEGACY_STATIC_PROJECTION',
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('smart_search', 'blocked', true, '/v1/search/smart', 'LEGACY_STATIC_PROJECTION',
        'receipt_cimmich_visibility_projection_guard_v1'),
    ('summary', 'enforced', true, '/v1/summary', NULL,
        'receipt_cimmich_visibility_projection_guard_v1');

COMMIT;
