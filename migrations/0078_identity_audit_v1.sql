BEGIN;

CREATE TABLE identity_audit_run (
  audit_run_id text PRIMARY KEY,
  pack_id text NOT NULL REFERENCES source_pack(pack_id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  score_floor double precision NOT NULL CHECK (score_floor BETWEEN 0 AND 1),
  margin_floor double precision NOT NULL CHECK (margin_floor BETWEEN 0 AND 1),
  state text NOT NULL CHECK (state IN ('running','completed','failed')),
  untagged_embedded_faces integer NOT NULL DEFAULT 0 CHECK (untagged_embedded_faces >= 0),
  accepted_embedded_faces integer NOT NULL DEFAULT 0 CHECK (accepted_embedded_faces >= 0),
  accepted_comparable_faces integer NOT NULL DEFAULT 0 CHECK (accepted_comparable_faces >= 0),
  untagged_candidates integer NOT NULL DEFAULT 0 CHECK (untagged_candidates >= 0),
  contradiction_candidates integer NOT NULL DEFAULT 0 CHECK (contradiction_candidates >= 0),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
  CHECK (
    (state = 'running' AND completed_at IS NULL AND error_code IS NULL)
    OR (state = 'completed' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (state = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX identity_audit_one_running
  ON identity_audit_run ((true))
  WHERE state = 'running';

CREATE INDEX identity_audit_run_latest
  ON identity_audit_run (started_at DESC, audit_run_id DESC);

CREATE TABLE identity_audit_item (
  audit_run_id text NOT NULL REFERENCES identity_audit_run(audit_run_id) ON DELETE CASCADE,
  audit_kind text NOT NULL CHECK (audit_kind IN ('untagged_match','accepted_contradiction')),
  face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
  assigned_person_id text REFERENCES person(person_id) ON DELETE CASCADE,
  suggested_person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  suggested_score double precision NOT NULL CHECK (suggested_score BETWEEN -1 AND 1),
  comparison_score double precision CHECK (comparison_score IS NULL OR comparison_score BETWEEN -1 AND 1),
  margin double precision NOT NULL CHECK (margin >= 0 AND margin <= 2),
  review_state text NOT NULL DEFAULT 'open' CHECK (review_state IN ('open','dismissed')),
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
  PRIMARY KEY (audit_run_id, audit_kind, face_id),
  CHECK (
    (audit_kind = 'untagged_match' AND assigned_person_id IS NULL)
    OR
    (audit_kind = 'accepted_contradiction' AND assigned_person_id IS NOT NULL
      AND assigned_person_id <> suggested_person_id
      AND comparison_score IS NOT NULL)
  ),
  CHECK (
    (review_state = 'open' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR
    (review_state = 'dismissed' AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX identity_audit_item_queue
  ON identity_audit_item (
    audit_run_id, audit_kind, suggested_score DESC, margin DESC, face_id
  );

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_identity_audit_v1', 'system',
  'cimmich-identity-audit', 'v1', now(), now(),
  encode(digest('cimmich.identity-audit.v1', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
