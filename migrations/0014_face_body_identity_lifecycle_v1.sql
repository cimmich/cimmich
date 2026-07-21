BEGIN;

-- A face-derived Body Tag is only valid while the accepted identity claim that
-- created it is valid. Keep this dependency in the database so every identity
-- mutation path (UI, import, maintenance, or future clients) gets the same
-- correction behavior.
CREATE OR REPLACE FUNCTION sync_face_body_linkage_with_identity_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_previous body_tag%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'accepted' AND NEW.state IS DISTINCT FROM 'accepted' THEN
    UPDATE body_tag
    SET state = 'superseded'
    WHERE origin = 'face_body_linkage'
      AND state = 'accepted'
      AND supporting_face_id = OLD.face_id
      AND identity_claim_id = OLD.identity_claim_id;
  END IF;

  IF NEW.state = 'accepted'
    AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'accepted')
  THEN
    SELECT tag.* INTO v_previous
    FROM body_tag tag
    WHERE tag.origin = 'face_body_linkage'
      AND tag.supporting_face_id = NEW.face_id
      AND tag.state = 'superseded'
    ORDER BY tag.created_at DESC, tag.body_tag_id DESC
    LIMIT 1;

    IF v_previous.body_tag_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM body_tag current
        WHERE current.body_id = v_previous.body_id AND current.state = 'accepted'
      )
    THEN
      INSERT INTO body_tag (
        body_tag_id, person_id, body_id, origin, state, supporting_face_id,
        identity_claim_id, confidence, decision_id, supersedes_body_tag_id,
        producer_receipt_id, privacy_class
      ) VALUES (
        'bodytag_' || replace(gen_random_uuid()::text, '-', ''),
        NEW.person_id, v_previous.body_id, 'face_body_linkage', 'accepted', NEW.face_id,
        NEW.identity_claim_id, v_previous.confidence, NEW.decision_id, v_previous.body_tag_id,
        NEW.producer_receipt_id, v_previous.privacy_class
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS identity_claim_face_body_linkage_lifecycle ON identity_claim;
CREATE TRIGGER identity_claim_face_body_linkage_lifecycle
AFTER INSERT OR UPDATE OF state ON identity_claim
FOR EACH ROW EXECUTE FUNCTION sync_face_body_linkage_with_identity_claim();

CREATE OR REPLACE FUNCTION enforce_face_body_linkage_consistency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_valid boolean;
BEGIN
  IF NEW.origin <> 'face_body_linkage' THEN
    RETURN NEW;
  END IF;

  SELECT true INTO v_valid
  FROM face_observation face
  JOIN body_observation body ON body.body_id = NEW.body_id AND body.asset_id = face.asset_id
  JOIN identity_claim claim ON claim.identity_claim_id = NEW.identity_claim_id
    AND claim.face_id = face.face_id
    AND claim.person_id = NEW.person_id
  WHERE face.face_id = NEW.supporting_face_id
    AND face.state = 'valid'
    AND body.state = 'valid'
    AND (NEW.state <> 'accepted' OR claim.state = 'accepted');

  IF NOT coalesce(v_valid, false) THEN
    RAISE EXCEPTION 'Face/body linkage must reference a valid same-asset face, body, Person, and accepted claim'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS body_tag_face_body_linkage_consistency ON body_tag;
CREATE CONSTRAINT TRIGGER body_tag_face_body_linkage_consistency
AFTER INSERT OR UPDATE ON body_tag
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION enforce_face_body_linkage_consistency();

CREATE INDEX IF NOT EXISTS body_tag_supersedes_lookup
  ON body_tag(supersedes_body_tag_id)
  WHERE supersedes_body_tag_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS presence_tag_supersedes_lookup
  ON presence_tag(supersedes_presence_tag_id)
  WHERE supersedes_presence_tag_id IS NOT NULL;

COMMIT;
