BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_xmp_sidecar_face_import_v1', 'trusted_import',
    'cimmich-xmp-sidecar-face-import', 'v1', now(), now(),
    encode(digest('cimmich.xmp-sidecar-face-import.v1', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE face_observation
    DROP CONSTRAINT face_observation_origin_check,
    DROP CONSTRAINT face_observation_confidence_origin_check;

ALTER TABLE face_observation
    ADD CONSTRAINT face_observation_origin_check CHECK (
        observation_origin IN (
            'detector_or_import', 'manual_user', 'immich_import',
            'xmp_sidecar_import'
        )
    ),
    ADD CONSTRAINT face_observation_confidence_origin_check CHECK (
        (
            observation_origin IN (
                'manual_user', 'immich_import', 'xmp_sidecar_import'
            )
            AND detection_confidence IS NULL
        )
        OR
        (
            observation_origin = 'detector_or_import'
            AND detection_confidence IS NOT NULL
        )
    );

CREATE TABLE xmp_sidecar_import_run (
    run_id text PRIMARY KEY CHECK (
        run_id ~ '^xmp_sidecar_run_[0-9a-f]{32}$'
    ),
    command_id text NOT NULL UNIQUE CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (
        length(btrim(actor_id)) BETWEEN 1 AND 120
    ),
    source_id text NOT NULL CHECK (
        length(btrim(source_id)) BETWEEN 1 AND 120
    ),
    config_digest text NOT NULL CHECK (
        config_digest ~ '^[0-9a-f]{64}$'
    ),
    request_digest text NOT NULL CHECK (
        request_digest ~ '^[0-9a-f]{64}$'
    ),
    state text NOT NULL DEFAULT 'processing' CHECK (
        state IN ('processing','completed','failed')
    ),
    result jsonb CHECK (
        result IS NULL OR jsonb_typeof(result) = 'object'
    ),
    last_error_code text CHECK (
        last_error_code IS NULL
        OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
    ),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    producer_receipt_id text NOT NULL DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v1'
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    CHECK ((state = 'processing') = (completed_at IS NULL))
);

CREATE TABLE xmp_sidecar_face_evidence (
    evidence_id text PRIMARY KEY CHECK (
        evidence_id ~ '^xmp_face_evidence_[0-9a-f]{40}$'
    ),
    source_id text NOT NULL CHECK (
        length(btrim(source_id)) BETWEEN 1 AND 120
    ),
    content_id text NOT NULL REFERENCES media_content(content_id),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    person_id text REFERENCES person(person_id) ON DELETE CASCADE,
    identity_claim_id text REFERENCES identity_claim(identity_claim_id)
        ON DELETE CASCADE,
    region_key text NOT NULL CHECK (region_key ~ '^[0-9a-f]{64}$'),
    raw_name text NOT NULL CHECK (
        raw_name = btrim(raw_name)
        AND length(raw_name) BETWEEN 1 AND 500
        AND raw_name !~ '[[:cntrl:]]'
    ),
    normalized_name text NOT NULL CHECK (
        normalized_name = btrim(normalized_name)
        AND length(normalized_name) BETWEEN 1 AND 500
        AND normalized_name !~ '[[:cntrl:]]'
    ),
    box_x numeric NOT NULL CHECK (box_x BETWEEN 0 AND 1),
    box_y numeric NOT NULL CHECK (box_y BETWEEN 0 AND 1),
    box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    resolution_state text NOT NULL CHECK (
        resolution_state IN (
            'created_mapped','created_unresolved','reused_mapped',
            'ambiguous_name','geometry_conflict'
        )
    ),
    producer_receipt_id text NOT NULL DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v1'
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, content_id, region_key),
    CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001),
    CHECK (
        (
            resolution_state IN ('created_mapped','reused_mapped')
            AND person_id IS NOT NULL AND identity_claim_id IS NOT NULL
        )
        OR
        (
            resolution_state IN (
                'created_unresolved','ambiguous_name','geometry_conflict'
            )
            AND identity_claim_id IS NULL
        )
    )
);

CREATE INDEX xmp_sidecar_face_evidence_asset
    ON xmp_sidecar_face_evidence(asset_id, evidence_id);
CREATE INDEX xmp_sidecar_face_evidence_person
    ON xmp_sidecar_face_evidence(person_id, evidence_id)
    WHERE person_id IS NOT NULL;

CREATE TABLE xmp_sidecar_face_source (
    source_id text NOT NULL CHECK (
        length(btrim(source_id)) BETWEEN 1 AND 120
    ),
    source_locator_digest text NOT NULL CHECK (
        source_locator_digest ~ '^[0-9a-f]{64}$'
    ),
    evidence_id text NOT NULL
        REFERENCES xmp_sidecar_face_evidence(evidence_id) ON DELETE CASCADE,
    sidecar_digest text NOT NULL CHECK (
        sidecar_digest ~ '^[0-9a-f]{64}$'
    ),
    producer_receipt_id text NOT NULL DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v1'
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, source_locator_digest, evidence_id)
);

CREATE TABLE xmp_sidecar_import_item (
    run_id text NOT NULL REFERENCES xmp_sidecar_import_run(run_id)
        ON DELETE CASCADE,
    source_locator_digest text NOT NULL CHECK (
        source_locator_digest ~ '^[0-9a-f]{64}$'
    ),
    sidecar_digest text NOT NULL CHECK (
        sidecar_digest ~ '^[0-9a-f]{64}$'
    ),
    content_digest text NOT NULL CHECK (
        content_digest ~ '^[0-9a-f]{64}$'
    ),
    state text NOT NULL CHECK (state IN ('completed','failed')),
    face_count integer NOT NULL CHECK (face_count BETWEEN 0 AND 1000),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    last_error_code text CHECK (
        last_error_code IS NULL
        OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
    ),
    producer_receipt_id text NOT NULL DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v1'
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, source_locator_digest)
);

COMMIT;
