BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_body_result_source_binding_v1', 'system',
    'cimmich-body-result-source-binding', 'v1', now(), now(),
    encode(digest('cimmich.body-result-source-binding.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE asset_source_revision ADD CONSTRAINT
    asset_source_revision_result_binding_unique UNIQUE (
        revision_id, asset_id, input_revision, source_content_digest
    );

ALTER TABLE body_detection_result ADD COLUMN source_revision_id text;

DO $$
BEGIN
    IF EXISTS (
        SELECT result.detection_result_id
        FROM body_detection_result result
        JOIN asset_source_revision revision
          ON revision.asset_id = result.asset_id
          AND revision.input_revision = result.input_revision
          AND revision.source_content_digest = result.source_content_digest
        GROUP BY result.detection_result_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'BODY_RESULT_SOURCE_REVISION_AMBIGUOUS_DB'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE body_detection_result DISABLE TRIGGER body_detection_result_immutable;
UPDATE body_detection_result result
SET source_revision_id = revision.revision_id
FROM asset_source_revision revision
WHERE revision.asset_id = result.asset_id
  AND revision.input_revision = result.input_revision
  AND revision.source_content_digest = result.source_content_digest;
ALTER TABLE body_detection_result ENABLE TRIGGER body_detection_result_immutable;

ALTER TABLE body_detection_result ADD CONSTRAINT
    body_detection_result_source_revision_fk FOREIGN KEY (
        source_revision_id, asset_id, input_revision, source_content_digest
    ) REFERENCES asset_source_revision (
        revision_id, asset_id, input_revision, source_content_digest
    );

DROP VIEW current_body_detection_result_observation;
CREATE VIEW current_body_detection_result_observation AS
WITH current_result_candidate AS (
    SELECT result.*, current_source.source_kind,
      current_source.current_proof, current_source.source_priority,
      current_source.current_updated_at
    FROM body_detection_result result
    JOIN LATERAL (
        SELECT candidate.source_kind, candidate.current_proof,
          candidate.source_priority, candidate.current_updated_at
        FROM (
            SELECT 'immich_inventory'::text AS source_kind,
              'current_inventory_revision'::text AS current_proof,
              1 AS source_priority, projection.last_seen_at AS current_updated_at
            FROM immich_asset_projection projection
            WHERE result.source_revision_id IS NULL
              AND projection.cimmich_asset_id = result.asset_id
              AND projection.state = 'active'
              AND projection.input_revision = result.input_revision
            UNION ALL
            SELECT revision.source_access AS source_kind,
              'current_at_last_validated_read'::text AS current_proof,
              CASE revision.source_access
                WHEN 'immich_api_read_only' THEN 2 ELSE 3 END AS source_priority,
              revision.updated_at AS current_updated_at
            FROM current_asset_source_revision revision
            WHERE result.source_revision_id = revision.revision_id
              AND revision.asset_id = result.asset_id
              AND revision.input_revision = result.input_revision
              AND revision.source_content_digest = result.source_content_digest
        ) candidate
        ORDER BY candidate.source_priority, candidate.current_updated_at DESC,
          candidate.source_kind
        LIMIT 1
    ) current_source ON true
    WHERE result.outcome = 'bodies_detected'
), selected_result AS (
    SELECT candidate.*, row_number() OVER (
        PARTITION BY candidate.asset_id, candidate.detector_config_digest
        ORDER BY candidate.source_priority, candidate.current_updated_at DESC,
          candidate.created_at DESC, candidate.detection_result_id DESC
    ) AS current_rank
    FROM current_result_candidate candidate
)
SELECT result.detection_result_id, result.asset_id, result.asset_token,
  result.detector_config_digest, result.input_revision,
  result.source_content_digest, result.result_digest,
  link.body_id, link.observation_order, link.observation_key,
  link.detector_confidence, link.quality_digest,
  result.source_kind, result.current_proof
FROM selected_result result
JOIN body_detection_result_observation link
  ON link.detection_result_id = result.detection_result_id
JOIN body_observation body ON body.body_id = link.body_id
  AND body.asset_id = result.asset_id AND body.state = 'valid'
WHERE result.current_rank = 1;

COMMIT;
