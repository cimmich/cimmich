BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_xmp_name_resolution_v1', 'user',
    'cimmich-xmp-name-resolution', 'v1', now(), now(),
    encode(digest('cimmich.xmp-name-resolution.v1', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE xmp_sidecar_name_resolution_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (
        length(btrim(actor_id)) BETWEEN 1 AND 120
    ),
    group_id text NOT NULL CHECK (
        group_id ~ '^xmp_name_[0-9a-f]{64}$'
    ),
    source_id text NOT NULL CHECK (
        length(btrim(source_id)) BETWEEN 1 AND 120
    ),
    normalized_name text NOT NULL CHECK (
        normalized_name = btrim(normalized_name)
        AND length(normalized_name) BETWEEN 1 AND 500
        AND normalized_name !~ '[[:cntrl:]]'
    ),
    selector_kind text NOT NULL CHECK (
        selector_kind IN ('existing_person','new_person')
    ),
    requested_person_id text,
    requested_person_name text,
    request_digest text NOT NULL CHECK (
        request_digest ~ '^[0-9a-f]{64}$'
    ),
    target_person_id text REFERENCES person(person_id) ON DELETE CASCADE,
    decision_id text REFERENCES decision(decision_id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'started' CHECK (
        state IN ('started','completed')
    ),
    resolved_face_count integer CHECK (
        resolved_face_count IS NULL OR resolved_face_count >= 0
    ),
    response_body jsonb CHECK (
        response_body IS NULL OR jsonb_typeof(response_body) = 'object'
    ),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    producer_receipt_id text NOT NULL DEFAULT
        'receipt_cimmich_xmp_name_resolution_v1'
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    UNIQUE (source_id, normalized_name),
    CHECK (
        (selector_kind = 'existing_person') =
        (requested_person_id IS NOT NULL)
    ),
    CHECK (
        (selector_kind = 'new_person') =
        (requested_person_name IS NOT NULL)
    ),
    CHECK (
        (state = 'completed') =
        (
            completed_at IS NOT NULL
            AND target_person_id IS NOT NULL
            AND decision_id IS NOT NULL
            AND resolved_face_count IS NOT NULL
            AND response_body IS NOT NULL
        )
    )
);

ALTER TABLE xmp_sidecar_face_evidence
    ADD COLUMN import_resolution_state text;

UPDATE xmp_sidecar_face_evidence
SET import_resolution_state = resolution_state;

ALTER TABLE xmp_sidecar_face_evidence
    ALTER COLUMN import_resolution_state SET NOT NULL,
    ADD COLUMN owner_resolution_command_id text
        REFERENCES xmp_sidecar_name_resolution_command(command_id)
        ON DELETE CASCADE,
    ADD COLUMN owner_resolution_decision_id text
        REFERENCES decision(decision_id) ON DELETE CASCADE,
    DROP CONSTRAINT xmp_sidecar_face_evidence_resolution_state_check,
    DROP CONSTRAINT xmp_sidecar_face_evidence_check1,
    ADD CONSTRAINT xmp_sidecar_face_evidence_import_resolution_state_check
        CHECK (
            import_resolution_state IN (
                'created_mapped','created_unresolved','reused_mapped',
                'ambiguous_name','geometry_conflict'
            )
        ),
    ADD CONSTRAINT xmp_sidecar_face_evidence_resolution_state_v2_check
        CHECK (
            resolution_state IN (
                'created_mapped','created_unresolved','reused_mapped',
                'ambiguous_name','geometry_conflict','owner_resolved'
            )
        ),
    ADD CONSTRAINT xmp_sidecar_face_evidence_resolution_shape_v2_check
        CHECK (
            (
                resolution_state IN ('created_mapped','reused_mapped')
                AND person_id IS NOT NULL
                AND identity_claim_id IS NOT NULL
                AND owner_resolution_command_id IS NULL
                AND owner_resolution_decision_id IS NULL
            )
            OR
            (
                resolution_state IN (
                    'created_unresolved','ambiguous_name','geometry_conflict'
                )
                AND identity_claim_id IS NULL
                AND owner_resolution_command_id IS NULL
                AND owner_resolution_decision_id IS NULL
            )
            OR
            (
                resolution_state = 'owner_resolved'
                AND person_id IS NOT NULL
                AND identity_claim_id IS NOT NULL
                AND owner_resolution_command_id IS NOT NULL
                AND owner_resolution_decision_id IS NOT NULL
            )
        );

CREATE FUNCTION enforce_xmp_import_resolution_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.import_resolution_state IS NULL THEN
            NEW.import_resolution_state := NEW.resolution_state;
        END IF;
    ELSIF NEW.import_resolution_state IS DISTINCT FROM
            OLD.import_resolution_state THEN
        RAISE EXCEPTION 'XMP import resolution state is immutable';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER xmp_import_resolution_state_guard
    BEFORE INSERT OR UPDATE ON xmp_sidecar_face_evidence
    FOR EACH ROW EXECUTE FUNCTION enforce_xmp_import_resolution_state();

CREATE INDEX xmp_sidecar_face_evidence_unresolved_name
    ON xmp_sidecar_face_evidence (
        source_id, normalized_name, asset_id, evidence_id
    )
    WHERE resolution_state IN (
        'created_unresolved','ambiguous_name','geometry_conflict'
    );

COMMIT;
