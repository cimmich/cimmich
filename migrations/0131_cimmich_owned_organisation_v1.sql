BEGIN;

ALTER TABLE asset_label
  ADD COLUMN label_kind text NOT NULL DEFAULT 'label' CHECK (
    label_kind IN ('label','collection','favorite','archive')
  );

ALTER TABLE asset_label
  DROP CONSTRAINT asset_label_normalized_name_key;

CREATE UNIQUE INDEX asset_label_kind_normalized_name_unique
  ON asset_label(label_kind, normalized_name);

CREATE UNIQUE INDEX asset_label_one_favorite_kind
  ON asset_label(label_kind)
  WHERE label_kind = 'favorite' AND status = 'active';

CREATE UNIQUE INDEX asset_label_one_archive_kind
  ON asset_label(label_kind)
  WHERE label_kind = 'archive' AND status = 'active';

INSERT INTO asset_label (
  label_id, display_name, normalized_name, label_kind,
  created_by_actor_id, privacy_class
) VALUES
  (
    'label_00000000000000000000000000000001', 'Favourite',
    '__cimmich_system_favorite__', 'favorite', 'system:migration-0131',
    'private'
  ),
  (
    'label_00000000000000000000000000000002', 'Archived',
    '__cimmich_system_archive__', 'archive', 'system:migration-0131',
    'private'
  )
ON CONFLICT DO NOTHING;

ALTER TABLE bulk_album_operation_checkpoint
  ADD COLUMN organization_decision_id text REFERENCES asset_label_decision(decision_id),
  ADD COLUMN legacy_immich_album_id text;

UPDATE bulk_album_operation_checkpoint
SET legacy_immich_album_id = album_id
WHERE state = 'applied';

UPDATE bulk_album_operation
SET state = 'kept', completed_at = coalesce(completed_at, now()),
  updated_at = now()
WHERE state IN ('applying','applied','partial','undoing');

COMMENT ON COLUMN asset_label.label_kind IS
  'Cimmich-owned organisation kind. Collections, favourite state and archive state never mutate Immich.';
COMMENT ON COLUMN bulk_album_operation_checkpoint.organization_decision_id IS
  'Exact Cimmich asset-label decision used by collection Undo after schema 131.';
COMMENT ON COLUMN bulk_album_operation_checkpoint.legacy_immich_album_id IS
  'Preserved identifier from a pre-131 Immich album receipt. Cimmich never writes through it.';

COMMIT;
