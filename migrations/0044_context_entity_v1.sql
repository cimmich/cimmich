BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_context_entity_v1', 'system',
    'cimmich-context-entity', 'v1', now(), now(),
    encode(digest('cimmich-context-entity-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE context_entity (
    entity_id text PRIMARY KEY CHECK (
        entity_id ~ '^(place|object|event)_[0-9a-f]{32}$'
    ),
    entity_kind text NOT NULL CHECK (entity_kind IN ('place','object','event')),
    place_kind text CHECK (
        place_kind IS NULL OR place_kind IN ('point','area','route','unlocated')
    ),
    object_kind text CHECK (
        object_kind IS NULL OR object_kind IN (
            'vehicle','property','device','collectible','equipment','other'
        )
    ),
    event_kind text CHECK (
        event_kind IS NULL OR event_kind IN ('trip','event','activity','life_period')
    ),
    display_name text NOT NULL CHECK (
        display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 160
    ),
    description text CHECK (
        description IS NULL OR (
            description = btrim(description) AND length(description) BETWEEN 1 AND 4000
        )
    ),
    date_start date,
    date_end date,
    date_precision text NOT NULL DEFAULT 'unknown' CHECK (
        date_precision IN ('exact','month','year','approximate','unknown')
    ),
    geometry jsonb,
    parent_entity_id text REFERENCES context_entity(entity_id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','archived')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT context_entity_typed_kind CHECK (
        (entity_kind = 'place' AND place_kind IS NOT NULL
          AND object_kind IS NULL AND event_kind IS NULL)
        OR (entity_kind = 'object' AND object_kind IS NOT NULL
          AND place_kind IS NULL AND event_kind IS NULL)
        OR (entity_kind = 'event' AND event_kind IS NOT NULL
          AND place_kind IS NULL AND object_kind IS NULL)
    ),
    CONSTRAINT context_entity_date_order CHECK (
        date_start IS NULL OR date_end IS NULL OR date_end >= date_start
    ),
    CONSTRAINT context_entity_place_geometry CHECK (
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
          AND geometry ?& ARRAY['north','south','east','west']
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
        OR (entity_kind = 'place' AND place_kind = 'route'
          AND jsonb_typeof(geometry) = 'object'
          AND jsonb_typeof(geometry->'points') = 'array'
          AND jsonb_array_length(geometry->'points') BETWEEN 2 AND 500)
    )
);

CREATE INDEX context_entity_kind_status_name
    ON context_entity(entity_kind, status, lower(display_name), entity_id);
CREATE INDEX context_entity_parent
    ON context_entity(parent_entity_id) WHERE parent_entity_id IS NOT NULL;
CREATE INDEX context_entity_dates
    ON context_entity(date_start, date_end, entity_id)
    WHERE date_start IS NOT NULL OR date_end IS NOT NULL;

CREATE FUNCTION enforce_context_entity_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_parent_kind text;
BEGIN
  IF NEW.parent_entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_entity_id = NEW.entity_id THEN
    RAISE EXCEPTION 'Context entity cannot parent itself' USING ERRCODE = '23514';
  END IF;
  SELECT entity_kind INTO v_parent_kind FROM context_entity
  WHERE entity_id = NEW.parent_entity_id AND status <> 'archived';
  IF v_parent_kind IS DISTINCT FROM NEW.entity_kind
     OR NEW.entity_kind NOT IN ('place','event') THEN
    RAISE EXCEPTION 'Context parent must be an active same-kind Place or Event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_entity_parent_guard
BEFORE INSERT OR UPDATE OF parent_entity_id, entity_kind ON context_entity
FOR EACH ROW EXECUTE FUNCTION enforce_context_entity_parent();

CREATE TABLE context_entity_alias (
    alias_id text PRIMARY KEY CHECK (alias_id ~ '^contextalias_[0-9a-f]{32}$'),
    entity_id text NOT NULL REFERENCES context_entity(entity_id) ON DELETE CASCADE,
    label text NOT NULL CHECK (
        label = btrim(label) AND length(label) BETWEEN 1 AND 160
    ),
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','removed')),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX context_entity_alias_active_label
    ON context_entity_alias(entity_id, lower(label)) WHERE state = 'active';

CREATE TABLE context_asset_link (
    link_id text PRIMARY KEY CHECK (link_id ~ '^contextasset_[0-9a-f]{32}$'),
    entity_id text NOT NULL REFERENCES context_entity(entity_id) ON DELETE CASCADE,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    association_kind text NOT NULL CHECK (association_kind IN (
        'captured_at','depicts','owned_at','direct','route_stop','context','manual'
    )),
    state text NOT NULL CHECK (state IN ('accepted','rejected','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    supersedes_link_id text REFERENCES context_asset_link(link_id),
    privacy_class text NOT NULL DEFAULT 'private',
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (supersedes_link_id IS NULL OR supersedes_link_id <> link_id)
);

CREATE UNIQUE INDEX context_asset_link_one_current
    ON context_asset_link(entity_id, asset_id)
    WHERE state IN ('accepted','rejected');
CREATE INDEX context_asset_link_entity_current
    ON context_asset_link(entity_id, created_at DESC, link_id DESC)
    WHERE state = 'accepted';
CREATE INDEX context_asset_link_asset_current
    ON context_asset_link(asset_id, entity_id) WHERE state = 'accepted';

CREATE FUNCTION enforce_context_asset_link_scope()
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
      ('direct','route_stop','context','manual')) THEN
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

CREATE TRIGGER context_asset_link_scope
BEFORE INSERT OR UPDATE OF entity_id, asset_id, association_kind, supersedes_link_id
ON context_asset_link FOR EACH ROW EXECUTE FUNCTION enforce_context_asset_link_scope();

CREATE VIEW current_context_asset AS
SELECT link_id, entity_id, asset_id, association_kind, decision_id, created_at
FROM context_asset_link WHERE state = 'accepted';

CREATE TABLE context_relation_link (
    link_id text PRIMARY KEY CHECK (link_id ~ '^contextrel_[0-9a-f]{32}$'),
    entity_id text NOT NULL REFERENCES context_entity(entity_id) ON DELETE CASCADE,
    target_kind text NOT NULL CHECK (target_kind IN ('person','pet','place','object','event')),
    target_id text NOT NULL,
    relation_kind text NOT NULL CHECK (relation_kind IN (
        'participant','companion','location','object','parent','related'
    )),
    state text NOT NULL CHECK (state IN ('accepted','rejected','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    supersedes_link_id text REFERENCES context_relation_link(link_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (supersedes_link_id IS NULL OR supersedes_link_id <> link_id)
);

CREATE UNIQUE INDEX context_relation_link_one_current
    ON context_relation_link(entity_id, target_kind, target_id, relation_kind)
    WHERE state IN ('accepted','rejected');
CREATE INDEX context_relation_link_entity_current
    ON context_relation_link(entity_id, created_at, link_id)
    WHERE state = 'accepted';

CREATE FUNCTION enforce_context_relation_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_source_kind text;
  v_target_kind text;
BEGIN
  SELECT entity_kind INTO v_source_kind FROM context_entity
  WHERE entity_id = NEW.entity_id AND status IN ('active','hidden');
  IF v_source_kind IS NULL THEN
    RAISE EXCEPTION 'Context relation requires an active source entity'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.target_kind IN ('person','pet') THEN
    SELECT subject_kind INTO v_target_kind FROM person
    WHERE person_id = NEW.target_id AND status IN ('active','hidden');
  ELSE
    SELECT entity_kind INTO v_target_kind FROM context_entity
    WHERE entity_id = NEW.target_id AND status <> 'archived';
  END IF;
  IF v_target_kind IS DISTINCT FROM NEW.target_kind THEN
    RAISE EXCEPTION 'Context relation target kind does not match target'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.entity_id = NEW.target_id THEN
    RAISE EXCEPTION 'Context relation cannot target itself' USING ERRCODE = '23514';
  END IF;
  IF (NEW.relation_kind = 'participant' AND NEW.target_kind <> 'person')
     OR (NEW.relation_kind = 'companion' AND NEW.target_kind <> 'pet')
     OR (NEW.relation_kind = 'location' AND NEW.target_kind <> 'place')
     OR (NEW.relation_kind = 'object' AND NEW.target_kind <> 'object')
     OR (NEW.relation_kind = 'parent' AND NEW.target_kind <> v_source_kind) THEN
    RAISE EXCEPTION 'Context relation role does not match its target kind'
      USING ERRCODE = '23514';
  END IF;
  IF v_source_kind <> 'event' AND NEW.relation_kind IN
      ('participant','companion','location','object') THEN
    RAISE EXCEPTION 'Participant/location/object roles belong to Events'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_link_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM context_relation_link previous
    WHERE previous.link_id = NEW.supersedes_link_id
      AND previous.entity_id = NEW.entity_id
      AND previous.target_kind = NEW.target_kind
      AND previous.target_id = NEW.target_id
      AND previous.relation_kind = NEW.relation_kind
  ) THEN
    RAISE EXCEPTION 'Context relation supersession crossed scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_relation_link_scope
BEFORE INSERT OR UPDATE OF entity_id, target_kind, target_id, relation_kind,
  supersedes_link_id ON context_relation_link
FOR EACH ROW EXECUTE FUNCTION enforce_context_relation_scope();

CREATE VIEW current_context_relation AS
SELECT link_id, entity_id, target_kind, target_id, relation_kind, decision_id,
       created_at
FROM context_relation_link WHERE state = 'accepted';

CREATE TABLE context_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    command_kind text NOT NULL CHECK (command_kind IN (
        'create','update','asset_attach','asset_detach',
        'relation_attach','relation_detach','undo'
    )),
    actor_id text NOT NULL CHECK (
        actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES decision(decision_id),
    response jsonb NOT NULL,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE context_operation (
    operation_id text PRIMARY KEY CHECK (operation_id ~ '^contextop_[0-9a-f]{32}$'),
    command_id text NOT NULL UNIQUE REFERENCES context_command(command_id),
    entity_id text NOT NULL REFERENCES context_entity(entity_id) ON DELETE CASCADE,
    operation_scope text NOT NULL CHECK (operation_scope IN ('asset','relation')),
    action text NOT NULL CHECK (action IN ('attach','detach')),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    state text NOT NULL CHECK (state IN ('active','reverted')),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'array'),
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    reverted_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'reverted') =
      (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE INDEX context_operation_entity_state
    ON context_operation(entity_id, state, created_at DESC);

COMMIT;
