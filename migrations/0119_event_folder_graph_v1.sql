BEGIN;

-- Folder-backed Event creation must remember the user's source organisation so
-- a memory can be refreshed later without treating its photos as copies.
CREATE FUNCTION cimmich_event_source_folders_valid(value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 20 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value) folder
    WHERE jsonb_typeof(folder) <> 'string'
      OR length(folder #>> '{}') NOT BETWEEN 1 AND 1000
      OR (folder #>> '{}') <> btrim(folder #>> '{}')
      OR (folder #>> '{}') ~ '[[:cntrl:]]'
  ) THEN
    RETURN false;
  END IF;
  RETURN jsonb_array_length(value) = (
    SELECT count(DISTINCT folder #>> '{}')
    FROM jsonb_array_elements(value) folder
  );
END;
$$;

ALTER TABLE context_entity
  ADD COLUMN source_folders jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_event_source_folders_check CHECK (
    cimmich_event_source_folders_valid(source_folders)
    AND (entity_kind = 'event' OR source_folders = '[]'::jsonb)
  );

COMMIT;
