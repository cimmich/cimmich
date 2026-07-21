BEGIN;

ALTER TABLE context_operation
  DROP CONSTRAINT context_operation_operation_scope_check;
ALTER TABLE context_operation
  ADD CONSTRAINT context_operation_operation_scope_check
  CHECK (operation_scope IN ('asset','relation','cover','entity'));

ALTER TABLE context_operation
  DROP CONSTRAINT context_operation_action_check;
ALTER TABLE context_operation
  ADD CONSTRAINT context_operation_action_check
  CHECK (action IN ('attach','detach','set','create','update'));

COMMIT;
