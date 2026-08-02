BEGIN;

-- A Location plan is deliberately not stored in context_entity.geometry.
-- Place geometry is latitude/longitude; a plan is a private, relative canvas
-- whose coordinates remain stable when its background or viewport changes.
CREATE TABLE place_plan (
    plan_id text PRIMARY KEY CHECK (plan_id ~ '^placeplan_[0-9a-f]{32}$'),
    location_entity_id text NOT NULL REFERENCES context_entity(entity_id) ON DELETE CASCADE,
    display_name text NOT NULL CHECK (
      display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 120
    ),
    plan_kind text NOT NULL CHECK (plan_kind IN ('property','floor','outdoor','other')),
    background_kind text NOT NULL DEFAULT 'blank' CHECK (background_kind IN ('blank','asset')),
    background_asset_id text REFERENCES asset(asset_id) ON DELETE RESTRICT,
    is_default boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((background_kind = 'asset') = (background_asset_id IS NOT NULL)),
    UNIQUE (location_entity_id, display_name)
);

CREATE UNIQUE INDEX place_plan_one_default_per_location
  ON place_plan(location_entity_id) WHERE is_default;
CREATE INDEX place_plan_location_order
  ON place_plan(location_entity_id, is_default DESC, created_at, plan_id);

CREATE TABLE place_plan_item (
    plan_item_id text PRIMARY KEY CHECK (plan_item_id ~ '^planitem_[0-9a-f]{32}$'),
    plan_id text NOT NULL REFERENCES place_plan(plan_id) ON DELETE CASCADE,
    child_entity_id text NOT NULL REFERENCES context_entity(entity_id) ON DELETE RESTRICT,
    shape_kind text NOT NULL CHECK (shape_kind IN ('point','rect','polygon')),
    geometry jsonb NOT NULL CHECK (jsonb_typeof(geometry) = 'object'),
    z_index integer NOT NULL DEFAULT 0 CHECK (z_index BETWEEN 0 AND 10000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_id, child_entity_id)
);

CREATE INDEX place_plan_item_child
  ON place_plan_item(child_entity_id, plan_id);

-- The service performs the richer shape checks and immediate-child check. The
-- database still guarantees that Plans can only belong to Location Places and
-- can only contain their current immediate child Locations.
CREATE FUNCTION enforce_place_plan_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
  v_role text;
  v_status text;
BEGIN
  SELECT entity_kind, place_role, status INTO v_kind, v_role, v_status
  FROM context_entity WHERE entity_id = NEW.location_entity_id;
  IF v_kind IS DISTINCT FROM 'place'
     OR v_role IS DISTINCT FROM 'location'
     OR v_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Plan owner must be a current Location'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER place_plan_owner_guard
BEFORE INSERT OR UPDATE OF location_entity_id ON place_plan
FOR EACH ROW EXECUTE FUNCTION enforce_place_plan_owner();

CREATE FUNCTION enforce_place_plan_item_child()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_owner_id text;
  v_parent_id text;
  v_kind text;
  v_role text;
  v_status text;
BEGIN
  SELECT location_entity_id INTO v_owner_id
  FROM place_plan WHERE plan_id = NEW.plan_id;
  SELECT parent_entity_id, entity_kind, place_role, status
    INTO v_parent_id, v_kind, v_role, v_status
  FROM context_entity WHERE entity_id = NEW.child_entity_id;
  IF v_parent_id IS DISTINCT FROM v_owner_id
     OR v_kind IS DISTINCT FROM 'place'
     OR v_role IS DISTINCT FROM 'location'
     OR v_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Plan item must be a current immediate child Location'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER place_plan_item_child_guard
BEFORE INSERT OR UPDATE OF plan_id, child_entity_id ON place_plan_item
FOR EACH ROW EXECUTE FUNCTION enforce_place_plan_item_child();

-- A saved Plan remains attached when a Location is archived/deleted so its
-- history is not silently destroyed. Moving a placed child or changing either
-- end out of the Location model must be explicit: remove the placement first.
CREATE FUNCTION enforce_context_entity_plan_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'deleted'
     AND NEW.place_role IS DISTINCT FROM 'location'
     AND (EXISTS (
       SELECT 1 FROM place_plan plan WHERE plan.location_entity_id = NEW.entity_id
     ) OR EXISTS (
       SELECT 1 FROM place_plan_item item WHERE item.child_entity_id = NEW.entity_id
     )) THEN
    RAISE EXCEPTION 'Remove Location Plans before changing the Place role'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_entity_id IS DISTINCT FROM OLD.parent_entity_id
     AND EXISTS (
       SELECT 1 FROM place_plan_item item WHERE item.child_entity_id = NEW.entity_id
     ) THEN
    RAISE EXCEPTION 'Remove this Location from its Plans before moving it'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_entity_plan_membership_guard
BEFORE UPDATE OF parent_entity_id, place_role, status ON context_entity
FOR EACH ROW EXECUTE FUNCTION enforce_context_entity_plan_membership();

ALTER TABLE context_command
  DROP CONSTRAINT context_command_command_kind_check;
ALTER TABLE context_command
  ADD CONSTRAINT context_command_command_kind_check
  CHECK (command_kind IN (
    'create','update','asset_attach','asset_detach',
    'relation_attach','relation_detach','undo','delete','cover_set',
    'place_assignment','plan_save'
  ));

ALTER TABLE context_operation
  DROP CONSTRAINT context_operation_operation_scope_check;
ALTER TABLE context_operation
  ADD CONSTRAINT context_operation_operation_scope_check
  CHECK (operation_scope IN (
    'asset','relation','cover','entity','place_assignment','plan'
  ));

ALTER TABLE context_operation
  DROP CONSTRAINT context_operation_action_check;
ALTER TABLE context_operation
  ADD CONSTRAINT context_operation_action_check
  CHECK (action IN ('attach','detach','set','create','update','assign','save'));

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_location_plan_v1', 'system',
    'cimmich-location-plan', 'v1', now(), now(),
    encode(digest('cimmich-location-plan-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
