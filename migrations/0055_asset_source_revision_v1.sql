BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_asset_source_revision_v1', 'system',
    'cimmich-asset-source-revision', 'v1', now(), now(),
    encode(digest('cimmich.asset-source-revision.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE asset_source_revision (
    revision_id text PRIMARY KEY CHECK (
        revision_id ~ '^source_revision_[0-9a-f]{40}$'
    ),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    source_access text NOT NULL CHECK (
        source_access IN ('operator_local_read_only','immich_api_read_only')
    ),
    source_binding_digest text NOT NULL CHECK (
        source_binding_digest ~ '^[0-9a-f]{64}$'
    ),
    input_revision text NOT NULL CHECK (input_revision ~ '^[0-9a-f]{64}$'),
    source_content_digest text NOT NULL CHECK (
        source_content_digest ~ '^[0-9a-f]{64}$'
    ),
    byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 1073741824),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, source_access, source_binding_digest, input_revision),
    UNIQUE (asset_id, source_access, source_binding_digest, revision_id)
);

CREATE TABLE asset_source_revision_head (
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    source_access text NOT NULL,
    source_binding_digest text NOT NULL,
    revision_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, source_access, source_binding_digest),
    FOREIGN KEY (
        asset_id, source_access, source_binding_digest, revision_id
    ) REFERENCES asset_source_revision (
        asset_id, source_access, source_binding_digest, revision_id
    )
);

CREATE VIEW current_asset_source_revision AS
SELECT revision.revision_id, revision.asset_id, revision.source_access,
  revision.source_binding_digest, revision.input_revision,
  revision.source_content_digest, revision.byte_length,
  revision.producer_receipt_id, revision.created_at, head.updated_at
FROM asset_source_revision_head head
JOIN asset_source_revision revision
  ON revision.revision_id = head.revision_id
  AND revision.asset_id = head.asset_id
  AND revision.source_access = head.source_access
  AND revision.source_binding_digest = head.source_binding_digest;

CREATE OR REPLACE FUNCTION enforce_asset_source_revision_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ASSET_SOURCE_REVISION_IMMUTABLE_DB'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER asset_source_revision_immutable
BEFORE UPDATE OR DELETE ON asset_source_revision
FOR EACH ROW EXECUTE FUNCTION enforce_asset_source_revision_immutability();

DROP VIEW current_body_detection_result_observation;
CREATE VIEW current_body_detection_result_observation AS
SELECT result.detection_result_id, result.asset_id, result.asset_token,
  result.detector_config_digest, result.input_revision,
  result.source_content_digest, result.result_digest,
  link.body_id, link.observation_order, link.observation_key,
  link.detector_confidence, link.quality_digest,
  current_source.source_kind, current_source.current_proof
FROM body_detection_result result
JOIN body_detection_result_observation link
  ON link.detection_result_id = result.detection_result_id
JOIN body_observation body ON body.body_id = link.body_id
  AND body.asset_id = result.asset_id AND body.state = 'valid'
JOIN LATERAL (
    SELECT candidate.source_kind, candidate.current_proof
    FROM (
        SELECT 'immich_inventory'::text AS source_kind,
          'current_inventory_revision'::text AS current_proof, 1 AS priority
        FROM immich_asset_projection projection
        WHERE projection.cimmich_asset_id = result.asset_id
          AND projection.state = 'active'
          AND projection.input_revision = result.input_revision
        UNION ALL
        SELECT revision.source_access AS source_kind,
          'current_at_last_validated_read'::text AS current_proof, 2 AS priority
        FROM current_asset_source_revision revision
        WHERE revision.asset_id = result.asset_id
          AND revision.input_revision = result.input_revision
          AND revision.source_content_digest = result.source_content_digest
    ) candidate
    ORDER BY candidate.priority, candidate.source_kind
    LIMIT 1
) current_source ON true
WHERE result.outcome = 'bodies_detected';

COMMIT;
