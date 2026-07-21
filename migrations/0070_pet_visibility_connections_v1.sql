BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_pet_visibility_connections_v1', 'system',
    'cimmich.pet-visibility-connections', 'v1', now(), now(),
    encode(digest('cimmich.pet-visibility-connections.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

ALTER TABLE cimmich_visibility_object
    DROP CONSTRAINT cimmich_visibility_object_object_scope_check;
ALTER TABLE cimmich_visibility_object
    ADD CONSTRAINT cimmich_visibility_object_object_scope_check
    CHECK (object_scope IN (
        'asset','album','collection','context_entity','document','person','pet'
    ));

CREATE OR REPLACE FUNCTION enforce_cimmich_visibility_object_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.object_scope = 'asset' THEN
        IF NOT EXISTS (
            SELECT 1 FROM asset WHERE asset_id = NEW.object_id AND state = 'active'
        ) THEN
            RAISE EXCEPTION 'VISIBILITY_OBJECT_NOT_FOUND_DB'
                USING ERRCODE = '23503';
        END IF;
    ELSIF NEW.object_scope = 'context_entity' THEN
        IF NOT EXISTS (
            SELECT 1 FROM context_entity
            WHERE entity_id = NEW.object_id AND status <> 'deleted'
        ) THEN
            RAISE EXCEPTION 'VISIBILITY_OBJECT_NOT_FOUND_DB'
                USING ERRCODE = '23503';
        END IF;
    ELSIF NEW.object_scope = 'document' THEN
        IF NOT EXISTS (
            SELECT 1 FROM cimmich_document
            WHERE document_id = NEW.object_id AND status IN ('active','archived')
        ) THEN
            RAISE EXCEPTION 'VISIBILITY_OBJECT_NOT_FOUND_DB'
                USING ERRCODE = '23503';
        END IF;
    ELSIF NEW.object_scope = 'person' THEN
        IF NOT EXISTS (
            SELECT 1 FROM person
            WHERE person_id = NEW.object_id
              AND subject_kind = 'person'
              AND status IN ('active','hidden')
        ) THEN
            RAISE EXCEPTION 'VISIBILITY_OBJECT_NOT_FOUND_DB'
                USING ERRCODE = '23503';
        END IF;
    ELSIF NEW.object_scope = 'pet' THEN
        IF NOT EXISTS (
            SELECT 1 FROM person
            WHERE person_id = NEW.object_id
              AND subject_kind = 'pet'
              AND status IN ('active','hidden')
        ) THEN
            RAISE EXCEPTION 'VISIBILITY_OBJECT_NOT_FOUND_DB'
                USING ERRCODE = '23503';
        END IF;
    ELSE
        RAISE EXCEPTION 'VISIBILITY_SCOPE_UNAVAILABLE_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cimmich_visibility_pet_rank(
    p_pet_id text
) RETURNS integer LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE coalesce((
        SELECT visibility_tier
        FROM cimmich_visibility_object
        WHERE object_scope = 'pet' AND object_id = p_pet_id
    ), 'standard')
        WHEN 'standard' THEN 0
        WHEN 'personal' THEN 1
        WHEN 'private' THEN 2
    END;
$$;

CREATE OR REPLACE FUNCTION cimmich_visibility_subject_rank(
    p_subject_kind text,
    p_subject_id text
) RETURNS integer LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE p_subject_kind
        WHEN 'person' THEN cimmich_visibility_person_rank(p_subject_id)
        WHEN 'pet' THEN cimmich_visibility_pet_rank(p_subject_id)
        ELSE NULL
    END;
$$;

UPDATE cimmich_visibility_projection_surface
SET route_family = '/v1/pets|/v1/pets/:id|pet-bearing projections',
    coverage_state = 'enforced', reason_code = NULL,
    producer_receipt_id = 'receipt_cimmich_pet_visibility_connections_v1',
    updated_at = now()
WHERE surface_key IN ('pets','pet_media');

COMMIT;
