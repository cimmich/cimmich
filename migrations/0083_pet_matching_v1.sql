BEGIN;

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_pet_matching_v1', 'system',
  'cimmich-pet-matching', 'v1', now(), now(),
  encode(digest('cimmich.pet-matching.v1', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

CREATE TABLE pet_match_run (
  run_id text PRIMARY KEY,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  provider_id text NOT NULL CHECK (length(btrim(provider_id)) BETWEEN 1 AND 160),
  model_family text NOT NULL CHECK (length(btrim(model_family)) BETWEEN 1 AND 160),
  model_version text NOT NULL CHECK (length(btrim(model_version)) BETWEEN 1 AND 160),
  vector_space_id text NOT NULL CHECK (length(btrim(vector_space_id)) BETWEEN 1 AND 192),
  config_digest text NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
  lane text NOT NULL CHECK (lane IN ('face', 'whole_animal')),
  species_kind text NOT NULL CHECK (
    species_kind IN ('dog','cat','bird','rabbit','fish','reptile','small_mammal','other')
  ),
  observation_count integer NOT NULL CHECK (observation_count BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'complete' CHECK (state IN ('complete', 'superseded')),
  imported_by text NOT NULL CHECK (length(btrim(imported_by)) BETWEEN 1 AND 120),
  producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
  privacy_class text NOT NULL DEFAULT 'private',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, species_kind)
);

CREATE TABLE pet_match_observation (
  observation_id text PRIMARY KEY,
  run_id text NOT NULL,
  asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
  species_kind text NOT NULL CHECK (
    species_kind IN ('dog','cat','bird','rabbit','fish','reptile','small_mammal','other')
  ),
  box_x numeric NOT NULL CHECK (box_x BETWEEN 0 AND 1),
  box_y numeric NOT NULL CHECK (box_y BETWEEN 0 AND 1),
  box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
  box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
  detection_confidence numeric NOT NULL CHECK (detection_confidence BETWEEN 0 AND 1),
  embedding_digest text NOT NULL CHECK (embedding_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (
    state IN ('pending', 'confirmed', 'rejected', 'unknown', 'superseded')
  ),
  realized_observation_id text,
  realized_association_id text,
  producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
  privacy_class text NOT NULL DEFAULT 'private',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001),
  CHECK (
    (state = 'confirmed') =
    (realized_observation_id IS NOT NULL AND realized_association_id IS NOT NULL)
  ),
  FOREIGN KEY (run_id, species_kind)
    REFERENCES pet_match_run(run_id, species_kind) ON DELETE CASCADE,
  UNIQUE (run_id, asset_id, box_x, box_y, box_w, box_h)
);

CREATE TABLE pet_match_suggestion (
  suggestion_id text PRIMARY KEY,
  observation_id text NOT NULL REFERENCES pet_match_observation(observation_id) ON DELETE CASCADE,
  pet_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  score numeric NOT NULL CHECK (score BETWEEN -1 AND 1),
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 5),
  gallery_count integer NOT NULL CHECK (gallery_count BETWEEN 1 AND 1000000),
  state text NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'confirmed', 'rejected', 'superseded')
  ),
  decision_id text REFERENCES decision(decision_id),
  producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
  privacy_class text NOT NULL DEFAULT 'private',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (observation_id, pet_id),
  UNIQUE (observation_id, rank),
  CHECK ((state IN ('confirmed', 'rejected')) = (decision_id IS NOT NULL))
);

CREATE UNIQUE INDEX pet_match_one_confirmed_suggestion
  ON pet_match_suggestion(observation_id)
  WHERE state = 'confirmed';

CREATE INDEX pet_match_suggestion_pet_pending
  ON pet_match_suggestion(pet_id, created_at DESC, suggestion_id)
  WHERE state = 'pending';

CREATE INDEX pet_match_observation_unknown
  ON pet_match_observation(created_at DESC, observation_id)
  WHERE state = 'unknown';

CREATE TABLE pet_match_command (
  command_id text PRIMARY KEY,
  command_kind text NOT NULL CHECK (command_kind IN ('confirm', 'reject')),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  decision_id text REFERENCES decision(decision_id),
  response jsonb NOT NULL,
  producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
  privacy_class text NOT NULL DEFAULT 'private',
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION cimmich_validate_pet_match_suggestion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pet person%ROWTYPE;
  v_species text;
BEGIN
  SELECT * INTO v_pet FROM person WHERE person_id = NEW.pet_id;
  SELECT species_kind INTO v_species
  FROM pet_match_observation
  WHERE observation_id = NEW.observation_id;

  IF v_pet.person_id IS NULL OR v_pet.subject_kind <> 'pet'
     OR v_pet.status NOT IN ('active', 'hidden') THEN
    RAISE EXCEPTION 'pet_match_suggestion target must be an active or hidden Pet';
  END IF;
  IF v_pet.species_kind IS DISTINCT FROM v_species THEN
    RAISE EXCEPTION 'pet_match_suggestion must compare within one species';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER pet_match_suggestion_pet_species
AFTER INSERT OR UPDATE OF pet_id, observation_id
ON pet_match_suggestion
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION cimmich_validate_pet_match_suggestion();

COMMENT ON TABLE pet_match_observation IS
  'Non-authoritative Pet model evidence. Unknown remains a first-class outcome until a user confirms an identity.';
COMMENT ON TABLE pet_match_suggestion IS
  'Ranked same-species Pet identity proposals. A proposal never becomes a Pet tag without an explicit user decision.';

COMMIT;
