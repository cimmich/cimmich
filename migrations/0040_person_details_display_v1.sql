BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_person_details_display_v1', 'system',
    'cimmich-person-details-display', 'v1', now(), now(),
    encode(digest('cimmich-person-details-display-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Details presentation is intentionally independent from Person Profile truth
-- and from the existing Hero display contract. Hiding a section never deletes
-- a profile value or stable item.
CREATE TABLE person_details_display_default (
    owner_id text NOT NULL REFERENCES person_profile_display_owner(owner_id) ON DELETE CASCADE,
    section_key text NOT NULL CHECK (section_key IN (
        'about','at_a_glance','identity_summary','important_dates','work',
        'contact_details','social','address','private_notes'
    )),
    display_order integer NOT NULL CHECK (display_order BETWEEN 0 AND 8),
    is_visible boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, section_key),
    UNIQUE (owner_id, display_order)
);

INSERT INTO person_details_display_default (
    owner_id, section_key, display_order, is_visible
) VALUES
    ('local-primary', 'about', 0, true),
    ('local-primary', 'at_a_glance', 1, true),
    ('local-primary', 'identity_summary', 2, true),
    ('local-primary', 'important_dates', 3, true),
    ('local-primary', 'work', 4, true),
    ('local-primary', 'contact_details', 5, true),
    ('local-primary', 'social', 6, true),
    ('local-primary', 'address', 7, true),
    ('local-primary', 'private_notes', 8, true);

CREATE TABLE person_details_display_override (
    owner_id text NOT NULL REFERENCES person_profile_display_owner(owner_id) ON DELETE CASCADE,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    section_key text NOT NULL CHECK (section_key IN (
        'about','at_a_glance','identity_summary','important_dates','work',
        'contact_details','social','address','private_notes'
    )),
    visibility text NOT NULL CHECK (visibility IN ('inherit','show','hide')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, person_id, section_key)
);

CREATE TRIGGER person_details_display_override_human_subject
BEFORE INSERT OR UPDATE OF person_id ON person_details_display_override
FOR EACH ROW EXECUTE FUNCTION enforce_person_profile_human_subject();

CREATE TABLE person_details_display_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    command_kind text NOT NULL CHECK (command_kind IN (
        'details_defaults_patch','person_details_patch'
    )),
    actor_id text NOT NULL CHECK (
        actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    person_id text REFERENCES person(person_id) ON DELETE CASCADE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX person_details_display_command_person_recent
    ON person_details_display_command(person_id, created_at DESC, command_id DESC)
    WHERE person_id IS NOT NULL;

COMMIT;
