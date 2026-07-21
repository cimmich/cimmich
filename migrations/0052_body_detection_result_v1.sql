BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_body_detection_result_v1', 'system',
    'cimmich-body-detection-result', 'v1', now(), now(),
    encode(digest('cimmich.body-detection-result.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE body_detection_result (
    detection_result_id text PRIMARY KEY,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    asset_token text NOT NULL CHECK (asset_token ~ '^[0-9a-f]{64}$'),
    detector_config_digest text NOT NULL CHECK (
        detector_config_digest ~ '^[0-9a-f]{64}$'
    ),
    input_revision text NOT NULL CHECK (input_revision ~ '^[0-9a-f]{64}$'),
    source_content_digest text NOT NULL CHECK (
        source_content_digest ~ '^[0-9a-f]{64}$'
    ),
    outcome text NOT NULL CHECK (outcome IN ('bodies_detected','no_body')),
    body_count integer NOT NULL CHECK (body_count BETWEEN 0 AND 1000),
    result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, detector_config_digest, input_revision),
    CHECK (
        (outcome = 'no_body' AND body_count = 0)
        OR (outcome = 'bodies_detected' AND body_count > 0)
    )
);

CREATE TABLE body_detection_result_observation (
    detection_result_id text NOT NULL REFERENCES body_detection_result(detection_result_id)
        ON DELETE CASCADE,
    body_id text NOT NULL REFERENCES body_observation(body_id) ON DELETE CASCADE,
    observation_order integer NOT NULL CHECK (observation_order >= 0),
    observation_key text NOT NULL CHECK (observation_key ~ '^[0-9a-f]{64}$'),
    detector_confidence numeric NOT NULL CHECK (detector_confidence BETWEEN 0 AND 1),
    quality_digest text NOT NULL CHECK (quality_digest ~ '^[0-9a-f]{64}$'),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (detection_result_id, body_id),
    UNIQUE (detection_result_id, observation_order),
    UNIQUE (detection_result_id, observation_key)
);

CREATE INDEX body_detection_result_asset_history
    ON body_detection_result(asset_id, created_at DESC, detection_result_id DESC);
CREATE INDEX body_detection_result_observation_body
    ON body_detection_result_observation(body_id, detection_result_id);

CREATE VIEW current_body_detection_result_observation AS
SELECT result.detection_result_id, result.asset_id, result.asset_token,
  result.detector_config_digest, result.input_revision,
  result.source_content_digest, result.result_digest,
  link.body_id, link.observation_order, link.observation_key,
  link.detector_confidence, link.quality_digest
FROM body_detection_result result
JOIN body_detection_result_observation link
  ON link.detection_result_id = result.detection_result_id
JOIN body_observation body ON body.body_id = link.body_id
  AND body.asset_id = result.asset_id AND body.state = 'valid'
JOIN immich_asset_projection projection
  ON projection.cimmich_asset_id = result.asset_id
  AND projection.state = 'active'
  AND projection.input_revision = result.input_revision
WHERE result.outcome = 'bodies_detected';

CREATE OR REPLACE FUNCTION enforce_body_detection_result_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'BODY_DETECTION_RESULT_IMMUTABLE_DB'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER body_detection_result_immutable
BEFORE UPDATE OR DELETE ON body_detection_result
FOR EACH ROW EXECUTE FUNCTION enforce_body_detection_result_immutability();

CREATE TRIGGER body_detection_result_observation_immutable
BEFORE UPDATE OR DELETE ON body_detection_result_observation
FOR EACH ROW EXECUTE FUNCTION enforce_body_detection_result_immutability();

COMMIT;
