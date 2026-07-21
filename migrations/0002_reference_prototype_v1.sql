\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE reference_prototype (
    prototype_id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    bucket_id text NOT NULL REFERENCES reference_bucket(bucket_id) ON DELETE CASCADE,
    model_family text NOT NULL,
    model_version text NOT NULL,
    config_digest text NOT NULL,
    dimension integer NOT NULL CHECK (dimension > 0),
    normalized boolean NOT NULL,
    embedding vector NOT NULL,
    member_face_ids text[] NOT NULL CHECK (cardinality(member_face_ids) > 0),
    member_count integer NOT NULL CHECK (member_count = cardinality(member_face_ids)),
    selection_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    policy_version text NOT NULL,
    state text NOT NULL CHECK (state IN ('active','superseded','retired')),
    supersedes_prototype_id text REFERENCES reference_prototype(prototype_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (vector_dims(embedding) = dimension)
);

CREATE UNIQUE INDEX reference_prototype_one_active_config
    ON reference_prototype(bucket_id, model_family, model_version, config_digest)
    WHERE state = 'active';

CREATE VIEW current_reference_prototype AS
SELECT rp.*
FROM reference_prototype rp
JOIN reference_bucket rb ON rb.bucket_id = rp.bucket_id
WHERE rp.state = 'active' AND rb.state = 'active';

CREATE OR REPLACE FUNCTION cimmich_match_scores(
    p_query vector,
    p_model_family text,
    p_model_version text,
    p_config_digest text,
    p_bucket_kinds text[]
) RETURNS TABLE(person_id text, bucket_kind text, best_cosine_score double precision)
LANGUAGE sql STABLE AS $$
    WITH evidence AS (
        SELECT mg.person_id, mg.bucket_kind,
               1 - (mg.embedding <=> p_query) AS cosine_score
        FROM matching_gallery mg
        WHERE mg.model_family = p_model_family
          AND mg.model_version = p_model_version
          AND mg.config_digest = p_config_digest
          AND mg.bucket_kind = ANY (p_bucket_kinds)
          AND vector_dims(mg.embedding) = vector_dims(p_query)
        UNION ALL
        SELECT rp.person_id, rb.bucket_kind,
               1 - (rp.embedding <=> p_query) AS cosine_score
        FROM current_reference_prototype rp
        JOIN reference_bucket rb ON rb.bucket_id = rp.bucket_id
        WHERE rp.model_family = p_model_family
          AND rp.model_version = p_model_version
          AND rp.config_digest = p_config_digest
          AND rb.bucket_kind = ANY (p_bucket_kinds)
          AND vector_dims(rp.embedding) = vector_dims(p_query)
    )
    SELECT evidence.person_id, evidence.bucket_kind,
           max(evidence.cosine_score)::double precision AS best_cosine_score
    FROM evidence
    GROUP BY evidence.person_id, evidence.bucket_kind
    ORDER BY best_cosine_score DESC, evidence.person_id, evidence.bucket_kind;
$$;

COMMIT;
