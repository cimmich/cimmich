BEGIN;

CREATE TABLE immich_companion_owner (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    principal_id text NOT NULL CHECK (
      char_length(btrim(principal_id)) BETWEEN 1 AND 200
      AND principal_id = btrim(principal_id)
    ),
    bound_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

INSERT INTO immich_companion_owner (principal_id, bound_at)
SELECT principal_id, completed_at
FROM immich_companion_connection_command
ORDER BY completed_at DESC, command_id DESC
LIMIT 1
ON CONFLICT (singleton) DO NOTHING;

COMMENT ON TABLE immich_companion_owner IS
  'The one Immich principal authorized to access this single-owner Cimmich state. Credentials may rotate without transferring ownership.';

COMMIT;
