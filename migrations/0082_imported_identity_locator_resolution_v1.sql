BEGIN;

ALTER TABLE imported_identity_locator
  ADD COLUMN resolution_kind text
    CHECK (resolution_kind IN ('stronger_existing_truth', 'owner_typed_tag')),
  ADD COLUMN resolution_decision_id text REFERENCES decision(decision_id),
  ADD COLUMN resolved_subject_id text REFERENCES person(person_id),
  ADD COLUMN resolved_tag_type text
    CHECK (resolved_tag_type IN ('face', 'body', 'head', 'presence')),
  ADD COLUMN resolved_tag_id text;

UPDATE imported_identity_locator
SET resolution_kind = 'stronger_existing_truth'
WHERE state = 'resolved';

ALTER TABLE imported_identity_locator
  ADD CONSTRAINT imported_identity_locator_resolution_check CHECK (
    (
      state IN ('unresolved', 'ignored')
      AND resolution_kind IS NULL
      AND resolution_decision_id IS NULL
      AND resolved_subject_id IS NULL
      AND resolved_tag_type IS NULL
      AND resolved_tag_id IS NULL
    )
    OR (
      state = 'resolved'
      AND resolution_kind = 'stronger_existing_truth'
      AND resolution_decision_id IS NULL
      AND resolved_subject_id IS NULL
      AND resolved_tag_type IS NULL
      AND resolved_tag_id IS NULL
    )
    OR (
      state = 'resolved'
      AND resolution_kind = 'owner_typed_tag'
      AND resolution_decision_id IS NOT NULL
      AND resolved_subject_id IS NOT NULL
      AND resolved_tag_type IS NOT NULL
      AND resolved_tag_id IS NOT NULL
    )
  );

COMMENT ON COLUMN imported_identity_locator.resolution_kind
IS 'Why the imported locator no longer needs owner placement; owner_typed_tag is always bound to the resulting decision and typed tag.';

COMMIT;
