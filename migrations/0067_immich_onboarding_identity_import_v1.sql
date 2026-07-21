BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_immich_onboarding_identity_import_v1', 'system',
    'cimmich-immich-onboarding-identity-import', 'v1', now(), now(),
    encode(digest('cimmich.immich-onboarding.v1', 'sha256'), 'hex'), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE face_observation
    DROP CONSTRAINT face_observation_origin_check,
    DROP CONSTRAINT face_observation_confidence_origin_check;

ALTER TABLE face_observation
    ADD CONSTRAINT face_observation_origin_check CHECK (
        observation_origin IN ('detector_or_import', 'manual_user', 'immich_import')
    ),
    ADD CONSTRAINT face_observation_confidence_origin_check CHECK (
        (observation_origin IN ('manual_user', 'immich_import')
          AND detection_confidence IS NULL)
        OR
        (observation_origin = 'detector_or_import'
          AND detection_confidence IS NOT NULL)
    );

CREATE TABLE immich_onboarding_run (
    run_id text PRIMARY KEY CHECK (
      run_id ~ '^immich_onboarding_[0-9a-f]{32}$'
    ),
    command_id text NOT NULL UNIQUE CHECK (
      command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    source_id text NOT NULL CHECK (length(btrim(source_id)) BETWEEN 1 AND 120),
    principal_id text NOT NULL CHECK (length(btrim(principal_id)) BETWEEN 1 AND 200),
    immich_version text NOT NULL CHECK (length(btrim(immich_version)) BETWEEN 1 AND 80),
    scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
    scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
    preview_digest text NOT NULL CHECK (preview_digest ~ '^[0-9a-f]{64}$'),
    state text NOT NULL CHECK (state IN (
      'importing','completed','interrupted','conflict'
    )),
    progress jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progress) = 'object'),
    result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((state = 'completed') = (result IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE immich_companion_connection_command (
    command_id text PRIMARY KEY CHECK (
      command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    principal_id text NOT NULL CHECK (length(btrim(principal_id)) BETWEEN 1 AND 200),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX immich_onboarding_one_active_source
    ON immich_onboarding_run(source_id) WHERE state = 'importing';

ALTER TABLE immich_inventory_run
    ADD COLUMN selected_visibilities text[] NOT NULL
      DEFAULT ARRAY['timeline','archive','hidden','locked']::text[],
    ADD CONSTRAINT immich_inventory_selected_visibilities_check CHECK (
      cardinality(selected_visibilities) BETWEEN 1 AND 4
      AND selected_visibilities <@ ARRAY['timeline','archive','hidden','locked']::text[]
      AND cardinality(array_positions(selected_visibilities, 'timeline')) <= 1
      AND cardinality(array_positions(selected_visibilities, 'archive')) <= 1
      AND cardinality(array_positions(selected_visibilities, 'hidden')) <= 1
      AND cardinality(array_positions(selected_visibilities, 'locked')) <= 1
    );

CREATE FUNCTION scope_immich_inventory_run(
    p_run_id text,
    p_visibilities text[]
) RETURNS immich_inventory_run LANGUAGE plpgsql AS $$
DECLARE
    v_run immich_inventory_run;
    v_sorted text[];
BEGIN
    SELECT array_agg(item ORDER BY array_position(
      ARRAY['timeline','archive','hidden','locked']::text[], item
    )) INTO v_sorted FROM (SELECT DISTINCT unnest(p_visibilities) AS item) items;
    IF v_sorted IS NULL OR cardinality(v_sorted) NOT BETWEEN 1 AND 4
      OR NOT (v_sorted <@ ARRAY['timeline','archive','hidden','locked']::text[]) THEN
      RAISE EXCEPTION 'invalid Immich inventory visibility scope'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_run FROM immich_inventory_run
      WHERE run_id = p_run_id FOR UPDATE;
    IF NOT FOUND OR v_run.state <> 'processing' THEN
      RAISE EXCEPTION 'processing Immich inventory run not found'
        USING ERRCODE = '55000';
    END IF;
    IF v_run.page_count <> 0 AND v_run.selected_visibilities <> v_sorted THEN
      RAISE EXCEPTION 'processing Immich inventory scope changed'
        USING ERRCODE = '23514';
    END IF;
    UPDATE immich_inventory_run SET selected_visibilities = v_sorted
      WHERE run_id = p_run_id RETURNING * INTO v_run;
    UPDATE immich_inventory_lane SET state = 'completed', updated_at = now()
      WHERE run_id = p_run_id AND NOT (visibility = ANY(v_sorted))
        AND page_count = 0;
    RETURN v_run;
END;
$$;

CREATE FUNCTION complete_scoped_immich_inventory_run(p_run_id text)
RETURNS immich_inventory_run LANGUAGE plpgsql AS $$
DECLARE
    v_run immich_inventory_run;
    v_observed bigint;
BEGIN
    SELECT * INTO v_run FROM immich_inventory_run
      WHERE run_id = p_run_id FOR UPDATE;
    IF NOT FOUND OR v_run.state <> 'processing' THEN
      RAISE EXCEPTION 'processing Immich inventory run not found'
        USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM immich_inventory_lane
      WHERE run_id = p_run_id AND visibility = ANY(v_run.selected_visibilities)
        AND state <> 'completed'
    ) THEN
      RAISE EXCEPTION 'Immich inventory selected lanes are incomplete'
        USING ERRCODE = '23514';
    END IF;

    WITH absent AS (
      UPDATE immich_asset_projection SET state = CASE
        WHEN state = 'suspected_missing' THEN 'missing' ELSE 'suspected_missing' END
      WHERE source_id = v_run.source_id AND state <> 'missing'
        AND visibility = ANY(v_run.selected_visibilities)
        AND last_seen_run_id <> p_run_id
      RETURNING cimmich_asset_id
    ), paused AS (
      UPDATE media_job job SET state = 'paused',
        attempt_count = CASE WHEN job.state = 'processing'
          THEN greatest(job.attempt_count - 1, 0) ELSE job.attempt_count END,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = 'ASSET_NOT_VISIBLE'
      FROM absent
      WHERE absent.cimmich_asset_id IS NOT NULL
        AND job.asset_id = absent.cimmich_asset_id
        AND job.state IN ('pending','processing')
      RETURNING job.*
    )
    INSERT INTO media_job_event (
      event_id, job_id, event_kind, attempt_count, checkpoint_revision,
      public_details
    ) SELECT
      'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
      job_id, 'paused', attempt_count, checkpoint_revision,
      '{"reason":"asset_not_visible"}'::jsonb
    FROM paused;

    UPDATE asset SET state = 'missing'
    WHERE asset_id IN (
      SELECT cimmich_asset_id FROM immich_asset_projection
      WHERE source_id = v_run.source_id
        AND visibility = ANY(v_run.selected_visibilities)
        AND state = 'missing'
        AND cimmich_asset_id IS NOT NULL
    );
    SELECT count(*) INTO v_observed FROM immich_asset_projection
      WHERE source_id = v_run.source_id AND last_seen_run_id = p_run_id;
    UPDATE source_snapshot SET state = 'complete', completed_at = now(),
      declared_asset_count = v_observed, observed_asset_count = v_observed
      WHERE snapshot_id = v_run.snapshot_id;
    UPDATE immich_inventory_run SET state = 'completed', completed_at = now(),
      observed_asset_count = v_observed,
      page_count = (SELECT coalesce(sum(page_count), 0)::int
        FROM immich_inventory_lane WHERE run_id = p_run_id)
      WHERE run_id = p_run_id RETURNING * INTO v_run;
    UPDATE immich_inventory_source SET last_completed_run_id = p_run_id,
      updated_at = now() WHERE source_id = v_run.source_id;
    RETURN v_run;
END;
$$;

CREATE TABLE immich_face_projection (
    source_id text NOT NULL CHECK (length(btrim(source_id)) BETWEEN 1 AND 120),
    immich_face_id text NOT NULL CHECK (length(btrim(immich_face_id)) BETWEEN 1 AND 200),
    immich_asset_id text NOT NULL CHECK (length(btrim(immich_asset_id)) BETWEEN 1 AND 200),
    cimmich_asset_id text NOT NULL REFERENCES asset(asset_id),
    immich_person_id text CHECK (
      immich_person_id IS NULL OR length(btrim(immich_person_id)) BETWEEN 1 AND 200
    ),
    person_id text REFERENCES person(person_id),
    cimmich_face_id text REFERENCES face_observation(face_id),
    source_face_id text REFERENCES face_observation(face_id),
    provider_face_id text REFERENCES face_observation(face_id),
    identity_claim_id text REFERENCES identity_claim(identity_claim_id),
    decision_id text REFERENCES decision(decision_id),
    asset_input_revision text NOT NULL CHECK (asset_input_revision ~ '^[0-9a-f]{64}$'),
    source_revision text NOT NULL CHECK (source_revision ~ '^[0-9a-f]{64}$'),
    box_x numeric NOT NULL CHECK (box_x BETWEEN 0 AND 1),
    box_y numeric NOT NULL CHECK (box_y BETWEEN 0 AND 1),
    box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    reconciliation_state text NOT NULL CHECK (reconciliation_state IN (
      'unassigned','source_only','exact_provider_bind','ambiguous_provider_bind',
      'missing_provider_face','stale_asset_revision','person_conflict','identity_conflict'
    )),
    state text NOT NULL CHECK (state IN ('active','superseded')),
    run_id text NOT NULL REFERENCES immich_onboarding_run(run_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, immich_face_id),
    CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001),
    CHECK (
      (immich_person_id IS NULL AND person_id IS NULL)
      OR immich_person_id IS NOT NULL
    ),
    CHECK ((reconciliation_state = 'unassigned') = (immich_person_id IS NULL)),
    CHECK ((reconciliation_state = 'exact_provider_bind') = (provider_face_id IS NOT NULL)),
    CHECK (
      reconciliation_state IN ('unassigned','ambiguous_provider_bind','stale_asset_revision','person_conflict')
      OR cimmich_face_id IS NOT NULL
    ),
    CHECK ((identity_claim_id IS NULL) = (decision_id IS NULL))
);

CREATE UNIQUE INDEX immich_face_projection_current_cimmich_face
    ON immich_face_projection(cimmich_face_id)
    WHERE state = 'active' AND cimmich_face_id IS NOT NULL;
CREATE INDEX immich_face_projection_asset
    ON immich_face_projection(source_id, immich_asset_id, state);

CREATE TABLE immich_onboarding_review_item (
    review_item_id text PRIMARY KEY CHECK (
      review_item_id ~ '^immich_review_[0-9a-f]{40}$'
    ),
    run_id text NOT NULL REFERENCES immich_onboarding_run(run_id),
    source_id text NOT NULL,
    immich_face_id text,
    cimmich_asset_id text REFERENCES asset(asset_id),
    reason text NOT NULL CHECK (reason IN (
      'duplicate_person_name','ambiguous_provider_geometry','missing_provider_face',
      'stale_asset_revision','source_face_unassigned','extra_provider_face',
      'provider_identity_conflict','person_revision_changed'
    )),
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','superseded')),
    public_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(public_details) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, review_item_id)
);

CREATE OR REPLACE FUNCTION reject_immich_import_embedding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM face_observation face
    WHERE face.face_id = NEW.face_id AND face.observation_origin = 'immich_import'
  ) THEN
    RAISE EXCEPTION 'IMMICH_IMPORT_FACE_EMBEDDING_FORBIDDEN_DB'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER immich_import_face_embedding_forbidden
BEFORE INSERT OR UPDATE OF face_id ON face_embedding
FOR EACH ROW EXECUTE FUNCTION reject_immich_import_embedding();

INSERT INTO cimmich_visibility_projection_surface (
    surface_key, coverage_state, asset_derived, route_family, reason_code,
    producer_receipt_id
) VALUES (
    'immich_onboarding', 'enforced', true, '/v1/onboarding/immich', NULL,
    'receipt_cimmich_immich_onboarding_identity_import_v1'
);

CREATE OR REPLACE FUNCTION enqueue_identity_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'accepted' AND NOT EXISTS (
      SELECT 1 FROM face_observation face
      WHERE face.face_id = NEW.face_id
        AND face.observation_origin IN ('manual_user','immich_import')
    ) THEN
      PERFORM enqueue_source_pack_rebuild(NEW.person_id, 'identity_accepted', 'identity_claim', NEW.identity_claim_id);
    END IF;
  ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
    IF OLD.state = 'accepted' AND (
      NOT EXISTS (SELECT 1 FROM face_observation face
        WHERE face.face_id = OLD.face_id
          AND face.observation_origin IN ('manual_user','immich_import'))
      OR EXISTS (SELECT 1 FROM source_pack_reference reference
        WHERE reference.face_id = OLD.face_id OR OLD.face_id = ANY(reference.member_face_ids))
    ) THEN
      PERFORM enqueue_source_pack_rebuild(OLD.person_id, 'identity_removed', 'identity_claim', OLD.identity_claim_id);
    END IF;
    IF NEW.state = 'accepted' AND NOT EXISTS (
      SELECT 1 FROM face_observation face
      WHERE face.face_id = NEW.face_id
        AND face.observation_origin IN ('manual_user','immich_import')
    ) THEN
      PERFORM enqueue_source_pack_rebuild(NEW.person_id, 'identity_accepted', 'identity_claim', NEW.identity_claim_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
