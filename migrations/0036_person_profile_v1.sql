BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_person_profile_v1', 'system',
    'cimmich-person-profile', 'v1', now(), now(),
    encode(digest('cimmich-person-profile-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Complete the relationship catalogue already presented by the People UI.
-- These remain ordinary relationship categories and reuse the existing
-- append-only membership event lifecycle.
INSERT INTO person_category (
    category_id, slug, name, category_kind, sort_order, state,
    is_system_seed, producer_receipt_id, privacy_class
) VALUES
    ('category_acquaintances', 'acquaintances', 'Acquaintances', 'relationship', 50,
     'active', true, 'receipt_cimmich_person_profile_v1', 'private'),
    ('category_others', 'others', 'Others', 'relationship', 60,
     'active', true, 'receipt_cimmich_person_profile_v1', 'private')
ON CONFLICT (category_id) DO NOTHING;

CREATE TABLE person_profile (
    person_id text PRIMARY KEY REFERENCES person(person_id) ON DELETE CASCADE,
    about text,
    gender_identity_kind text CHECK (
        gender_identity_kind IS NULL OR gender_identity_kind IN (
            'woman','man','non_binary','self_described'
        )
    ),
    gender_identity_label text,
    pronouns_label text,
    private_notes text,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    privacy_class text NOT NULL DEFAULT 'sensitive-profile',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT person_profile_about_shape CHECK (
        about IS NULL OR (
            about = btrim(about) AND length(about) BETWEEN 1 AND 4000
        )
    ),
    CONSTRAINT person_profile_gender_pair CHECK (
        (gender_identity_kind IS NULL AND gender_identity_label IS NULL)
        OR (
            gender_identity_kind = 'self_described'
            AND gender_identity_label = btrim(gender_identity_label)
            AND length(gender_identity_label) BETWEEN 1 AND 120
        )
        OR (
            gender_identity_kind IN ('woman','man','non_binary')
            AND gender_identity_label IS NULL
        )
    ),
    CONSTRAINT person_profile_pronouns_shape CHECK (
        pronouns_label IS NULL OR (
            pronouns_label = btrim(pronouns_label)
            AND length(pronouns_label) BETWEEN 1 AND 80
        )
    ),
    CONSTRAINT person_profile_private_notes_shape CHECK (
        private_notes IS NULL OR (
            private_notes = btrim(private_notes)
            AND length(private_notes) BETWEEN 1 AND 10000
        )
    )
);

CREATE FUNCTION enforce_person_profile_human_subject()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_subject_kind text;
  v_status text;
BEGIN
  SELECT subject_kind, status INTO v_subject_kind, v_status
  FROM person WHERE person_id = NEW.person_id;
  IF v_subject_kind IS DISTINCT FROM 'person'
     OR v_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Person Profile requires an active or hidden human Person'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_profile_human_subject
BEFORE INSERT OR UPDATE OF person_id ON person_profile
FOR EACH ROW EXECUTE FUNCTION enforce_person_profile_human_subject();

CREATE TABLE person_profile_item (
    item_id text PRIMARY KEY CHECK (item_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    person_id text NOT NULL REFERENCES person_profile(person_id) ON DELETE CASCADE,
    item_kind text NOT NULL CHECK (item_kind IN (
        'important_date','work','email','phone','web','social','address','custom'
    )),
    label text NOT NULL CHECK (
        label = btrim(label) AND length(label) BETWEEN 1 AND 80
    ),
    value_text text,
    secondary_value_text text,
    date_value date,
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','removed')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    privacy_class text NOT NULL DEFAULT 'sensitive-profile',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz,
    CONSTRAINT person_profile_item_value_shape CHECK (
        (
            item_kind = 'important_date'
            AND date_value IS NOT NULL
            AND value_text IS NULL
            AND secondary_value_text IS NULL
        )
        OR (
            item_kind = 'work'
            AND date_value IS NULL
            AND value_text = btrim(value_text)
            AND length(value_text) BETWEEN 1 AND 500
            AND (
                secondary_value_text IS NULL OR (
                    secondary_value_text = btrim(secondary_value_text)
                    AND length(secondary_value_text) BETWEEN 1 AND 500
                )
            )
        )
        OR (
            item_kind IN ('email','phone','web','social','address','custom')
            AND date_value IS NULL
            AND value_text = btrim(value_text)
            AND length(value_text) BETWEEN 1 AND 2000
            AND secondary_value_text IS NULL
        )
    ),
    CONSTRAINT person_profile_item_removal_shape CHECK (
        (state = 'active' AND removed_at IS NULL)
        OR (state = 'removed' AND removed_at IS NOT NULL)
    )
);

CREATE INDEX person_profile_item_person_active
    ON person_profile_item(person_id, item_kind, created_at, item_id)
    WHERE state = 'active';

CREATE FUNCTION enforce_person_profile_item_bounds()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_active_count integer;
  v_custom_count integer;
BEGIN
  IF NEW.state <> 'active' THEN
    RETURN NEW;
  END IF;
  SELECT count(*)::int,
         count(*) FILTER (WHERE item_kind = 'custom')::int
    INTO v_active_count, v_custom_count
  FROM person_profile_item
  WHERE person_id = NEW.person_id
    AND state = 'active'
    AND item_id <> NEW.item_id;
  IF v_active_count >= 200 THEN
    RAISE EXCEPTION 'Person Profile supports at most 200 active items'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.item_kind = 'custom' AND v_custom_count >= 20 THEN
    RAISE EXCEPTION 'Person Profile supports at most 20 active custom fields'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_profile_item_bounds
BEFORE INSERT OR UPDATE OF person_id, item_kind, state ON person_profile_item
FOR EACH ROW EXECUTE FUNCTION enforce_person_profile_item_bounds();

CREATE TABLE person_profile_display_owner (
    owner_id text PRIMARY KEY CHECK (owner_id = 'local-primary'),
    owner_kind text NOT NULL CHECK (owner_kind = 'local_library'),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO person_profile_display_owner (owner_id, owner_kind)
VALUES ('local-primary', 'local_library');

CREATE TABLE person_profile_display_default (
    owner_id text NOT NULL REFERENCES person_profile_display_owner(owner_id) ON DELETE CASCADE,
    field_key text NOT NULL CHECK (field_key IN (
        'about','relationships','gender_identity','pronouns','important_dates',
        'work','aliases','photo_history'
    )),
    display_order integer NOT NULL CHECK (display_order BETWEEN 0 AND 7),
    is_visible boolean NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, field_key),
    UNIQUE (owner_id, display_order)
);

INSERT INTO person_profile_display_default (
    owner_id, field_key, display_order, is_visible
) VALUES
    ('local-primary', 'about', 0, true),
    ('local-primary', 'relationships', 1, true),
    ('local-primary', 'pronouns', 2, true),
    ('local-primary', 'gender_identity', 3, true),
    ('local-primary', 'important_dates', 4, true),
    ('local-primary', 'work', 5, true),
    ('local-primary', 'aliases', 6, true),
    ('local-primary', 'photo_history', 7, true);

CREATE TABLE person_profile_display_override (
    owner_id text NOT NULL REFERENCES person_profile_display_owner(owner_id) ON DELETE CASCADE,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    field_key text NOT NULL CHECK (field_key IN (
        'about','relationships','gender_identity','pronouns','important_dates',
        'work','aliases','photo_history'
    )),
    visibility text NOT NULL CHECK (visibility IN ('inherit','show','hide')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, person_id, field_key)
);

CREATE TRIGGER person_profile_display_override_human_subject
BEFORE INSERT OR UPDATE OF person_id ON person_profile_display_override
FOR EACH ROW EXECUTE FUNCTION enforce_person_profile_human_subject();

CREATE TABLE person_profile_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    command_kind text NOT NULL CHECK (command_kind IN (
        'profile_patch','display_defaults_patch','person_display_patch'
    )),
    actor_id text NOT NULL CHECK (
        actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    person_id text REFERENCES person(person_id) ON DELETE CASCADE,
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL,
    privacy_class text NOT NULL DEFAULT 'sensitive-profile',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX person_profile_command_person_recent
    ON person_profile_command(person_id, created_at DESC, command_id DESC)
    WHERE person_id IS NOT NULL;

COMMIT;
