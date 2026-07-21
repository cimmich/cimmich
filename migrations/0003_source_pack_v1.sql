BEGIN;

CREATE TABLE source_pack (
    pack_id text PRIMARY KEY,
    pack_digest text NOT NULL UNIQUE CHECK (pack_digest ~ '^[0-9a-f]{64}$'),
    predecessor_pack_id text REFERENCES source_pack(pack_id),
    model_family text NOT NULL,
    model_version text NOT NULL,
    config_digest text NOT NULL,
    dimension integer NOT NULL CHECK (dimension > 0),
    policy_version text NOT NULL,
    source_revision_digest text NOT NULL CHECK (source_revision_digest ~ '^[0-9a-f]{64}$'),
    evidence_cutoff timestamptz NOT NULL,
    manifest jsonb NOT NULL,
    state text NOT NULL CHECK (state IN ('proposed','shadow','active','retired','rejected')),
    evaluation_status text NOT NULL DEFAULT 'untested' CHECK (evaluation_status IN ('untested','incomplete','passed','failed')),
    evaluation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX source_pack_one_active_config
    ON source_pack(model_family, model_version, config_digest)
    WHERE state = 'active';

CREATE TABLE source_pack_reference (
    pack_id text NOT NULL REFERENCES source_pack(pack_id) ON DELETE CASCADE,
    reference_id text NOT NULL,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    bucket_kind text NOT NULL CHECK (bucket_kind IN ('prime','secondary','specialty')),
    reference_kind text NOT NULL CHECK (reference_kind IN ('face','prototype')),
    face_id text REFERENCES face_observation(face_id) ON DELETE RESTRICT,
    member_face_ids text[] NOT NULL DEFAULT '{}',
    model_family text NOT NULL,
    model_version text NOT NULL,
    config_digest text NOT NULL,
    dimension integer NOT NULL CHECK (dimension > 0),
    normalized boolean NOT NULL,
    embedding vector NOT NULL,
    vector_digest text NOT NULL CHECK (vector_digest ~ '^[0-9a-f]{64}$'),
    quality_score double precision,
    condition_features jsonb NOT NULL DEFAULT '{}'::jsonb,
    routing_state text NOT NULL DEFAULT 'eligible' CHECK (routing_state IN ('eligible','unmeasured','disabled')),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (pack_id, reference_id),
    CHECK (vector_dims(embedding) = dimension),
    CHECK (
      (reference_kind = 'face' AND face_id IS NOT NULL AND cardinality(member_face_ids) = 0)
      OR
      (reference_kind = 'prototype' AND face_id IS NULL AND cardinality(member_face_ids) > 0)
    )
);

CREATE INDEX source_pack_reference_lookup
    ON source_pack_reference(pack_id, bucket_kind, person_id);

CREATE TABLE source_pack_evaluation (
    evaluation_id text PRIMARY KEY,
    pack_id text NOT NULL REFERENCES source_pack(pack_id) ON DELETE CASCADE,
    evaluator_version text NOT NULL,
    split_definition jsonb NOT NULL,
    cohort_digest text NOT NULL CHECK (cohort_digest ~ '^[0-9a-f]{64}$'),
    leakage_assertions jsonb NOT NULL,
    metrics jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('incomplete','passed','failed')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE VIEW current_source_pack AS
SELECT *
FROM source_pack
WHERE state = 'active';

CREATE VIEW source_pack_matching_gallery AS
SELECT sp.pack_id, sp.pack_digest, spr.person_id, spr.bucket_kind, spr.reference_kind,
       spr.reference_id, spr.face_id, spr.model_family, spr.model_version,
       spr.config_digest, spr.dimension, spr.embedding, spr.quality_score,
       spr.condition_features, spr.routing_state
FROM source_pack sp
JOIN source_pack_reference spr USING (pack_id)
WHERE sp.state = 'active' AND spr.routing_state = 'eligible';

COMMIT;
