BEGIN;

CREATE TABLE asset_label (
    label_id text PRIMARY KEY CHECK (label_id ~ '^label_[0-9a-f]{32}$'),
    display_name text NOT NULL CHECK (
      char_length(display_name) BETWEEN 1 AND 120
      AND display_name = btrim(display_name)
    ),
    normalized_name text NOT NULL UNIQUE CHECK (
      char_length(normalized_name) BETWEEN 1 AND 120
      AND normalized_name = lower(normalized_name)
      AND normalized_name = btrim(normalized_name)
    ),
    status text NOT NULL DEFAULT 'active' CHECK (
      status IN ('active','retired')
    ),
    created_by_actor_id text NOT NULL CHECK (
      char_length(created_by_actor_id) BETWEEN 1 AND 200
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

CREATE TABLE asset_label_command (
    command_id text PRIMARY KEY CHECK (char_length(command_id) BETWEEN 1 AND 240),
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 200),
    command_kind text NOT NULL CHECK (
      command_kind IN ('create','attach','detach','undo')
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private'
);

CREATE TABLE asset_label_decision (
    decision_id text PRIMARY KEY CHECK (
      decision_id ~ '^label_decision_[0-9a-f]{32}$'
    ),
    command_id text NOT NULL UNIQUE REFERENCES asset_label_command(command_id),
    label_id text NOT NULL REFERENCES asset_label(label_id),
    action text NOT NULL CHECK (action IN ('attach','detach','undo')),
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 200),
    undoes_decision_id text REFERENCES asset_label_decision(decision_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    CHECK (
      (action = 'undo' AND undoes_decision_id IS NOT NULL)
      OR (action IN ('attach','detach') AND undoes_decision_id IS NULL)
    )
);

CREATE TABLE asset_label_membership_event (
    event_id text PRIMARY KEY CHECK (
      event_id ~ '^label_event_[0-9a-f]{32}$'
    ),
    decision_id text NOT NULL REFERENCES asset_label_decision(decision_id),
    label_id text NOT NULL REFERENCES asset_label(label_id),
    asset_id text NOT NULL REFERENCES asset(asset_id),
    action text NOT NULL CHECK (action IN ('attach','detach')),
    supersedes_event_id text REFERENCES asset_label_membership_event(event_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    UNIQUE (decision_id, asset_id)
);

CREATE UNIQUE INDEX asset_label_membership_event_one_root
    ON asset_label_membership_event(label_id, asset_id)
    WHERE supersedes_event_id IS NULL;

CREATE INDEX asset_label_membership_event_current_lookup
    ON asset_label_membership_event(label_id, asset_id, created_at DESC, event_id DESC);

CREATE INDEX asset_label_membership_event_decision_lookup
    ON asset_label_membership_event(decision_id, asset_id);

CREATE VIEW current_asset_label_membership AS
SELECT event_id, decision_id, label_id, asset_id, created_at
FROM (
    SELECT event.*,
      row_number() OVER (
        PARTITION BY event.label_id, event.asset_id
        ORDER BY event.created_at DESC, event.event_id DESC
      ) AS position
    FROM asset_label_membership_event event
) latest
WHERE latest.position = 1 AND latest.action = 'attach';

COMMENT ON TABLE asset_label IS
  'Cimmich-owned generic labels. They never mutate Immich tag tables or source sidecars.';
COMMENT ON TABLE asset_label_membership_event IS
  'Append-only membership truth; detach and Undo supersede prior events instead of deleting them.';
COMMENT ON VIEW current_asset_label_membership IS
  'Current attached memberships after the latest append-only event per label and asset.';

CREATE TABLE bulk_album_operation (
    operation_id text PRIMARY KEY CHECK (
      char_length(operation_id) BETWEEN 1 AND 240
    ),
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 200),
    source_path text NOT NULL CHECK (
      char_length(source_path) BETWEEN 1 AND 2000
    ),
    snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
    manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'array'),
    state text NOT NULL DEFAULT 'applying' CHECK (
      state IN ('applying','applied','partial','undoing','undone','kept')
    ),
    album_count integer NOT NULL CHECK (album_count BETWEEN 1 AND 1000),
    asset_count integer NOT NULL CHECK (asset_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

CREATE TABLE bulk_album_operation_command (
    command_id text PRIMARY KEY CHECK (char_length(command_id) BETWEEN 1 AND 240),
    operation_id text NOT NULL REFERENCES bulk_album_operation(operation_id),
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 200),
    command_kind text NOT NULL CHECK (
      command_kind IN ('checkpoint','checkpoint_undo','state')
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private'
);

CREATE TABLE bulk_album_operation_checkpoint (
    checkpoint_id text PRIMARY KEY CHECK (
      checkpoint_id ~ '^album_checkpoint_[0-9a-f]{32}$'
    ),
    operation_id text NOT NULL REFERENCES bulk_album_operation(operation_id),
    command_id text NOT NULL UNIQUE REFERENCES bulk_album_operation_command(command_id),
    batch_sequence integer NOT NULL CHECK (batch_sequence >= 0),
    source_path text NOT NULL CHECK (
      char_length(source_path) BETWEEN 1 AND 2000
    ),
    album_id text NOT NULL CHECK (char_length(album_id) BETWEEN 1 AND 240),
    album_name text NOT NULL CHECK (char_length(album_name) BETWEEN 1 AND 240),
    album_created boolean NOT NULL DEFAULT false,
    asset_ids text[] NOT NULL CHECK (cardinality(asset_ids) BETWEEN 0 AND 100),
    state text NOT NULL DEFAULT 'applied' CHECK (
      state IN ('applied','undone')
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    undone_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    UNIQUE (operation_id, batch_sequence),
    CHECK (cardinality(asset_ids) > 0 OR album_created)
);

CREATE INDEX bulk_album_operation_active
    ON bulk_album_operation(updated_at DESC, operation_id)
    WHERE state IN ('applying','applied','partial','undoing');

CREATE INDEX bulk_album_operation_checkpoint_receipt
    ON bulk_album_operation_checkpoint(operation_id, batch_sequence DESC);

COMMENT ON TABLE bulk_album_operation IS
  'Durable manifest and recovery state for browser-executed folder-to-album runs.';
COMMENT ON TABLE bulk_album_operation_checkpoint IS
  'Exact Immich memberships created by one successful batch; the UI uses these rows for lossless Undo.';

COMMIT;
