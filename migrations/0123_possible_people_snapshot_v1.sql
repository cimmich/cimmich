BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_possible_people_v1', 'system',
    'cimmich-possible-people', 'v1', now(), now(),
    encode(digest('cimmich.possible-people.v1', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE possible_person_run (
    run_id text PRIMARY KEY CHECK (run_id ~ '^possible_run_[0-9a-f]{32}$'),
    command_id text NOT NULL UNIQUE,
    state text NOT NULL CHECK (state IN ('queued','running','completed','failed')),
    algorithm_version text NOT NULL,
    model_family text,
    model_version text,
    config_digest text,
    dimension integer CHECK (dimension IS NULL OR dimension > 0),
    seed_limit integer NOT NULL CHECK (seed_limit > 0),
    neighbour_limit integer NOT NULL CHECK (neighbour_limit > 0),
    similarity_floor numeric NOT NULL CHECK (similarity_floor BETWEEN 0 AND 1),
    total_seeds integer NOT NULL DEFAULT 0 CHECK (total_seeds >= 0),
    processed_seeds integer NOT NULL DEFAULT 0 CHECK (processed_seeds >= 0),
    edge_count integer NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
    cluster_count integer NOT NULL DEFAULT 0 CHECK (cluster_count >= 0),
    error_code text,
    error_message text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX possible_person_run_recent
    ON possible_person_run(created_at DESC, run_id DESC);

CREATE TABLE possible_person_seed (
    run_id text NOT NULL REFERENCES possible_person_run(run_id) ON DELETE CASCADE,
    seed_rank integer NOT NULL CHECK (seed_rank > 0),
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    PRIMARY KEY (run_id, seed_rank),
    UNIQUE (run_id, face_id)
);

CREATE TABLE possible_person_edge (
    run_id text NOT NULL REFERENCES possible_person_run(run_id) ON DELETE CASCADE,
    left_face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    right_face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    similarity numeric NOT NULL CHECK (similarity BETWEEN -1 AND 1),
    support_count integer NOT NULL DEFAULT 1 CHECK (support_count BETWEEN 1 AND 2),
    PRIMARY KEY (run_id, left_face_id, right_face_id),
    CHECK (left_face_id < right_face_id)
);

CREATE INDEX possible_person_edge_run_right
    ON possible_person_edge(run_id, right_face_id);

ALTER TABLE face_cluster
    ADD COLUMN possible_person_run_id text REFERENCES possible_person_run(run_id) ON DELETE CASCADE,
    ADD COLUMN cluster_digest text,
    ADD COLUMN representative_face_id text REFERENCES face_observation(face_id) ON DELETE SET NULL,
    ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN source_revision text,
    ADD COLUMN current_decision_id text REFERENCES decision(decision_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX face_cluster_possible_run_digest
    ON face_cluster(possible_person_run_id, cluster_digest)
    WHERE possible_person_run_id IS NOT NULL;

CREATE INDEX face_cluster_possible_digest_recent
    ON face_cluster(cluster_digest, created_at DESC)
    WHERE possible_person_run_id IS NOT NULL;

CREATE TABLE possible_person_command (
    command_id text PRIMARY KEY,
    actor_id text NOT NULL,
    command_kind text NOT NULL CHECK (command_kind IN ('refresh','resolve','undo')),
    request_digest text NOT NULL,
    state text NOT NULL CHECK (state IN ('started','completed')),
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((state = 'completed') = (response_body IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE FUNCTION cimmich_person_candidate_reviewable(
    claim_origin text,
    evidence_refs jsonb,
    evaluated_pack_id text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT (
      claim_origin = 'prime_match'
      AND evaluated_pack_id IS NOT NULL
      AND coalesce(evidence_refs->>'assignment_decision', '') =
        'source_pack_prime_match'
    ) OR (
      claim_origin = 'cluster_propagation'
      AND coalesce(evidence_refs->>'assignment_decision', '') =
        'cluster_propagation_candidate'
    )
$$;

-- The expression exactly matches discovery's distance ordering. Keeping the
-- predicate independent of a configured model lets the current dominant
-- Cimmich vector space change without rebuilding schema.
SET LOCAL maintenance_work_mem = '512MB';
CREATE INDEX face_embedding_possible_people_ivfflat
    ON face_embedding USING ivfflat ((embedding::vector(512)) vector_cosine_ops)
    WITH (lists = 1024)
    WHERE state = 'active' AND dimension = 512;

COMMIT;
