BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_possible_people_known_person_v1', 'system',
    'cimmich-possible-people-known-person-bridge', 'v1', now(), now(),
    encode(digest('cimmich.possible-people-known-person.v1', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE possible_person_run
    ADD COLUMN classification_state text NOT NULL DEFAULT 'pending'
      CHECK (classification_state IN ('pending','running','completed','failed')),
    ADD COLUMN classification_version text,
    ADD COLUMN classified_cluster_count integer NOT NULL DEFAULT 0
      CHECK (classified_cluster_count >= 0),
    ADD COLUMN classification_started_at timestamptz,
    ADD COLUMN classification_completed_at timestamptz,
    ADD COLUMN classification_error_code text,
    ADD COLUMN classification_error_message text;

ALTER TABLE face_cluster
    ADD COLUMN suggested_person_id text REFERENCES person(person_id) ON DELETE SET NULL,
    ADD COLUMN suggestion_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN classification_version text,
    ADD COLUMN classified_at timestamptz;

CREATE INDEX face_cluster_possible_person_suggestion
    ON face_cluster(possible_person_run_id, suggested_person_id, status)
    WHERE possible_person_run_id IS NOT NULL AND suggested_person_id IS NOT NULL;

ALTER TABLE possible_person_command
    DROP CONSTRAINT possible_person_command_command_kind_check;
ALTER TABLE possible_person_command
    ADD CONSTRAINT possible_person_command_command_kind_check
    CHECK (command_kind IN ('classify','refresh','resolve','undo'));

COMMIT;
