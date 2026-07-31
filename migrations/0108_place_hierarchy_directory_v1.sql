BEGIN;

ALTER TABLE context_entity
  ADD COLUMN directory_visibility text NOT NULL DEFAULT 'listed';

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_directory_visibility_check
  CHECK (directory_visibility IN ('listed','nested_only'));

ALTER TABLE context_entity
  ADD CONSTRAINT context_entity_directory_visibility_scope
  CHECK (entity_kind = 'place' OR directory_visibility = 'listed');

CREATE INDEX context_entity_place_directory
  ON context_entity (directory_visibility, lower(display_name), entity_id)
  WHERE entity_kind = 'place' AND status = 'active';

-- A child cannot be less private than any ancestor. Replacing the existing
-- rank helper applies that rule uniformly to collections, search, selectors,
-- documents and detail projections without inventing a second visibility law.
CREATE OR REPLACE FUNCTION cimmich_visibility_context_entity_rank(
  p_entity_id text
) RETURNS integer LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH RECURSIVE lineage(entity_id, parent_entity_id, path) AS (
    SELECT entity.entity_id, entity.parent_entity_id, ARRAY[entity.entity_id]
    FROM context_entity entity WHERE entity.entity_id = p_entity_id
    UNION ALL
    SELECT parent.entity_id, parent.parent_entity_id,
      child.path || parent.entity_id
    FROM context_entity parent
    JOIN lineage child ON parent.entity_id = child.parent_entity_id
    WHERE NOT parent.entity_id = ANY(child.path)
      AND cardinality(child.path) < 64
  )
  SELECT coalesce(max(CASE coalesce(visibility.visibility_tier, 'standard')
    WHEN 'standard' THEN 0
    WHEN 'personal' THEN 1
    WHEN 'private' THEN 2
  END), 0)::integer
  FROM lineage
  LEFT JOIN cimmich_visibility_object visibility
    ON visibility.object_scope = 'context_entity'
    AND visibility.object_id = lineage.entity_id;
$$;

ALTER TABLE context_command
  DROP CONSTRAINT context_command_command_kind_check;
ALTER TABLE context_command
  ADD CONSTRAINT context_command_command_kind_check
  CHECK (command_kind IN (
    'create','update','asset_attach','asset_detach',
    'relation_attach','relation_detach','undo','delete','cover_set',
    'place_assignment'
  ));

ALTER TABLE context_operation
  DROP CONSTRAINT context_operation_operation_scope_check;
ALTER TABLE context_operation
  ADD CONSTRAINT context_operation_operation_scope_check
  CHECK (operation_scope IN ('asset','relation','cover','entity','place_assignment'));

ALTER TABLE context_operation
  DROP CONSTRAINT context_operation_action_check;
ALTER TABLE context_operation
  ADD CONSTRAINT context_operation_action_check
  CHECK (action IN ('attach','detach','set','create','update','assign'));

COMMIT;
