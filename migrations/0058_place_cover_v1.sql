BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_place_cover_v1', 'system', 'cimmich-place-cover', 'v1',
    now(), now(), encode(digest('cimmich-place-cover-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

ALTER TABLE context_entity
  ADD COLUMN cover_asset_id text REFERENCES asset(asset_id) ON DELETE SET NULL;

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_cover_place_check
  CHECK (cover_asset_id IS NULL OR entity_kind = 'place');

CREATE INDEX context_entity_cover_asset
  ON context_entity(cover_asset_id) WHERE cover_asset_id IS NOT NULL;

ALTER TABLE context_command DROP CONSTRAINT context_command_command_kind_check;
ALTER TABLE context_command ADD CONSTRAINT context_command_command_kind_check
  CHECK (command_kind IN (
    'create','update','asset_attach','asset_detach',
    'relation_attach','relation_detach','undo','delete','cover_set'
  ));

ALTER TABLE context_operation
  DROP CONSTRAINT context_operation_operation_scope_check;
ALTER TABLE context_operation
  ADD CONSTRAINT context_operation_operation_scope_check
  CHECK (operation_scope IN ('asset','relation','cover'));

ALTER TABLE context_operation DROP CONSTRAINT context_operation_action_check;
ALTER TABLE context_operation ADD CONSTRAINT context_operation_action_check
  CHECK (action IN ('attach','detach','set'));

CREATE FUNCTION enforce_context_entity_cover()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cover_asset_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.entity_kind <> 'place' OR NEW.status NOT IN ('active','hidden','archived') THEN
    RAISE EXCEPTION 'Explicit cover requires a non-deleted Place'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM context_asset_link link
    JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
    WHERE link.entity_id = NEW.entity_id
      AND link.asset_id = NEW.cover_asset_id
      AND link.state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Explicit Place cover requires an active accepted link'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_entity_cover_guard
BEFORE INSERT OR UPDATE OF cover_asset_id, entity_kind, status
ON context_entity FOR EACH ROW EXECUTE FUNCTION enforce_context_entity_cover();

CREATE FUNCTION enforce_context_cover_link_after_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entity_id text := coalesce(NEW.entity_id, OLD.entity_id);
BEGIN
  IF EXISTS (
    SELECT 1 FROM context_entity entity
    WHERE entity.entity_id = v_entity_id
      AND entity.cover_asset_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM context_asset_link link
        JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
        WHERE link.entity_id = entity.entity_id
          AND link.asset_id = entity.cover_asset_id
          AND link.state = 'accepted'
      )
  ) THEN
    RAISE EXCEPTION 'Place cover link cannot become inactive while selected'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER context_cover_link_guard
AFTER INSERT OR UPDATE OR DELETE ON context_asset_link
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_context_cover_link_after_change();

COMMIT;
