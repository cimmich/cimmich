BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_hash_linked_archive_mobility_v1', 'system',
    'cimmich-hash-linked-archive-mobility', 'v1', now(), now(),
    encode(digest('cimmich.hash-linked-archive-mobility.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE media_content (
    content_id text PRIMARY KEY CHECK (
        content_id ~ '^media_content_[0-9a-f]{40}$'
    ),
    byte_length bigint CHECK (byte_length IS NULL OR byte_length > 0),
    state text NOT NULL DEFAULT 'active' CHECK (
        state IN ('active','superseded','collision_hold')
    ),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_content_fingerprint (
    content_id text NOT NULL REFERENCES media_content(content_id) ON DELETE CASCADE,
    hash_algorithm text NOT NULL CHECK (hash_algorithm IN ('sha1','sha256')),
    content_digest text NOT NULL CHECK (
        (hash_algorithm = 'sha1' AND content_digest ~ '^[0-9a-f]{40}$')
        OR
        (hash_algorithm = 'sha256' AND content_digest ~ '^[0-9a-f]{64}$')
    ),
    verification text NOT NULL CHECK (
        verification IN ('source_asserted','byte_verified')
    ),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (content_id, hash_algorithm, content_digest),
    UNIQUE (hash_algorithm, content_digest)
);

CREATE TABLE asset_content_link (
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    content_id text NOT NULL REFERENCES media_content(content_id),
    link_kind text NOT NULL DEFAULT 'exact_bytes' CHECK (
        link_kind IN ('exact_bytes','revision')
    ),
    state text NOT NULL DEFAULT 'active' CHECK (
        state IN ('active','superseded','collision_hold')
    ),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, content_id)
);

CREATE UNIQUE INDEX asset_content_link_one_active
    ON asset_content_link(asset_id) WHERE state = 'active';
CREATE INDEX asset_content_link_content_lookup
    ON asset_content_link(content_id, state, asset_id);

CREATE TABLE asset_source_binding (
    binding_id text PRIMARY KEY CHECK (
        binding_id ~ '^source_binding_[0-9a-f]{40}$'
    ),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    content_id text REFERENCES media_content(content_id),
    source_kind text NOT NULL CHECK (
        source_kind IN ('immich','filesystem','trusted_import')
    ),
    source_id text NOT NULL CHECK (length(btrim(source_id)) BETWEEN 1 AND 120),
    external_asset_id text NOT NULL CHECK (
        length(btrim(external_asset_id)) BETWEEN 1 AND 500
    ),
    locator_token text NOT NULL CHECK (
        length(btrim(locator_token)) BETWEEN 1 AND 1000
    ),
    input_revision text CHECK (
        input_revision IS NULL OR input_revision ~ '^[0-9a-f]{64}$'
    ),
    state text NOT NULL DEFAULT 'active' CHECK (
        state IN ('active','offline','missing','superseded','collision_hold')
    ),
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    UNIQUE (source_kind, source_id, external_asset_id)
);

CREATE INDEX asset_source_binding_asset_lookup
    ON asset_source_binding(asset_id, state, source_kind, source_id);
CREATE INDEX asset_source_binding_content_lookup
    ON asset_source_binding(content_id, state);

CREATE TABLE asset_source_binding_event (
    event_id text PRIMARY KEY CHECK (
        event_id ~ '^source_binding_event_[0-9a-f]{40}$'
    ),
    binding_id text NOT NULL REFERENCES asset_source_binding(binding_id)
      ON DELETE CASCADE,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    content_id text REFERENCES media_content(content_id),
    input_revision text CHECK (
        input_revision IS NULL OR input_revision ~ '^[0-9a-f]{64}$'
    ),
    event_kind text NOT NULL CHECK (
        event_kind IN ('observed','moved','offline','missing','superseded')
    ),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (binding_id, asset_id, input_revision, event_kind)
);

CREATE INDEX asset_source_binding_event_history
    ON asset_source_binding_event(binding_id, created_at DESC, event_id DESC);

-- One Cimmich asset may be observed under multiple Immich UUIDs or in multiple
-- Immich installations. The source tuple remains unique; the Cimmich asset no
-- longer does.
ALTER TABLE immich_asset_projection
    DROP CONSTRAINT IF EXISTS immich_asset_projection_cimmich_asset_id_key;
CREATE INDEX immich_asset_projection_cimmich_asset_lookup
    ON immich_asset_projection(cimmich_asset_id, state, source_id, immich_asset_id);

WITH recognized AS (
    SELECT asset_id,
      CASE
        WHEN content_hash ~ '^immich:[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^sha1:[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^sha256:[0-9a-f]{64}$' THEN 'sha256'
        WHEN content_hash ~ '^[0-9a-f]{64}$' THEN 'sha256'
      END AS hash_algorithm,
      CASE
        WHEN content_hash ~ '^immich:[0-9a-f]{40}$' THEN substr(content_hash, 8)
        WHEN content_hash ~ '^sha1:[0-9a-f]{40}$' THEN substr(content_hash, 6)
        WHEN content_hash ~ '^[0-9a-f]{40}$' THEN content_hash
        WHEN content_hash ~ '^sha256:[0-9a-f]{64}$' THEN substr(content_hash, 8)
        WHEN content_hash ~ '^[0-9a-f]{64}$' THEN content_hash
      END AS content_digest
    FROM asset
), normalized AS (
    SELECT asset_id, hash_algorithm, content_digest,
      'media_content_' || substr(encode(digest(
        hash_algorithm || E'\x1f' || content_digest, 'sha256'
      ), 'hex'), 1, 40) AS content_id
    FROM recognized
    WHERE hash_algorithm IS NOT NULL AND content_digest IS NOT NULL
)
INSERT INTO media_content (content_id)
SELECT DISTINCT content_id FROM normalized
ON CONFLICT (content_id) DO NOTHING;

WITH recognized AS (
    SELECT
      CASE
        WHEN content_hash ~ '^immich:[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^sha1:[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^sha256:[0-9a-f]{64}$' THEN 'sha256'
        WHEN content_hash ~ '^[0-9a-f]{64}$' THEN 'sha256'
      END AS hash_algorithm,
      CASE
        WHEN content_hash ~ '^immich:[0-9a-f]{40}$' THEN substr(content_hash, 8)
        WHEN content_hash ~ '^sha1:[0-9a-f]{40}$' THEN substr(content_hash, 6)
        WHEN content_hash ~ '^[0-9a-f]{40}$' THEN content_hash
        WHEN content_hash ~ '^sha256:[0-9a-f]{64}$' THEN substr(content_hash, 8)
        WHEN content_hash ~ '^[0-9a-f]{64}$' THEN content_hash
      END AS content_digest
    FROM asset
), normalized AS (
    SELECT DISTINCT hash_algorithm, content_digest,
      'media_content_' || substr(encode(digest(
        hash_algorithm || E'\x1f' || content_digest, 'sha256'
      ), 'hex'), 1, 40) AS content_id
    FROM recognized
    WHERE hash_algorithm IS NOT NULL AND content_digest IS NOT NULL
)
INSERT INTO media_content_fingerprint (
    content_id, hash_algorithm, content_digest, verification,
    producer_receipt_id
)
SELECT content_id, hash_algorithm, content_digest, 'source_asserted',
  'receipt_cimmich_hash_linked_archive_mobility_v1'
FROM normalized
ON CONFLICT (hash_algorithm, content_digest) DO NOTHING;

WITH recognized AS (
    SELECT asset_id,
      CASE
        WHEN content_hash ~ '^immich:[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^sha1:[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^[0-9a-f]{40}$' THEN 'sha1'
        WHEN content_hash ~ '^sha256:[0-9a-f]{64}$' THEN 'sha256'
        WHEN content_hash ~ '^[0-9a-f]{64}$' THEN 'sha256'
      END AS hash_algorithm,
      CASE
        WHEN content_hash ~ '^immich:[0-9a-f]{40}$' THEN substr(content_hash, 8)
        WHEN content_hash ~ '^sha1:[0-9a-f]{40}$' THEN substr(content_hash, 6)
        WHEN content_hash ~ '^[0-9a-f]{40}$' THEN content_hash
        WHEN content_hash ~ '^sha256:[0-9a-f]{64}$' THEN substr(content_hash, 8)
        WHEN content_hash ~ '^[0-9a-f]{64}$' THEN content_hash
      END AS content_digest
    FROM asset
), normalized AS (
    SELECT asset_id,
      'media_content_' || substr(encode(digest(
        hash_algorithm || E'\x1f' || content_digest, 'sha256'
      ), 'hex'), 1, 40) AS content_id
    FROM recognized
    WHERE hash_algorithm IS NOT NULL AND content_digest IS NOT NULL
)
INSERT INTO asset_content_link (
    asset_id, content_id, producer_receipt_id
)
SELECT asset_id, content_id,
  'receipt_cimmich_hash_linked_archive_mobility_v1'
FROM normalized
ON CONFLICT (asset_id, content_id) DO NOTHING;

INSERT INTO asset_source_binding (
    binding_id, asset_id, content_id, source_kind, source_id,
    external_asset_id, locator_token, input_revision, state
)
SELECT
  'source_binding_' || substr(encode(digest(
    'immich' || E'\x1f' || projection.source_id || E'\x1f'
      || projection.immich_asset_id, 'sha256'
  ), 'hex'), 1, 40),
  projection.cimmich_asset_id,
  link.content_id,
  'immich',
  projection.source_id,
  projection.immich_asset_id,
  'immich:' || projection.source_id || ':' || projection.immich_asset_id,
  projection.input_revision,
  CASE projection.state
    WHEN 'active' THEN 'active'
    WHEN 'suspected_missing' THEN 'offline'
    WHEN 'missing' THEN 'missing'
    ELSE 'superseded'
  END
FROM immich_asset_projection projection
LEFT JOIN asset_content_link link
  ON link.asset_id = projection.cimmich_asset_id AND link.state = 'active'
WHERE projection.cimmich_asset_id IS NOT NULL
ON CONFLICT (source_kind, source_id, external_asset_id) DO UPDATE SET
  asset_id = excluded.asset_id,
  content_id = excluded.content_id,
  locator_token = excluded.locator_token,
  input_revision = excluded.input_revision,
  state = excluded.state,
  last_seen_at = now();

INSERT INTO asset_source_binding_event (
    event_id, binding_id, asset_id, content_id, input_revision, event_kind,
    producer_receipt_id
)
SELECT
  'source_binding_event_' || substr(encode(digest(
    binding.binding_id || E'\x1f' || binding.asset_id || E'\x1f'
      || coalesce(binding.input_revision, '') || E'\x1fobserved', 'sha256'
  ), 'hex'), 1, 40),
  binding.binding_id, binding.asset_id, binding.content_id,
  binding.input_revision, 'observed',
  'receipt_cimmich_hash_linked_archive_mobility_v1'
FROM asset_source_binding binding
ON CONFLICT (binding_id, asset_id, input_revision, event_kind) DO NOTHING;

CREATE VIEW current_asset_source_binding AS
SELECT binding.binding_id, binding.asset_id, binding.content_id,
  binding.source_kind, binding.source_id, binding.external_asset_id,
  binding.locator_token, binding.input_revision, binding.first_seen_at,
  binding.last_seen_at
FROM asset_source_binding binding
JOIN asset ON asset.asset_id = binding.asset_id
WHERE binding.state = 'active' AND asset.state = 'active';

COMMIT;
