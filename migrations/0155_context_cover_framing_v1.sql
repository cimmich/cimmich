BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_context_cover_framing_v1', 'system',
    'cimmich-context-cover-framing', 'v1', now(), now(),
    encode(digest('cimmich-context-cover-framing-v1', 'sha256'), 'hex'),
    'release-safe'
)
ON CONFLICT (producer_receipt_id) DO NOTHING;

ALTER TABLE context_entity
  ADD COLUMN cover_crop jsonb;

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_cover_crop_shape_check CHECK (
    cover_crop IS NULL OR (
      jsonb_typeof(cover_crop) = 'object'
      AND cover_crop ?& ARRAY['x','y','w','h']
      AND jsonb_typeof(cover_crop->'x') = 'number'
      AND jsonb_typeof(cover_crop->'y') = 'number'
      AND jsonb_typeof(cover_crop->'w') = 'number'
      AND jsonb_typeof(cover_crop->'h') = 'number'
      AND (cover_crop->>'x')::numeric >= 0
      AND (cover_crop->>'y')::numeric >= 0
      AND (cover_crop->>'w')::numeric > 0
      AND (cover_crop->>'h')::numeric > 0
      AND (cover_crop->>'x')::numeric + (cover_crop->>'w')::numeric <= 1.000001
      AND (cover_crop->>'y')::numeric + (cover_crop->>'h')::numeric <= 1.000001
    )
  ),
  ADD CONSTRAINT context_entity_cover_crop_requires_asset_check CHECK (
    cover_crop IS NULL OR cover_asset_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION enforce_context_entity_cover()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cover_asset_id IS NULL THEN
    NEW.cover_crop := NULL;
    RETURN NEW;
  END IF;
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

COMMIT;
