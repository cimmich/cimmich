BEGIN;

-- One command identifier is authority for exactly one actor, operation and
-- canonical request. The pending row and domain mutation share a transaction,
-- so a concurrent claimant blocks until it can replay the committed response.
CREATE TABLE connection_command_ledger (
    command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 8 AND 120),
    operation text NOT NULL CHECK (operation ~ '^connection\.[a-z_]{3,40}$'),
    actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 120),
    request_digest text CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    request_payload jsonb,
    state text NOT NULL CHECK (state IN ('legacy','pending','complete')),
    response_body jsonb,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK (
      (state = 'legacy' AND request_digest IS NULL AND request_payload IS NULL
        AND response_body IS NULL AND completed_at IS NOT NULL)
      OR (state = 'pending' AND request_digest IS NOT NULL AND request_payload IS NOT NULL
        AND response_body IS NULL AND completed_at IS NULL)
      OR (state = 'complete' AND request_digest IS NOT NULL AND request_payload IS NOT NULL
        AND response_body IS NOT NULL AND completed_at IS NOT NULL)
    )
);

-- Pre-ledger commands cannot be reconstructed byte-for-byte. Occupy them as
-- legacy identifiers so the new service fails closed instead of duplicating a
-- historical write or falsely authorizing a different payload.
INSERT INTO connection_command_ledger (
    command_id, operation, actor_id, state, completed_at
)
SELECT command_id, 'connection.legacy_occupied', 'migration', 'legacy', now()
FROM (
    SELECT command_id FROM connection_type WHERE command_id IS NOT NULL
    UNION
    SELECT command_id FROM connection_modifier WHERE command_id IS NOT NULL
    UNION
    SELECT command_id FROM connection_fact_event
    UNION
    SELECT command_id FROM connection_suggestion_decision
) occupied;

CREATE FUNCTION reject_connection_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Connection event history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER connection_fact_event_append_only
BEFORE UPDATE OR DELETE ON connection_fact_event
FOR EACH ROW EXECUTE FUNCTION reject_connection_event_mutation();
CREATE TRIGGER connection_fact_event_no_truncate
BEFORE TRUNCATE ON connection_fact_event
FOR EACH STATEMENT EXECUTE FUNCTION reject_connection_event_mutation();

CREATE TRIGGER connection_fact_event_modifier_append_only
BEFORE UPDATE OR DELETE ON connection_fact_event_modifier
FOR EACH ROW EXECUTE FUNCTION reject_connection_event_mutation();
CREATE TRIGGER connection_fact_event_modifier_no_truncate
BEFORE TRUNCATE ON connection_fact_event_modifier
FOR EACH STATEMENT EXECUTE FUNCTION reject_connection_event_mutation();

CREATE TRIGGER connection_fact_context_event_append_only
BEFORE UPDATE OR DELETE ON connection_fact_context_event
FOR EACH ROW EXECUTE FUNCTION reject_connection_event_mutation();
CREATE TRIGGER connection_fact_context_event_no_truncate
BEFORE TRUNCATE ON connection_fact_context_event
FOR EACH STATEMENT EXECUTE FUNCTION reject_connection_event_mutation();

CREATE TRIGGER connection_suggestion_decision_append_only
BEFORE UPDATE OR DELETE ON connection_suggestion_decision
FOR EACH ROW EXECUTE FUNCTION reject_connection_event_mutation();
CREATE TRIGGER connection_suggestion_decision_no_truncate
BEFORE TRUNCATE ON connection_suggestion_decision
FOR EACH STATEMENT EXECUTE FUNCTION reject_connection_event_mutation();

CREATE FUNCTION reject_connection_command_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'pending'
     OR NEW.command_id <> OLD.command_id
     OR NEW.operation <> OLD.operation
     OR NEW.actor_id <> OLD.actor_id
     OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
     OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
     OR NEW.privacy_class <> OLD.privacy_class
     OR NEW.created_at <> OLD.created_at
     OR NEW.state <> 'complete'
     OR NEW.response_body IS NULL
     OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Connection command ledger is immutable after claim'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connection_command_ledger_update_guard
BEFORE UPDATE ON connection_command_ledger
FOR EACH ROW EXECUTE FUNCTION reject_connection_command_ledger_mutation();

CREATE TRIGGER connection_command_ledger_delete_guard
BEFORE DELETE ON connection_command_ledger
FOR EACH ROW EXECUTE FUNCTION reject_connection_event_mutation();
CREATE TRIGGER connection_command_ledger_no_truncate
BEFORE TRUNCATE ON connection_command_ledger
FOR EACH STATEMENT EXECUTE FUNCTION reject_connection_event_mutation();

-- A process-local active-run guard is insufficient when two API replicas or
-- operator invocations share the same database. This database boundary makes
-- one queued/running backup the durable global lock.
CREATE UNIQUE INDEX cimmich_database_backup_single_active
ON cimmich_database_backup_run ((1))
WHERE state IN ('queued','running');

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_connection_command_ledger_append_only_v1', 'system',
    'cimmich-connection-command-ledger-append-only', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
    SET completed_at = excluded.completed_at;

COMMIT;
