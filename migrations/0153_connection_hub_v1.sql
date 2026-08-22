BEGIN;

-- A Place can already be a home or workplace. Organisation and group extend
-- the existing Thing vocabulary so employers and social groups do not need to
-- masquerade as Places or Events.
ALTER TABLE context_entity DROP CONSTRAINT context_entity_object_kind_check;
ALTER TABLE context_entity ADD CONSTRAINT context_entity_object_kind_check CHECK (
  object_kind IS NULL OR object_kind IN (
    'vehicle','property','device','collectible','equipment','organisation','group','other'
  )
);

ALTER TABLE connection_type DROP CONSTRAINT connection_type_target_kind_check;
ALTER TABLE connection_type ADD CONSTRAINT connection_type_target_kind_check
  CHECK (target_kind IN ('person','place','object'));

ALTER TABLE connection_fact_event DROP CONSTRAINT connection_fact_event_target_kind_check;
ALTER TABLE connection_fact_event ADD CONSTRAINT connection_fact_event_target_kind_check
  CHECK (target_kind IN ('person','place','object'));

INSERT INTO connection_type (
  type_id, slug, label, past_label, inverse_label, inverse_past_label,
  source_kind, target_kind, is_symmetric, temporal_mode, semantic_kind, is_system_seed
) VALUES
  ('connectiontype_works_for', 'works_for', 'Works for', 'Worked for',
    'Employs', 'Employed', 'person', 'object', false,
    'current_or_past', 'works_for', true),
  ('connectiontype_member_of', 'member_of', 'Member', 'Former member',
    'Member', 'Former member', 'person', 'object', false,
    'current_or_past', 'member_of', true),
  ('connectiontype_leads', 'leads', 'Leads', 'Led',
    'Led by', 'Led by', 'person', 'object', false,
    'current_or_past', 'leads', true);

CREATE TABLE connection_hub_command (
  command_id text PRIMARY KEY CHECK (
    command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
  ),
  actor_id text NOT NULL CHECK (
    actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
  ),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  hub_kind text NOT NULL CHECK (hub_kind IN ('home','employer','group')),
  hub_entity_id text NOT NULL REFERENCES context_entity(entity_id),
  created_hub boolean NOT NULL,
  response jsonb NOT NULL,
  privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enforce_connection_fact_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type connection_type%ROWTYPE;
  v_target_kind text;
BEGIN
  SELECT * INTO v_type FROM connection_type WHERE type_id = NEW.type_id AND state = 'active';
  IF v_type.type_id IS NULL OR v_type.source_kind <> NEW.source_kind OR v_type.target_kind <> NEW.target_kind THEN
    RAISE EXCEPTION 'Connection type does not match its endpoints' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM person WHERE person_id = NEW.source_id
      AND subject_kind = 'person' AND status IN ('active','hidden')) THEN
    RAISE EXCEPTION 'Connection fact requires a current Person source' USING ERRCODE = '23514';
  END IF;
  IF NEW.target_kind = 'person' THEN
    SELECT subject_kind INTO v_target_kind FROM person WHERE person_id = NEW.target_id
      AND subject_kind = 'person' AND status IN ('active','hidden');
  ELSE
    SELECT entity_kind INTO v_target_kind FROM context_entity WHERE entity_id = NEW.target_id
      AND entity_kind = NEW.target_kind AND status IN ('active','hidden');
  END IF;
  IF v_target_kind IS DISTINCT FROM NEW.target_kind THEN
    RAISE EXCEPTION 'Connection fact target does not match its declared kind' USING ERRCODE = '23514';
  END IF;
  IF (v_type.temporal_mode = 'none' AND NEW.validity <> 'timeless')
     OR (v_type.temporal_mode = 'current_or_past' AND NEW.validity = 'timeless') THEN
    RAISE EXCEPTION 'Connection validity does not match its type' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM connection_fact_event previous
    WHERE previous.event_id = NEW.supersedes_event_id AND previous.fact_id = NEW.fact_id
  ) THEN
    RAISE EXCEPTION 'Connection fact supersession crossed facts' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, privacy_class
) VALUES (
  'receipt_cimmich_connection_hub_v1', 'system',
  'cimmich-connection-hub', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

COMMIT;
