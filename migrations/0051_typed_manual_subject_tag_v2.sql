BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_typed_manual_subject_tag_v2', 'system',
    'cimmich-typed-manual-subject-tag', 'v2', now(), now(),
    encode(digest('cimmich.typed-manual-subject-tag.v2', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE manual_head_observation (
    head_id text PRIMARY KEY,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    box_x numeric NOT NULL CHECK (box_x BETWEEN 0 AND 1),
    box_y numeric NOT NULL CHECK (box_y BETWEEN 0 AND 1),
    box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    observation_origin text NOT NULL DEFAULT 'manual_user'
        CHECK (observation_origin = 'manual_user'),
    state text NOT NULL CHECK (state IN ('valid','rejected')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001)
);

CREATE INDEX manual_head_observation_asset
    ON manual_head_observation(asset_id, state, head_id);

CREATE TABLE manual_head_tag (
    head_tag_id text PRIMARY KEY,
    head_id text NOT NULL REFERENCES manual_head_observation(head_id) ON DELETE CASCADE,
    subject_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    subject_kind text NOT NULL CHECK (subject_kind IN ('person','pet')),
    origin text NOT NULL DEFAULT 'user' CHECK (origin = 'user'),
    state text NOT NULL CHECK (state IN ('accepted','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX manual_head_tag_one_accepted_per_head
    ON manual_head_tag(head_id) WHERE state = 'accepted';
CREATE INDEX manual_head_tag_subject
    ON manual_head_tag(subject_kind, subject_id, state, head_id);

CREATE OR REPLACE FUNCTION enforce_manual_head_truth()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    actual_kind text;
BEGIN
    IF TG_TABLE_NAME = 'manual_head_observation' THEN
        IF TG_OP = 'UPDATE' AND (
          NEW.asset_id IS DISTINCT FROM OLD.asset_id
          OR NEW.box_x IS DISTINCT FROM OLD.box_x
          OR NEW.box_y IS DISTINCT FROM OLD.box_y
          OR NEW.box_w IS DISTINCT FROM OLD.box_w
          OR NEW.box_h IS DISTINCT FROM OLD.box_h
          OR NEW.observation_origin IS DISTINCT FROM OLD.observation_origin
          OR NEW.producer_receipt_id IS DISTINCT FROM OLD.producer_receipt_id
        ) THEN
            RAISE EXCEPTION 'MANUAL_HEAD_OBSERVATION_IMMUTABLE_DB'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND (
      NEW.head_id IS DISTINCT FROM OLD.head_id
      OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
      OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
      OR NEW.origin IS DISTINCT FROM OLD.origin
      OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
      OR NEW.producer_receipt_id IS DISTINCT FROM OLD.producer_receipt_id
    ) THEN
        RAISE EXCEPTION 'MANUAL_HEAD_TAG_IMMUTABLE_DB'
            USING ERRCODE = '23514';
    END IF;
    SELECT subject_kind INTO actual_kind
    FROM person WHERE person_id = NEW.subject_id AND status IN ('active','hidden');
    IF actual_kind IS NULL THEN
        RAISE EXCEPTION 'MANUAL_HEAD_SUBJECT_NOT_FOUND_DB'
            USING ERRCODE = '23503';
    END IF;
    IF actual_kind <> NEW.subject_kind THEN
        RAISE EXCEPTION 'MANUAL_HEAD_SUBJECT_KIND_MISMATCH_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER manual_head_observation_truth_guard
BEFORE UPDATE ON manual_head_observation
FOR EACH ROW EXECUTE FUNCTION enforce_manual_head_truth();
CREATE TRIGGER manual_head_tag_truth_guard
BEFORE INSERT OR UPDATE ON manual_head_tag
FOR EACH ROW EXECUTE FUNCTION enforce_manual_head_truth();

CREATE VIEW current_manual_head_tag AS
SELECT tag.*
FROM manual_head_tag tag
JOIN manual_head_observation head ON head.head_id = tag.head_id
WHERE tag.state = 'accepted' AND head.state = 'valid';

ALTER TABLE manual_subject_tag_command
    DROP CONSTRAINT manual_subject_tag_command_command_kind_check,
    ADD CONSTRAINT manual_subject_tag_command_command_kind_check
      CHECK (command_kind IN ('attach','undo','matching_transition','replace'));

ALTER TABLE manual_subject_tag_operation
    DROP CONSTRAINT manual_subject_tag_operation_tag_type_check,
    DROP CONSTRAINT manual_subject_tag_operation_state_check,
    DROP CONSTRAINT manual_subject_tag_operation_check,
    DROP CONSTRAINT manual_subject_tag_operation_check1,
    ADD COLUMN replaces_operation_id text
      REFERENCES manual_subject_tag_operation(operation_id),
    ADD COLUMN expected_decision_id text REFERENCES decision(decision_id),
    ADD CONSTRAINT manual_subject_tag_operation_tag_type_check
      CHECK (tag_type IN ('face','body','presence','head')),
    ADD CONSTRAINT manual_subject_tag_operation_state_check
      CHECK (state IN ('active','superseded','reverted')),
    ADD CONSTRAINT manual_subject_tag_operation_observation_check
      CHECK ((tag_type = 'presence') = (observation_id IS NULL)),
    ADD CONSTRAINT manual_subject_tag_operation_reverted_check
      CHECK ((state = 'reverted') =
        (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL)),
    ADD CONSTRAINT manual_subject_tag_operation_replacement_check
      CHECK ((replaces_operation_id IS NULL) = (expected_decision_id IS NULL));

CREATE UNIQUE INDEX manual_subject_tag_operation_one_successor
    ON manual_subject_tag_operation(replaces_operation_id)
    WHERE replaces_operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_manual_subject_tag_operation_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    replaced manual_subject_tag_operation%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND (
      NEW.operation_id IS DISTINCT FROM OLD.operation_id
      OR NEW.command_id IS DISTINCT FROM OLD.command_id
      OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
      OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
      OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
      OR NEW.tag_type IS DISTINCT FROM OLD.tag_type
      OR NEW.tag_id IS DISTINCT FROM OLD.tag_id
      OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
      OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
      OR NEW.replaces_operation_id IS DISTINCT FROM OLD.replaces_operation_id
      OR NEW.expected_decision_id IS DISTINCT FROM OLD.expected_decision_id
    ) THEN
        RAISE EXCEPTION 'MANUAL_SUBJECT_TAG_OPERATION_PROVENANCE_IMMUTABLE_DB'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.tag_type = 'head' AND NEW.state = 'active' AND NOT EXISTS (
      SELECT 1
      FROM manual_head_tag tag
      JOIN manual_head_observation head ON head.head_id = tag.head_id
      WHERE tag.head_tag_id = NEW.tag_id
        AND head.head_id = NEW.observation_id
        AND head.asset_id = NEW.asset_id
        AND tag.subject_id = NEW.subject_id
        AND tag.subject_kind = NEW.subject_kind
        AND tag.origin = 'user' AND tag.state = 'accepted'
        AND head.observation_origin = 'manual_user' AND head.state = 'valid'
    ) THEN
        RAISE EXCEPTION 'MANUAL_HEAD_OPERATION_PROVENANCE_INVALID_DB'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' AND NEW.replaces_operation_id IS NOT NULL THEN
        SELECT * INTO replaced FROM manual_subject_tag_operation
        WHERE operation_id = NEW.replaces_operation_id;
        IF replaced.operation_id IS NULL
          OR replaced.asset_id <> NEW.asset_id
          OR replaced.decision_id <> NEW.expected_decision_id
          OR replaced.state <> 'superseded'
          OR NEW.state <> 'active'
          OR NOT EXISTS (
            SELECT 1 FROM manual_subject_tag_command command
            WHERE command.command_id = NEW.command_id
              AND command.command_kind = 'replace'
          )
        THEN
            RAISE EXCEPTION 'MANUAL_SUBJECT_TAG_REPLACEMENT_PROVENANCE_INVALID_DB'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER manual_subject_tag_operation_v2_guard
BEFORE INSERT OR UPDATE ON manual_subject_tag_operation
FOR EACH ROW EXECUTE FUNCTION enforce_manual_subject_tag_operation_v2();

CREATE OR REPLACE VIEW current_manual_face_matching_evidence AS
SELECT lifecycle.lifecycle_id, lifecycle.operation_id,
  lifecycle.identity_claim_id, lifecycle.face_id, lifecycle.scope_key,
  lifecycle.provider_id, lifecycle.model_family, lifecycle.model_version,
  lifecycle.config_digest, lifecycle.vector_space_id, lifecycle.embedding_id,
  lifecycle.vector_digest, lifecycle.evidence_digest, lifecycle.evidence_tier,
  lifecycle.rebuild_request_id, lifecycle.recognition_evidence_id,
  evidence.request_id, evidence.replay_digest, evidence.result_digest,
  evidence.source_content_digest, evidence.measurement_digest,
  evidence.policy_digest, quality.quality_score,
  request.input_revision, request.region_digest
FROM current_manual_face_matching_lifecycle lifecycle
JOIN manual_face_recognition_evidence evidence
  ON evidence.evidence_id = lifecycle.recognition_evidence_id
JOIN manual_face_recognition_request request
  ON request.request_id = evidence.request_id
JOIN manual_face_recognition_quality quality
  ON quality.quality_id = evidence.quality_id
JOIN manual_subject_tag_operation operation
  ON operation.operation_id = lifecycle.operation_id
  AND operation.state = 'active' AND operation.tag_type = 'face'
JOIN identity_claim claim
  ON claim.identity_claim_id = lifecycle.identity_claim_id
  AND claim.state = 'accepted' AND claim.origin = 'user'
JOIN face_observation face
  ON face.face_id = lifecycle.face_id
  AND face.state = 'valid' AND face.observation_origin = 'manual_user'
JOIN immich_asset_projection projection
  ON projection.cimmich_asset_id = operation.asset_id
  AND projection.source_id = request.source_id
  AND projection.immich_asset_id = request.immich_asset_id
  AND projection.input_revision = request.input_revision
  AND projection.state = 'active'
WHERE lifecycle.state = 'eligible_for_evaluation'
  AND operation.tag_id = claim.identity_claim_id
  AND operation.observation_id = face.face_id
  AND claim.face_id = face.face_id;

CREATE OR REPLACE VIEW asset_people AS
SELECT face.asset_id, identity.person_id,
       CASE WHEN gallery.face_id IS NULL THEN 'face'::text ELSE 'head'::text END
         AS association_type,
       identity.state AS authority_state, face.face_id AS geometry_id
FROM current_face_identity identity
JOIN face_observation face ON face.face_id = identity.face_id
LEFT JOIN LATERAL (
    SELECT head.face_id FROM current_reference_gallery head
    WHERE head.person_id = identity.person_id AND head.face_id = identity.face_id
      AND head.bucket_kind = 'head' AND head.membership_state = 'active'
    LIMIT 1
) gallery ON true
UNION ALL
SELECT body.asset_id, tag.person_id,
       CASE WHEN tag.origin = 'face_body_linkage' AND tag.supporting_face_id IS NOT NULL
         THEN 'body_link'::text ELSE 'body'::text END,
       tag.state, body.body_id
FROM current_body_tag tag
JOIN body_observation body ON body.body_id = tag.body_id
UNION ALL
SELECT presence.asset_id, presence.person_id,
       CASE WHEN presence.reason_code = 'head_evidence'
         THEN 'head'::text ELSE 'presence'::text END,
       presence.state, NULL::text
FROM current_presence_tag presence
UNION ALL
SELECT head.asset_id, tag.subject_id, 'head'::text,
       tag.state, head.head_id
FROM current_manual_head_tag tag
JOIN manual_head_observation head ON head.head_id = tag.head_id;

CREATE OR REPLACE VIEW person_assets AS
SELECT person_id, asset_id, association_type, authority_state, geometry_id
FROM asset_people;

COMMIT;
