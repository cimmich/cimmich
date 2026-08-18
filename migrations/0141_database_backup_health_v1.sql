BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_database_backup_health_v1', 'system',
    'cimmich.database-backup-health', 'v1', now(), now(),
    encode(digest('cimmich.database-backup-health.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE cimmich_database_backup_policy (
    policy_id text PRIMARY KEY CHECK (policy_id = 'default'),
    frequency text NOT NULL DEFAULT 'manual'
      CHECK (frequency IN ('manual', 'daily', 'weekly')),
    destination_ids text[] NOT NULL DEFAULT '{}',
    retention_count integer NOT NULL DEFAULT 3
      CHECK (retention_count BETWEEN 1 AND 30),
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    producer_receipt_id text NOT NULL DEFAULT
      'receipt_cimmich_database_backup_health_v1'
      REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private'
      CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

INSERT INTO cimmich_database_backup_policy (policy_id)
VALUES ('default') ON CONFLICT (policy_id) DO NOTHING;

CREATE TABLE cimmich_database_backup_run (
    backup_run_id text PRIMARY KEY CHECK (
      backup_run_id ~ '^databasebackup_[0-9a-f]{32}$'
    ),
    trigger_kind text NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled')),
    destination_ids text[] NOT NULL,
    state text NOT NULL CHECK (
      state IN ('queued', 'running', 'complete', 'partial', 'failed')
    ),
    actor_id text,
    database_schema_version integer NOT NULL CHECK (database_schema_version > 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    error text,
    producer_receipt_id text NOT NULL DEFAULT
      'receipt_cimmich_database_backup_health_v1'
      REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private'
      CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

CREATE INDEX cimmich_database_backup_run_latest
  ON cimmich_database_backup_run(started_at DESC);

CREATE TABLE cimmich_database_backup_artifact (
    backup_run_id text NOT NULL
      REFERENCES cimmich_database_backup_run(backup_run_id) ON DELETE CASCADE,
    destination_id text NOT NULL CHECK (
      destination_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ),
    storage_domain text NOT NULL CHECK (
      storage_domain = btrim(storage_domain)
      AND length(storage_domain) BETWEEN 1 AND 120
    ),
    filename text NOT NULL CHECK (
      filename = btrim(filename)
      AND length(filename) BETWEEN 1 AND 180
      AND filename !~ '[/\\]'
    ),
    byte_length bigint NOT NULL CHECK (byte_length > 0),
    content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    database_schema_version integer NOT NULL CHECK (database_schema_version > 0),
    verification_state text NOT NULL DEFAULT 'verified'
      CHECK (verification_state IN ('verified', 'failed', 'missing')),
    created_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    producer_receipt_id text NOT NULL DEFAULT
      'receipt_cimmich_database_backup_health_v1'
      REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private'
      CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    PRIMARY KEY (backup_run_id, destination_id)
);

CREATE INDEX cimmich_database_backup_artifact_latest
  ON cimmich_database_backup_artifact(destination_id, created_at DESC);

COMMENT ON TABLE cimmich_database_backup_policy IS
  'Owner-selected schedule, destinations and retention for Cimmich database backups. Destination roots remain deployment configuration and are never stored here.';
COMMENT ON TABLE cimmich_database_backup_artifact IS
  'Checksummed PostgreSQL custom-format backup artifacts on configured independent storage domains.';

COMMIT;
