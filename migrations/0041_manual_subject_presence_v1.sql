BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_manual_subject_presence_v1', 'system',
    'cimmich-manual-subject-presence', 'v1', now(), now(),
    encode(digest('cimmich.manual-subject-presence.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE presence_tag
    ADD COLUMN manual_geometry jsonb;

ALTER TABLE presence_tag
    ADD CONSTRAINT presence_tag_manual_geometry_shape CHECK (
        manual_geometry IS NULL OR (
            origin = 'user'
            AND reason_code IN ('manual_person', 'manual_pet')
            AND jsonb_typeof(manual_geometry) = 'object'
            AND manual_geometry->>'kind' IN ('point', 'region')
            AND jsonb_typeof(manual_geometry->'x') = 'number'
            AND jsonb_typeof(manual_geometry->'y') = 'number'
            AND (manual_geometry->>'x')::numeric BETWEEN 0 AND 1
            AND (manual_geometry->>'y')::numeric BETWEEN 0 AND 1
            AND (
                (
                    manual_geometry->>'kind' = 'point'
                    AND manual_geometry ?& ARRAY['kind','x','y']
                    AND manual_geometry - ARRAY['kind','x','y'] = '{}'::jsonb
                    AND NOT (manual_geometry ?| ARRAY['w','h'])
                ) OR (
                    manual_geometry->>'kind' = 'region'
                    AND manual_geometry ?& ARRAY['kind','x','y','w','h']
                    AND manual_geometry - ARRAY['kind','x','y','w','h'] = '{}'::jsonb
                    AND jsonb_typeof(manual_geometry->'w') = 'number'
                    AND jsonb_typeof(manual_geometry->'h') = 'number'
                    AND (manual_geometry->>'w')::numeric > 0
                    AND (manual_geometry->>'h')::numeric > 0
                    AND (manual_geometry->>'x')::numeric + (manual_geometry->>'w')::numeric <= 1
                    AND (manual_geometry->>'y')::numeric + (manual_geometry->>'h')::numeric <= 1
                )
            )
        )
    );

CREATE OR REPLACE FUNCTION enforce_manual_presence_subject_kind()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    actual_kind text;
BEGIN
    IF NEW.reason_code NOT IN ('manual_person', 'manual_pet') THEN
        IF NEW.manual_geometry IS NOT NULL THEN
            RAISE EXCEPTION 'MANUAL_PRESENCE_REASON_INVALID_DB'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    SELECT subject_kind INTO actual_kind
    FROM person
    WHERE person_id = NEW.person_id AND status IN ('active', 'hidden');

    IF actual_kind IS NULL THEN
        RAISE EXCEPTION 'MANUAL_PRESENCE_SUBJECT_NOT_FOUND_DB'
            USING ERRCODE = '23503';
    END IF;
    IF (NEW.reason_code = 'manual_person' AND actual_kind <> 'person')
       OR (NEW.reason_code = 'manual_pet' AND actual_kind <> 'pet') THEN
        RAISE EXCEPTION 'MANUAL_PRESENCE_SUBJECT_KIND_MISMATCH_DB'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.origin <> 'user' THEN
        RAISE EXCEPTION 'MANUAL_PRESENCE_ORIGIN_INVALID_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER presence_tag_manual_subject_kind_guard
BEFORE INSERT OR UPDATE OF person_id, origin, reason_code, manual_geometry
ON presence_tag
FOR EACH ROW EXECUTE FUNCTION enforce_manual_presence_subject_kind();

CREATE OR REPLACE VIEW current_presence_tag AS
SELECT pt.*
FROM presence_tag pt
WHERE pt.state <> 'superseded'
  AND NOT EXISTS (
      SELECT 1 FROM presence_tag newer
      WHERE newer.supersedes_presence_tag_id = pt.presence_tag_id
  );

CREATE TABLE manual_subject_presence_command (
    command_id text PRIMARY KEY
        CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    command_kind text NOT NULL CHECK (command_kind IN ('attach','detach','undo')),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES decision(decision_id),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE manual_subject_presence_operation (
    operation_id text PRIMARY KEY,
    command_id text NOT NULL UNIQUE
        REFERENCES manual_subject_presence_command(command_id),
    subject_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    subject_kind text NOT NULL CHECK (subject_kind IN ('person','pet')),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('attach','detach')),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    created_presence_tag_id text NOT NULL UNIQUE
        REFERENCES presence_tag(presence_tag_id),
    previous_presence_tag_id text REFERENCES presence_tag(presence_tag_id),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    state text NOT NULL CHECK (state IN ('active','reverted')),
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    reverted_at timestamptz,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'reverted') =
      (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE INDEX manual_subject_presence_operation_subject
    ON manual_subject_presence_operation(
      subject_kind, subject_id, state, created_at DESC
    );
CREATE INDEX manual_subject_presence_operation_asset
    ON manual_subject_presence_operation(asset_id, state, created_at DESC);

COMMIT;
