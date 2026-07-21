BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_enhanced_component_v1', 'system',
    'cimmich-enhanced-component', 'v1', now(), now(),
    encode(digest('cimmich.enhanced-component.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE enhanced_component_release (
    release_id text PRIMARY KEY CHECK (release_id ~ '^enhanced_release_[0-9a-f]{64}$'),
    component_version text NOT NULL CHECK (
      component_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    ),
    interface_version text NOT NULL CHECK (
      interface_version = 'cimmich.core-enhanced.v1'
    ),
    artifact_digest text NOT NULL UNIQUE CHECK (artifact_digest ~ '^[0-9a-f]{64}$'),
    matcher_policy_version text NOT NULL CHECK (
      matcher_policy_version = 'cimmich-best-prime-v1'
    ),
    scorer text NOT NULL CHECK (scorer = 'best_individual_prime'),
    state text NOT NULL CHECK (state IN ('installed','superseded')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    installed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (component_version, artifact_digest)
);

CREATE TABLE enhanced_component_head (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled boolean NOT NULL DEFAULT false,
    active_release_id text REFERENCES enhanced_component_release(release_id),
    previous_release_id text REFERENCES enhanced_component_release(release_id),
    current_revision bigint NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (enabled = (active_release_id IS NOT NULL)),
    CHECK (
      previous_release_id IS NULL
      OR active_release_id IS DISTINCT FROM previous_release_id
    )
);

INSERT INTO enhanced_component_head (singleton) VALUES (true);

CREATE TABLE enhanced_component_command (
    command_id text PRIMARY KEY CHECK (
      command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (
      actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    action text NOT NULL CHECK (action IN ('enable','disable','update','rollback')),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    completed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
