BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_place_delete_v1', 'system', 'cimmich-place-delete', 'v1',
    now(), now(), encode(digest('cimmich-place-delete-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

ALTER TABLE context_entity DROP CONSTRAINT context_entity_status_check;
ALTER TABLE context_entity ADD CONSTRAINT context_entity_status_check
  CHECK (status IN ('active','hidden','archived','deleted'));

ALTER TABLE context_command DROP CONSTRAINT context_command_command_kind_check;
ALTER TABLE context_command ADD CONSTRAINT context_command_command_kind_check
  CHECK (command_kind IN (
    'create','update','asset_attach','asset_detach',
    'relation_attach','relation_detach','undo','delete'
  ));

ALTER TABLE decision DROP CONSTRAINT decision_action_check;
ALTER TABLE decision ADD CONSTRAINT decision_action_check
  CHECK (action IN (
    'accept','reject','merge','split','rename','promote','demote','pin','ban',
    'ignore','restore','classify','create','update','attach','detach','archive',
    'undo','delete'
  ));

CREATE TABLE context_entity_deletion (
    deletion_id text PRIMARY KEY
      CHECK (deletion_id ~ '^contextdelete_[0-9a-f]{32}$'),
    entity_id text NOT NULL UNIQUE REFERENCES context_entity(entity_id),
    command_id text NOT NULL UNIQUE REFERENCES context_command(command_id),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    actor_id text NOT NULL CHECK (
      actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    display_name text NOT NULL CHECK (
      display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 160
    ),
    delete_tags boolean NOT NULL,
    previous_revision bigint NOT NULL CHECK (previous_revision > 0),
    deleted_revision bigint NOT NULL CHECK (deleted_revision = previous_revision + 1),
    deleted_tag_count integer NOT NULL CHECK (deleted_tag_count >= 0),
    retained_tag_count integer NOT NULL CHECK (retained_tag_count >= 0),
    affected_child_count integer NOT NULL CHECK (affected_child_count >= 0),
    affected_relation_count integer NOT NULL CHECK (affected_relation_count >= 0),
    affected_document_count integer NOT NULL CHECK (affected_document_count >= 0),
    visibility_asset_ids jsonb NOT NULL CHECK (
      jsonb_typeof(visibility_asset_ids) = 'array'
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    CHECK (
      (delete_tags AND retained_tag_count = 0)
      OR (NOT delete_tags AND deleted_tag_count = 0)
    )
);

CREATE FUNCTION prevent_context_entity_deleted_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'deleted' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Deleted context entities are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_entity_deleted_immutable
BEFORE UPDATE ON context_entity
FOR EACH ROW EXECUTE FUNCTION prevent_context_entity_deleted_mutation();

CREATE OR REPLACE FUNCTION enforce_context_entity_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_parent_kind text;
  v_parent_status text;
  v_cursor text;
  v_depth integer := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','hidden')
     AND NEW.status = 'archived' AND EXISTS (
       SELECT 1 FROM context_entity child
       WHERE child.parent_entity_id = NEW.entity_id
         AND child.status IN ('active','hidden')
     ) THEN
    RAISE EXCEPTION 'Current child entities must be moved or archived first'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_entity_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_entity_id = NEW.entity_id THEN
    RAISE EXCEPTION 'Context entity cannot parent itself' USING ERRCODE = '23514';
  END IF;
  SELECT entity_kind, status INTO v_parent_kind, v_parent_status
  FROM context_entity WHERE entity_id = NEW.parent_entity_id;
  IF v_parent_kind IS DISTINCT FROM NEW.entity_kind
     OR NEW.entity_kind NOT IN ('place','event')
     OR v_parent_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Context parent must be a current same-kind Place or Event'
      USING ERRCODE = '23514';
  END IF;
  v_cursor := NEW.parent_entity_id;
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = NEW.entity_id THEN
      RAISE EXCEPTION 'Context parent hierarchy cannot contain a cycle'
        USING ERRCODE = '23514';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > 1000 THEN
      RAISE EXCEPTION 'Context parent hierarchy exceeds the supported depth'
        USING ERRCODE = '54001';
    END IF;
    SELECT parent_entity_id INTO v_cursor FROM context_entity WHERE entity_id = v_cursor;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_cimmich_document_link_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_subject_kind text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM cimmich_document
        WHERE document_id = NEW.document_id AND status IN ('active','archived')
    ) THEN
        RAISE EXCEPTION 'DOCUMENT_NOT_FOUND_DB' USING ERRCODE = '23503';
    END IF;
    IF NEW.subject_kind IN ('person','pet') THEN
        SELECT subject_kind INTO v_subject_kind FROM person
        WHERE person_id = NEW.subject_id AND status IN ('active','hidden');
    ELSE
        SELECT entity_kind INTO v_subject_kind FROM context_entity
        WHERE entity_id = NEW.subject_id AND status IN ('active','hidden');
    END IF;
    IF v_subject_kind IS DISTINCT FROM NEW.subject_kind THEN
        RAISE EXCEPTION 'DOCUMENT_SUBJECT_KIND_MISMATCH_DB' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
