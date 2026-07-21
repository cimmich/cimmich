BEGIN;

CREATE INDEX identity_claim_person_state_created
    ON identity_claim(person_id, state, created_at DESC, identity_claim_id DESC);

COMMIT;
