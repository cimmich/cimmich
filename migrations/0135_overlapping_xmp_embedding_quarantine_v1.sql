BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_overlapping_xmp_embedding_quarantine_v1', 'system',
    'cimmich-overlapping-xmp-embedding-quarantine', 'v1', now(), now(),
    encode(digest('cimmich.overlapping-xmp-embedding-quarantine.v1', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at;

CREATE TABLE face_embedding_quarantine (
    quarantine_id text PRIMARY KEY CHECK (
      quarantine_id ~ '^embedding_quarantine_[0-9a-f]{40}$'
    ),
    embedding_id text NOT NULL UNIQUE REFERENCES face_embedding(embedding_id),
    face_id text NOT NULL REFERENCES face_observation(face_id),
    physical_face_id text NOT NULL,
    canonical_face_id text NOT NULL REFERENCES face_observation(face_id),
    neighbour_face_id text NOT NULL REFERENCES face_observation(face_id),
    neighbour_similarity double precision NOT NULL CHECK (
      neighbour_similarity BETWEEN -1 AND 1
    ),
    canonical_similarity double precision NOT NULL CHECK (
      canonical_similarity BETWEEN -1 AND 1
    ),
    reason_code text NOT NULL CHECK (
      reason_code = 'bounded_sidecar_neighbour_embedding_contamination'
    ),
    evidence jsonb NOT NULL,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX face_embedding_quarantine_face
    ON face_embedding_quarantine(face_id, created_at);

CREATE FUNCTION prevent_face_embedding_quarantine_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'FACE_EMBEDDING_QUARANTINE_APPEND_ONLY_DB'
      USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER face_embedding_quarantine_immutable
BEFORE UPDATE OR DELETE ON face_embedding_quarantine
FOR EACH ROW EXECUTE FUNCTION prevent_face_embedding_quarantine_mutation();

-- A sidecar observation is contaminated only when it is a noncanonical member
-- of an accepted physical Face, resembles an intersecting different physical
-- Face, and contradicts its own canonical Face under the exact same vector
-- space. The thresholds intentionally leave a broad abstention gap.
CREATE TEMP TABLE overlapping_xmp_embedding_quarantine ON COMMIT DROP AS
WITH accepted_noncanonical_xmp AS MATERIALIZED (
  SELECT DISTINCT embedding.embedding_id, observation.face_id,
    observation.asset_id, observation.box_x, observation.box_y,
    observation.box_w, observation.box_h,
    member.physical_face_id, member.canonical_face_id,
    embedding.model_family, embedding.model_version, embedding.config_digest,
    embedding.embedding, canonical_embedding.embedding AS canonical_embedding
  FROM current_face_physical_member member
  JOIN current_face_identity identity
    ON identity.face_id = member.face_id AND identity.state = 'accepted'
  JOIN face_observation observation
    ON observation.face_id = member.face_id AND observation.state = 'valid'
  JOIN face_embedding embedding
    ON embedding.face_id = observation.face_id AND embedding.state = 'active'
  JOIN face_embedding canonical_embedding
    ON canonical_embedding.face_id = member.canonical_face_id
    AND canonical_embedding.state = 'active'
    AND canonical_embedding.model_family = embedding.model_family
    AND canonical_embedding.model_version = embedding.model_version
    AND canonical_embedding.config_digest = embedding.config_digest
  WHERE observation.observation_origin = 'xmp_sidecar_import'
    AND member.face_id <> member.canonical_face_id
), contaminated AS MATERIALIZED (
  SELECT candidate.embedding_id, candidate.face_id,
    candidate.physical_face_id, candidate.canonical_face_id,
    neighbour.face_id AS neighbour_face_id,
    (1 - (candidate.embedding <=> neighbour_embedding.embedding))::float8
      AS neighbour_similarity,
    (1 - (candidate.embedding <=> candidate.canonical_embedding))::float8
      AS canonical_similarity
  FROM accepted_noncanonical_xmp candidate
  JOIN current_matchable_physical_face neighbour
    ON neighbour.asset_id = candidate.asset_id
    AND neighbour.physical_face_id <> candidate.physical_face_id
    AND candidate.box_x < neighbour.box_x + neighbour.box_w
    AND neighbour.box_x < candidate.box_x + candidate.box_w
    AND candidate.box_y < neighbour.box_y + neighbour.box_h
    AND neighbour.box_y < candidate.box_y + candidate.box_h
  JOIN face_embedding neighbour_embedding
    ON neighbour_embedding.face_id = neighbour.face_id
    AND neighbour_embedding.state = 'active'
    AND neighbour_embedding.model_family = candidate.model_family
    AND neighbour_embedding.model_version = candidate.model_version
    AND neighbour_embedding.config_digest = candidate.config_digest
  WHERE 1 - (candidate.embedding <=> neighbour_embedding.embedding) >= 0.75
    AND 1 - (candidate.embedding <=> candidate.canonical_embedding) < 0.30
)
SELECT DISTINCT ON (embedding_id) *
FROM contaminated
ORDER BY embedding_id, neighbour_similarity DESC, neighbour_face_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM overlapping_xmp_embedding_quarantine quarantine
    JOIN current_source_pack pack ON true
    JOIN source_pack_reference reference ON reference.pack_id = pack.pack_id
    WHERE reference.face_id = quarantine.face_id
       OR quarantine.face_id = ANY(reference.member_face_ids)
  ) THEN
    RAISE EXCEPTION 'ACTIVE_SOURCE_PACK_CONTAINS_QUARANTINED_EMBEDDING'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

INSERT INTO face_embedding_quarantine (
  quarantine_id, embedding_id, face_id, physical_face_id, canonical_face_id,
  neighbour_face_id, neighbour_similarity, canonical_similarity, reason_code,
  evidence, producer_receipt_id
)
SELECT 'embedding_quarantine_' || substr(
    encode(digest(contaminated.embedding_id, 'sha256'), 'hex'), 1, 40
  ),
  contaminated.embedding_id, contaminated.face_id,
  contaminated.physical_face_id, contaminated.canonical_face_id,
  contaminated.neighbour_face_id, contaminated.neighbour_similarity,
  contaminated.canonical_similarity,
  'bounded_sidecar_neighbour_embedding_contamination',
  jsonb_build_object(
    'automaticIdentityAuthority', 'none',
    'canonicalSimilarityCeiling', 0.30,
    'neighbourSimilarityFloor', 0.75,
    'selectionPolicy', 'bounded-sidecar-target-centre-v1',
    'trainingAuthority', 'none'
  ),
  'receipt_cimmich_overlapping_xmp_embedding_quarantine_v1'
FROM overlapping_xmp_embedding_quarantine contaminated;

UPDATE face_embedding embedding
SET state = 'superseded'
FROM overlapping_xmp_embedding_quarantine quarantine
WHERE embedding.embedding_id = quarantine.embedding_id
  AND embedding.state = 'active';

UPDATE producer_receipt receipt
SET completed_at = now(), result_digest = digest.result_digest
FROM (
  SELECT encode(digest(coalesce(string_agg(
      quarantine_id, ',' ORDER BY quarantine_id
    ), 'empty'), 'sha256'), 'hex') AS result_digest
  FROM face_embedding_quarantine
  WHERE producer_receipt_id =
    'receipt_cimmich_overlapping_xmp_embedding_quarantine_v1'
) digest
WHERE receipt.producer_receipt_id =
  'receipt_cimmich_overlapping_xmp_embedding_quarantine_v1';

COMMIT;
