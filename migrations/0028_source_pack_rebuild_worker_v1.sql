BEGIN;

ALTER TABLE source_pack_rebuild_request
  ADD COLUMN request_digest text,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN result_pack_id text REFERENCES source_pack(pack_id),
  ADD COLUMN superseded_by_request_id text REFERENCES source_pack_rebuild_request(rebuild_request_id);

UPDATE source_pack_rebuild_request
SET request_digest = encode(digest(
  concat_ws(E'\x1f', person_id, reason_code, subject_type, subject_id,
    coalesce(model_family, ''), coalesce(model_version, ''), coalesce(config_digest, '')),
  'sha256'), 'hex')
WHERE request_digest IS NULL;

ALTER TABLE source_pack_rebuild_request
  ALTER COLUMN request_digest SET NOT NULL;

ALTER TABLE source_pack_rebuild_request
  ADD CONSTRAINT source_pack_rebuild_request_digest_sha256
  CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT source_pack_rebuild_lease_consistency CHECK (
    (state = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT source_pack_rebuild_completion_consistency CHECK (
    (state = 'completed' AND result_pack_id IS NOT NULL AND completed_at IS NOT NULL)
    OR state <> 'completed'
  ),
  ADD CONSTRAINT source_pack_rebuild_supersession_consistency CHECK (
    (state = 'superseded' AND superseded_by_request_id IS NOT NULL AND completed_at IS NOT NULL)
    OR state <> 'superseded'
  );

CREATE INDEX source_pack_rebuild_lease_expiry
  ON source_pack_rebuild_request(lease_expires_at)
  WHERE state = 'processing';

CREATE INDEX source_pack_rebuild_configuration_pending
  ON source_pack_rebuild_request(model_family, model_version, config_digest, requested_at)
  WHERE state = 'pending';

WITH ranked AS (
  SELECT rebuild_request_id,
    first_value(rebuild_request_id) OVER (
      PARTITION BY person_id, coalesce(model_family, ''), coalesce(model_version, ''), coalesce(config_digest, '')
      ORDER BY requested_at, rebuild_request_id
    ) AS survivor,
    row_number() OVER (
      PARTITION BY person_id, coalesce(model_family, ''), coalesce(model_version, ''), coalesce(config_digest, '')
      ORDER BY requested_at, rebuild_request_id
    ) AS ordinal
  FROM source_pack_rebuild_request
  WHERE state = 'pending'
)
UPDATE source_pack_rebuild_request request
SET state = 'superseded', superseded_by_request_id = ranked.survivor,
  completed_at = now(), last_error = NULL
FROM ranked
WHERE request.rebuild_request_id = ranked.rebuild_request_id
  AND ranked.ordinal > 1;

CREATE OR REPLACE FUNCTION enqueue_source_pack_rebuild(
  p_person_id text,
  p_reason_code text,
  p_subject_type text,
  p_subject_id text,
  p_model_family text DEFAULT NULL,
  p_model_version text DEFAULT NULL,
  p_config_digest text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_request_id text := 'rebuild_' || replace(gen_random_uuid()::text, '-', '');
  v_pending_id text;
  v_key text := concat_ws(E'\x1f', p_person_id, coalesce(p_model_family, ''),
    coalesce(p_model_version, ''), coalesce(p_config_digest, ''));
  v_digest text := encode(digest(concat_ws(E'\x1f', p_person_id, p_reason_code,
    p_subject_type, p_subject_id, coalesce(p_model_family, ''),
    coalesce(p_model_version, ''), coalesce(p_config_digest, '')), 'sha256'), 'hex');
BEGIN
  -- One trailing pending request per Person/config is enough. A request arriving
  -- while another is processing remains pending so a concurrent correction can
  -- never be swallowed by an older snapshot.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  SELECT rebuild_request_id INTO v_pending_id
  FROM source_pack_rebuild_request
  WHERE person_id = p_person_id
    AND coalesce(model_family, '') = coalesce(p_model_family, '')
    AND coalesce(model_version, '') = coalesce(p_model_version, '')
    AND coalesce(config_digest, '') = coalesce(p_config_digest, '')
    AND state = 'pending'
  ORDER BY requested_at, rebuild_request_id
  LIMIT 1;

  INSERT INTO source_pack_rebuild_request (
    rebuild_request_id, person_id, reason_code, subject_type, subject_id,
    model_family, model_version, config_digest, request_digest, state,
    superseded_by_request_id, completed_at
  ) VALUES (
    v_request_id, p_person_id, p_reason_code, p_subject_type, p_subject_id,
    p_model_family, p_model_version, p_config_digest, v_digest,
    CASE WHEN v_pending_id IS NULL THEN 'pending' ELSE 'superseded' END,
    v_pending_id,
    CASE WHEN v_pending_id IS NULL THEN NULL ELSE now() END
  );
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_capture_context_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_person_id text;
BEGIN
    FOR v_person_id IN
        SELECT DISTINCT identity.person_id
        FROM (
            SELECT member.asset_id
            FROM current_capture_context_member member
            WHERE member.context_id = NEW.context_id
            UNION
            SELECT NEW.asset_id
        ) affected_asset
        JOIN face_observation face
          ON face.asset_id = affected_asset.asset_id AND face.state = 'valid'
        JOIN current_face_identity identity
          ON identity.face_id = face.face_id AND identity.state = 'accepted'
    LOOP
        -- A multi-member context edit emits one provenance row per Person in
        -- this transaction. Later transactions still enqueue fresh work.
        IF NOT EXISTS (
            SELECT 1
            FROM source_pack_rebuild_request request
            WHERE request.person_id = v_person_id
              AND request.reason_code = 'capture_context_changed'
              AND request.subject_type = 'capture_context'
              AND request.subject_id = NEW.context_id
              AND request.requested_at >= transaction_timestamp()
        ) THEN
            PERFORM enqueue_source_pack_rebuild(
                v_person_id, 'capture_context_changed', 'capture_context', NEW.context_id
            );
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW source_pack_rebuild_status AS
SELECT
  count(*) FILTER (WHERE state = 'pending')::int AS pending,
  count(*) FILTER (WHERE state = 'processing')::int AS processing,
  count(*) FILTER (WHERE state = 'completed')::int AS completed,
  count(*) FILTER (WHERE state = 'failed')::int AS failed,
  count(*) FILTER (WHERE state = 'superseded')::int AS superseded,
  min(requested_at) FILTER (WHERE state = 'pending') AS oldest_pending_at,
  max(completed_at) FILTER (WHERE state = 'completed') AS latest_completed_at
FROM source_pack_rebuild_request;

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_source_pack_rebuild_worker_v1', 'system',
  'cimmich-source-pack-rebuild-worker', 'v1', now(), now(),
  encode(digest('cimmich-source-pack-rebuild-worker-v1', 'sha256'), 'hex'),
  'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at, result_digest = excluded.result_digest;

COMMIT;
