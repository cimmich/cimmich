BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_event_cover_v1', 'system', 'cimmich-event-cover', 'v1',
    now(), now(), encode(digest('cimmich-event-cover-v1', 'sha256'), 'hex'),
    'release-safe'
)
ON CONFLICT (producer_receipt_id) DO NOTHING;

ALTER TABLE context_entity
  DROP CONSTRAINT context_entity_cover_supported_kind_check;
ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_cover_supported_kind_check
  CHECK (cover_asset_id IS NULL OR entity_kind IN ('place','object','event'));

CREATE OR REPLACE FUNCTION enforce_context_entity_cover()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cover_asset_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.entity_kind NOT IN ('place','object','event')
     OR NEW.status NOT IN ('active','hidden','archived') THEN
    RAISE EXCEPTION 'Explicit cover requires a non-deleted Place, Object or Event'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM context_asset_link link
    JOIN asset ON asset.asset_id = link.asset_id AND asset.state = 'active'
    WHERE link.entity_id = NEW.entity_id
      AND link.asset_id = NEW.cover_asset_id
      AND link.state = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Explicit context cover requires an active accepted link'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
