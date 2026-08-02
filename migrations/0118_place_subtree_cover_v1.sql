BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_place_subtree_cover_v1', 'system',
    'cimmich-place-subtree-cover', 'v1', now(), now(),
    encode(digest('cimmich-place-subtree-cover-v1', 'sha256'), 'hex'),
    'release-safe'
)
ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE OR REPLACE FUNCTION cimmich_context_cover_available(
  p_entity_id text,
  p_entity_kind text,
  p_asset_id text
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cover_scope(entity_id, depth) AS (
    SELECT p_entity_id, 0
    UNION ALL
    SELECT child.entity_id, parent.depth + 1
    FROM context_entity child
    JOIN cover_scope parent ON child.parent_entity_id = parent.entity_id
    WHERE p_entity_kind = 'place'
      AND child.entity_kind = 'place'
      AND child.status IN ('active','hidden')
      AND parent.depth < 8
  )
  SELECT EXISTS (
    SELECT 1
    FROM cover_scope scope
    JOIN context_asset_link link ON link.entity_id = scope.entity_id
    JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
    WHERE link.asset_id = p_asset_id AND link.state = 'accepted'
  );
$$;

CREATE OR REPLACE FUNCTION enforce_context_entity_cover()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cover_asset_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.entity_kind NOT IN ('place','object','event')
     OR NEW.status NOT IN ('active','hidden','archived') THEN
    RAISE EXCEPTION 'Explicit cover requires a non-deleted Place, Object or Event'
      USING ERRCODE = '23514';
  END IF;
  IF NOT cimmich_context_cover_available(
    NEW.entity_id, NEW.entity_kind, NEW.cover_asset_id
  ) THEN
    RAISE EXCEPTION 'Explicit context cover requires an active accepted link in scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_context_cover_link_after_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_asset_id text := coalesce(NEW.asset_id, OLD.asset_id);
BEGIN
  IF EXISTS (
    SELECT 1
    FROM context_entity entity
    WHERE entity.cover_asset_id = v_asset_id
      AND NOT cimmich_context_cover_available(
        entity.entity_id, entity.entity_kind, entity.cover_asset_id
      )
  ) THEN
    RAISE EXCEPTION 'Context cover link cannot become inactive while selected'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

COMMIT;
