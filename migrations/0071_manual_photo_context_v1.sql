BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_manual_photo_context_v1', 'system',
    'cimmich.manual-photo-context', 'v1', now(), now(),
    encode(digest('cimmich.manual-photo-context.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE manual_context_observation (
    observation_id text PRIMARY KEY CHECK (
        observation_id ~ '^contextobs_[0-9a-f]{32}$'
    ),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    asset_input_revision text NOT NULL CHECK (
        asset_input_revision ~ '^[0-9a-f]{64}$'
    ),
    box_x numeric NOT NULL CHECK (box_x BETWEEN 0 AND 1),
    box_y numeric NOT NULL CHECK (box_y BETWEEN 0 AND 1),
    box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    origin text NOT NULL CHECK (origin = 'manual_user'),
    state text NOT NULL CHECK (state IN ('valid','rejected','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    current_decision_id text NOT NULL REFERENCES decision(decision_id),
    supersedes_observation_id text REFERENCES manual_context_observation(observation_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001),
    CHECK (supersedes_observation_id IS NULL OR supersedes_observation_id <> observation_id)
);

CREATE TABLE manual_context_tag (
    tag_id text PRIMARY KEY CHECK (tag_id ~ '^contexttag_[0-9a-f]{32}$'),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    observation_id text NOT NULL UNIQUE
        REFERENCES manual_context_observation(observation_id) ON DELETE CASCADE,
    entity_id text NOT NULL REFERENCES context_entity(entity_id) ON DELETE CASCADE,
    entity_kind text NOT NULL CHECK (entity_kind = 'object'),
    provenance text NOT NULL CHECK (provenance = 'manual_user'),
    state text NOT NULL CHECK (state IN ('accepted','rejected','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    current_decision_id text NOT NULL REFERENCES decision(decision_id),
    supersedes_tag_id text REFERENCES manual_context_tag(tag_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (supersedes_tag_id IS NULL OR supersedes_tag_id <> tag_id)
);

CREATE UNIQUE INDEX manual_context_tag_one_current_object
    ON manual_context_tag(asset_id, entity_id)
    WHERE state = 'accepted';

CREATE INDEX manual_context_observation_asset_current
    ON manual_context_observation(asset_id, created_at DESC, observation_id)
    WHERE state = 'valid';
CREATE INDEX manual_context_tag_entity_current
    ON manual_context_tag(entity_id, created_at DESC, tag_id)
    WHERE state = 'accepted';

CREATE FUNCTION enforce_manual_context_tag_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_entity_kind text;
    v_entity_status text;
    v_asset_id text;
    v_asset_state text;
    v_input_revision text;
BEGIN
    SELECT entity_kind, status INTO v_entity_kind, v_entity_status
    FROM context_entity WHERE entity_id = NEW.entity_id;
    SELECT observation.asset_id, asset.state, observation.asset_input_revision
      INTO v_asset_id, v_asset_state, v_input_revision
    FROM manual_context_observation observation
    JOIN asset ON asset.asset_id = observation.asset_id
    WHERE observation.observation_id = NEW.observation_id;
    IF v_entity_kind IS DISTINCT FROM 'object'
       OR NEW.entity_kind IS DISTINCT FROM 'object'
       OR v_entity_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'MANUAL_CONTEXT_OBJECT_INVALID_DB'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.asset_id IS DISTINCT FROM v_asset_id
       OR v_asset_state IS DISTINCT FROM 'active' OR NOT EXISTS (
        SELECT 1 FROM immich_asset_projection projection
        WHERE projection.cimmich_asset_id = v_asset_id
          AND projection.state = 'active'
          AND projection.input_revision = v_input_revision
    ) THEN
        RAISE EXCEPTION 'MANUAL_CONTEXT_ASSET_REVISION_STALE_DB'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_tag_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM manual_context_tag previous
        JOIN manual_context_observation previous_observation
          ON previous_observation.observation_id = previous.observation_id
        WHERE previous.tag_id = NEW.supersedes_tag_id
          AND previous_observation.asset_id = v_asset_id
    ) THEN
        RAISE EXCEPTION 'MANUAL_CONTEXT_SUPERSESSION_SCOPE_INVALID_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER manual_context_tag_scope
BEFORE INSERT OR UPDATE OF asset_id, observation_id, entity_id, entity_kind,
  supersedes_tag_id
ON manual_context_tag FOR EACH ROW EXECUTE FUNCTION enforce_manual_context_tag_scope();

CREATE VIEW current_manual_context_tag AS
SELECT tag.tag_id, tag.entity_id, tag.entity_kind, tag.provenance,
  tag.current_decision_id AS decision_id, tag.created_at,
  observation.observation_id, observation.asset_id,
  observation.asset_input_revision, observation.box_x, observation.box_y,
  observation.box_w, observation.box_h
FROM manual_context_tag tag
JOIN manual_context_observation observation
  ON observation.observation_id = tag.observation_id
  AND observation.state = 'valid'
WHERE tag.state = 'accepted';

CREATE TABLE asset_owner_summary_revision (
    summary_revision_id text PRIMARY KEY CHECK (
        summary_revision_id ~ '^ownersummary_[0-9a-f]{32}$'
    ),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    asset_input_revision text NOT NULL CHECK (
        asset_input_revision ~ '^[0-9a-f]{64}$'
    ),
    revision bigint NOT NULL CHECK (revision > 0),
    summary_text text CHECK (
        summary_text IS NULL OR (
            summary_text = btrim(summary_text)
            AND length(summary_text) BETWEEN 1 AND 2000
            AND summary_text !~ '[[:cntrl:]]'
        )
    ),
    provenance text NOT NULL CHECK (provenance = 'manual_user'),
    state text NOT NULL CHECK (state IN ('current','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    current_decision_id text NOT NULL REFERENCES decision(decision_id),
    supersedes_summary_revision_id text
        REFERENCES asset_owner_summary_revision(summary_revision_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        supersedes_summary_revision_id IS NULL
        OR supersedes_summary_revision_id <> summary_revision_id
    )
);

CREATE UNIQUE INDEX asset_owner_summary_one_current
    ON asset_owner_summary_revision(asset_id) WHERE state = 'current';
CREATE UNIQUE INDEX asset_owner_summary_revision_number
    ON asset_owner_summary_revision(asset_id, revision);

CREATE FUNCTION enforce_asset_owner_summary_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM asset
        JOIN immich_asset_projection projection
          ON projection.cimmich_asset_id = asset.asset_id
          AND projection.state = 'active'
        WHERE asset.asset_id = NEW.asset_id AND asset.state = 'active'
          AND projection.input_revision = NEW.asset_input_revision
    ) THEN
        RAISE EXCEPTION 'ASSET_OWNER_SUMMARY_REVISION_STALE_DB'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_summary_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM asset_owner_summary_revision previous
        WHERE previous.summary_revision_id = NEW.supersedes_summary_revision_id
          AND previous.asset_id = NEW.asset_id
          AND previous.revision < NEW.revision
    ) THEN
        RAISE EXCEPTION 'ASSET_OWNER_SUMMARY_SUPERSESSION_INVALID_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER asset_owner_summary_scope
BEFORE INSERT OR UPDATE OF asset_id, asset_input_revision,
  supersedes_summary_revision_id, revision
ON asset_owner_summary_revision
FOR EACH ROW EXECUTE FUNCTION enforce_asset_owner_summary_scope();

CREATE VIEW current_asset_owner_summary AS
SELECT summary_revision_id, asset_id, asset_input_revision, revision,
  summary_text, provenance, current_decision_id AS decision_id, created_at
FROM asset_owner_summary_revision
WHERE state = 'current';

CREATE TABLE manual_photo_context_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    command_kind text NOT NULL CHECK (command_kind IN (
        'object_attach','object_replace','object_reject','summary_set','undo'
    )),
    actor_id text NOT NULL CHECK (
        actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES decision(decision_id),
    response jsonb NOT NULL,
    producer_receipt_id text NOT NULL
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE manual_photo_context_operation (
    operation_id text PRIMARY KEY CHECK (
        operation_id ~ '^contextoperation_[0-9a-f]{32}$'
    ),
    command_id text NOT NULL UNIQUE REFERENCES manual_photo_context_command(command_id)
        DEFERRABLE INITIALLY DEFERRED,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    operation_scope text NOT NULL CHECK (
        operation_scope IN ('object_region','owner_summary')
    ),
    action text NOT NULL CHECK (action IN ('attach','replace','reject','set')),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    state text NOT NULL CHECK (state IN ('active','reverted')),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    reverted_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'reverted') =
      (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE INDEX manual_photo_context_operation_asset_state
    ON manual_photo_context_operation(asset_id, state, created_at DESC);

UPDATE cimmich_visibility_projection_surface
SET producer_receipt_id = 'receipt_cimmich_manual_photo_context_v1',
    coverage_state = 'enforced', reason_code = NULL, updated_at = now()
WHERE surface_key = 'asset_evidence';

COMMIT;
