BEGIN;

ALTER TABLE person
  ADD COLUMN subject_kind text NOT NULL DEFAULT 'person';

ALTER TABLE person
  ADD CONSTRAINT person_subject_kind_check
  CHECK (subject_kind IN ('person', 'pet'));

ALTER TABLE person_alias
  ADD COLUMN source_system text,
  ADD COLUMN source_subject_id text;

CREATE UNIQUE INDEX person_alias_one_active_label
  ON person_alias(person_id, lower(label))
  WHERE state = 'active';

CREATE TABLE person_merge_operation (
  merge_operation_id text PRIMARY KEY,
  source_person_id text NOT NULL REFERENCES person(person_id),
  target_person_id text NOT NULL REFERENCES person(person_id),
  state text NOT NULL CHECK (state IN ('active', 'reverted')),
  snapshot jsonb NOT NULL,
  merge_decision_id text NOT NULL REFERENCES decision(decision_id),
  unmerge_decision_id text REFERENCES decision(decision_id),
  producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
  privacy_class text NOT NULL DEFAULT 'private',
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  CHECK (source_person_id <> target_person_id),
  CHECK ((state = 'reverted') = (unmerge_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE UNIQUE INDEX person_merge_one_active_source
  ON person_merge_operation(source_person_id)
  WHERE state = 'active';

CREATE INDEX person_merge_target_lookup
  ON person_merge_operation(target_person_id, state, created_at DESC);

ALTER TABLE decision DROP CONSTRAINT decision_action_check;
ALTER TABLE decision
  ADD CONSTRAINT decision_action_check
  CHECK (action IN (
    'accept','reject','merge','split','rename','promote','demote','pin','ban','ignore','restore','classify'
  ));

CREATE OR REPLACE VIEW current_person AS
SELECT p.person_id, p.display_name, p.status, p.current_revision,
       COALESCE(array_agg(pa.label ORDER BY pa.created_at) FILTER (WHERE pa.state = 'active'), ARRAY[]::text[]) AS aliases,
       p.subject_kind, p.merged_into_person_id
FROM person p
LEFT JOIN person_alias pa ON pa.person_id = p.person_id
WHERE p.status IN ('active','hidden')
GROUP BY p.person_id;

COMMIT;
