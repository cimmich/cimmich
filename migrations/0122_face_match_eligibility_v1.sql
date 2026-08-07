BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_face_match_eligibility_v1', 'system',
    'cimmich-face-match-eligibility', 'v1', now(), now(),
    encode(digest('cimmich.face-match-eligibility.v1', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Keep low-confidence observations available for owner inspection and manual
-- correction, but do not treat regions the measured Face-condition policy
-- classifies as reject_noise as identity-matching queries. A NULL detector
-- score belongs to imported/manual evidence and remains eligible because the
-- classifier calls it unknown rather than reject_noise.
CREATE OR REPLACE FUNCTION cimmich_face_match_eligible(
    detection_confidence numeric,
    box_w numeric,
    box_h numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT detection_confidence IS NULL OR (
      detection_confidence >= 0.24
      AND box_w * box_h >= 0.00015
    )
$$;

-- Historical archive matching predated the authoritative reject_noise gate.
-- Retire only its still-unreviewed candidates. The identity ledger requires
-- every terminal claim state to name the decision that caused it, so record a
-- deterministic policy decision before superseding each candidate. Accepted
-- or rejected owner decisions and the observations/embeddings stay untouched.
INSERT INTO decision (
    decision_id, subject_type, subject_id, action, actor_kind, actor_id,
    reason_code, note, producer_receipt_id, privacy_class
)
SELECT
    'decision_face_gate_' || encode(
      digest('cimmich.face-match-eligibility.v1:' || claim.identity_claim_id, 'sha256'),
      'hex'
    ),
    'identity_claim', claim.identity_claim_id, 'ignore', 'policy',
    'cimmich-face-match-eligibility', 'raw_face_floor_not_met',
    'Retired unreviewed machine suggestion that fails the measured Face-condition policy.',
    'receipt_cimmich_face_match_eligibility_v1', 'sensitive-biometric'
FROM identity_claim claim
JOIN face_observation face ON face.face_id = claim.face_id
WHERE face.state = 'valid'
  AND claim.state = 'candidate'
  AND claim.origin = 'prime_match'
  AND coalesce(claim.evidence_refs->>'assignment_decision', '')
    = 'source_pack_prime_match'
  AND NOT cimmich_face_match_eligible(
    face.detection_confidence,
    face.box_w,
    face.box_h
  )
ON CONFLICT (decision_id) DO NOTHING;

UPDATE identity_claim claim
SET state = 'superseded',
    decision_id = decision.decision_id
FROM face_observation face,
     decision
WHERE face.face_id = claim.face_id
  AND decision.decision_id = 'decision_face_gate_' || encode(
    digest('cimmich.face-match-eligibility.v1:' || claim.identity_claim_id, 'sha256'),
    'hex'
  )
  AND face.state = 'valid'
  AND claim.state = 'candidate'
  AND claim.origin = 'prime_match'
  AND coalesce(claim.evidence_refs->>'assignment_decision', '')
    = 'source_pack_prime_match'
  AND NOT cimmich_face_match_eligible(
    face.detection_confidence,
    face.box_w,
    face.box_h
  );

COMMIT;
