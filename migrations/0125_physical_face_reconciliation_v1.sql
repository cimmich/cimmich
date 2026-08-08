BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_physical_face_reconciliation_v1', 'system',
    'cimmich-physical-face-reconciliation', 'v1', now(), now(),
    encode(digest('cimmich.physical-face-reconciliation.v1', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE physical_face (
    physical_face_id text PRIMARY KEY CHECK (physical_face_id ~ '^physical_face_[0-9a-f]{40}$'),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    canonical_face_id text NOT NULL UNIQUE REFERENCES face_observation(face_id) ON DELETE CASCADE,
    state text NOT NULL CHECK (state IN ('active','conflict')),
    member_count integer NOT NULL CHECK (member_count >= 2),
    accepted_person_count integer NOT NULL CHECK (accepted_person_count >= 0),
    policy_version text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX physical_face_asset_state
    ON physical_face(asset_id, state, canonical_face_id);

CREATE TABLE physical_face_member (
    physical_face_id text NOT NULL REFERENCES physical_face(physical_face_id) ON DELETE CASCADE,
    face_id text NOT NULL UNIQUE REFERENCES face_observation(face_id) ON DELETE CASCADE,
    is_canonical boolean NOT NULL,
    geometry_iou numeric NOT NULL CHECK (geometry_iou BETWEEN 0 AND 1),
    source_priority integer NOT NULL CHECK (source_priority >= 0),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (physical_face_id, face_id)
);

CREATE INDEX physical_face_member_group
    ON physical_face_member(physical_face_id, is_canonical DESC, face_id);

CREATE TABLE physical_face_reconciliation_action (
    action_id text PRIMARY KEY CHECK (action_id ~ '^physical_action_[0-9a-f]{40}$'),
    subject_type text NOT NULL CHECK (subject_type IN ('identity_claim','possible_person_run')),
    subject_id text NOT NULL,
    prior_state text NOT NULL,
    resulting_state text NOT NULL,
    reason_code text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subject_type, subject_id, reason_code)
);

CREATE FUNCTION prevent_physical_face_reconciliation_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'PHYSICAL_FACE_RECONCILIATION_EVIDENCE_APPEND_ONLY_DB'
      USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER physical_face_reconciliation_action_immutable
BEFORE UPDATE OR DELETE ON physical_face_reconciliation_action
FOR EACH ROW EXECUTE FUNCTION prevent_physical_face_reconciliation_evidence_mutation();

-- This is a rebuildable projection over immutable observations and accepted
-- identity truth. Possible-people refresh invokes it explicitly; merely opening
-- a review surface never performs biometric work.
CREATE FUNCTION cimmich_refresh_physical_face_reconciliation()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_active_groups integer;
  v_conflict_groups integer;
  v_members integer;
BEGIN
DELETE FROM physical_face_member;
DELETE FROM physical_face;
DROP TABLE IF EXISTS pg_temp.physical_face_source;
DROP TABLE IF EXISTS pg_temp.physical_face_pair_candidate;
DROP TABLE IF EXISTS pg_temp.physical_face_root;
DROP TABLE IF EXISTS pg_temp.physical_face_group_member;
DROP TABLE IF EXISTS pg_temp.physical_face_group;

CREATE TEMP TABLE physical_face_source ON COMMIT DROP AS
SELECT face.face_id, face.asset_id, face.box_x, face.box_y, face.box_w, face.box_h,
  face.producer_receipt_id, receipt.producer_name,
  CASE
    WHEN receipt.producer_name LIKE 'cimmich-face-detector:%' THEN 0
    WHEN receipt.producer_name = 'neutral-source-person-evidence' THEN 1
    WHEN receipt.producer_name = 'cimmich-xmp-sidecar-face-import' THEN 2
    WHEN receipt.producer_name = 'private-machine-observation-import' THEN 3
    ELSE 10
  END AS source_priority
FROM face_observation face
JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
JOIN producer_receipt receipt
  ON receipt.producer_receipt_id = face.producer_receipt_id
WHERE face.state = 'valid';

CREATE INDEX physical_face_source_asset
  ON physical_face_source(asset_id, source_priority, producer_name, face_id);

CREATE TEMP TABLE physical_face_pair_candidate ON COMMIT DROP AS
WITH overlap AS MATERIALIZED (
  SELECT canonical.face_id AS canonical_face_id,
    member.face_id AS member_face_id,
    member.producer_name AS member_source,
    canonical.source_priority AS canonical_priority,
    member.source_priority AS member_priority,
    greatest(0::numeric,
      least(canonical.box_x + canonical.box_w, member.box_x + member.box_w)
      - greatest(canonical.box_x, member.box_x))
    * greatest(0::numeric,
      least(canonical.box_y + canonical.box_h, member.box_y + member.box_h)
      - greatest(canonical.box_y, member.box_y)) AS intersection_area,
    canonical.box_w * canonical.box_h AS canonical_area,
    member.box_w * member.box_h AS member_area
  FROM physical_face_source canonical
  JOIN physical_face_source member
    ON member.asset_id = canonical.asset_id
   AND member.source_priority > canonical.source_priority
   AND member.producer_name <> canonical.producer_name
), scored AS MATERIALIZED (
  SELECT *, intersection_area /
    nullif(canonical_area + member_area - intersection_area, 0) AS geometry_iou
  FROM overlap
  WHERE intersection_area > 0
), ranked AS (
  SELECT *,
    row_number() OVER (
      PARTITION BY member_face_id
      ORDER BY geometry_iou DESC, canonical_priority, canonical_face_id
    ) AS member_choice,
    row_number() OVER (
      PARTITION BY canonical_face_id, member_source
      ORDER BY geometry_iou DESC, member_face_id
    ) AS canonical_lane_choice
  FROM scored
  WHERE geometry_iou >= 0.5
)
SELECT canonical_face_id, member_face_id, geometry_iou,
  canonical_priority, member_priority
FROM ranked
WHERE member_choice = 1 AND canonical_lane_choice = 1;

CREATE UNIQUE INDEX physical_face_pair_member
  ON physical_face_pair_candidate(member_face_id);

-- Source priority strictly decreases on every edge, so the recursive walk is
-- finite and deterministically resolves each observation to its best root.
CREATE TEMP TABLE physical_face_root ON COMMIT DROP AS
WITH RECURSIVE walk AS (
  SELECT pair.member_face_id AS face_id,
    pair.canonical_face_id AS current_face_id,
    pair.geometry_iou AS path_iou, 1 AS depth
  FROM physical_face_pair_candidate pair
  UNION ALL
  SELECT walk.face_id, parent.canonical_face_id,
    least(walk.path_iou, parent.geometry_iou), walk.depth + 1
  FROM walk
  JOIN physical_face_pair_candidate parent
    ON parent.member_face_id = walk.current_face_id
), root AS (
  SELECT DISTINCT ON (walk.face_id)
    walk.face_id, walk.current_face_id AS root_face_id, walk.path_iou
  FROM walk
  LEFT JOIN physical_face_pair_candidate parent
    ON parent.member_face_id = walk.current_face_id
  WHERE parent.member_face_id IS NULL
  ORDER BY walk.face_id, walk.depth DESC, walk.current_face_id
)
SELECT * FROM root;

CREATE UNIQUE INDEX physical_face_root_face
  ON physical_face_root(face_id);
CREATE INDEX physical_face_root_group
  ON physical_face_root(root_face_id, face_id);

CREATE TEMP TABLE physical_face_group_member ON COMMIT DROP AS
SELECT root.root_face_id, root.face_id, root.path_iou
FROM physical_face_root root
UNION
SELECT DISTINCT root.root_face_id, root.root_face_id, 1::numeric
FROM physical_face_root root;

CREATE TEMP TABLE physical_face_group ON COMMIT DROP AS
SELECT member.root_face_id,
  count(*)::int AS member_count,
  count(DISTINCT accepted.person_id)::int AS accepted_person_count,
  coalesce(
    jsonb_agg(DISTINCT accepted.person_id) FILTER (WHERE accepted.person_id IS NOT NULL),
    '[]'::jsonb
  ) AS accepted_person_ids,
  min(member.path_iou) AS minimum_path_iou
FROM physical_face_group_member member
LEFT JOIN identity_claim accepted
  ON accepted.face_id = member.face_id AND accepted.state = 'accepted'
GROUP BY member.root_face_id;

INSERT INTO physical_face (
  physical_face_id, asset_id, canonical_face_id, state, member_count,
  accepted_person_count, policy_version, evidence, producer_receipt_id
)
SELECT 'physical_face_' || substr(encode(digest(grouped.root_face_id, 'sha256'), 'hex'), 1, 40),
  source.asset_id, grouped.root_face_id,
  CASE WHEN grouped.accepted_person_count > 1 THEN 'conflict' ELSE 'active' END,
  grouped.member_count, grouped.accepted_person_count,
  'cimmich-physical-face-reconciliation-v1',
  jsonb_build_object(
    'acceptedPersonIds', grouped.accepted_person_ids,
    'automaticMerge', grouped.accepted_person_count <= 1,
    'geometryIouFloor', 0.5,
    'minimumPathIou', grouped.minimum_path_iou,
    'sourcePolicy', 'strict-priority-one-per-source-lane'
  ),
  'receipt_cimmich_physical_face_reconciliation_v1'
FROM physical_face_group grouped
JOIN physical_face_source source ON source.face_id = grouped.root_face_id;

INSERT INTO physical_face_member (
  physical_face_id, face_id, is_canonical, geometry_iou, source_priority,
  producer_receipt_id
)
SELECT physical.physical_face_id, member.face_id,
  member.face_id = member.root_face_id, member.path_iou,
  source.source_priority, 'receipt_cimmich_physical_face_reconciliation_v1'
FROM physical_face_group_member member
JOIN physical_face physical ON physical.canonical_face_id = member.root_face_id
JOIN physical_face_source source ON source.face_id = member.face_id;

SELECT count(*) FILTER (WHERE state = 'active')::int,
  count(*) FILTER (WHERE state = 'conflict')::int
INTO v_active_groups, v_conflict_groups
FROM physical_face;
SELECT count(*)::int INTO v_members FROM physical_face_member;
RETURN jsonb_build_object(
  'activeGroups', v_active_groups,
  'conflictGroups', v_conflict_groups,
  'members', v_members,
  'policyVersion', 'cimmich-physical-face-reconciliation-v1'
);
END;
$$;

SELECT cimmich_refresh_physical_face_reconciliation();

CREATE VIEW current_face_physical_member AS
SELECT face.face_id, face.asset_id,
  CASE
    WHEN physical.state = 'active' THEN physical.physical_face_id
    ELSE 'physical_face_' || substr(encode(digest(face.face_id, 'sha256'), 'hex'), 1, 40)
  END AS physical_face_id,
  CASE WHEN physical.state = 'active' THEN physical.canonical_face_id ELSE face.face_id END
    AS canonical_face_id,
  physical.physical_face_id AS reconciliation_group_id,
  coalesce(physical.state, 'singleton') AS reconciliation_state
FROM face_observation face
LEFT JOIN physical_face_member member ON member.face_id = face.face_id
LEFT JOIN physical_face physical ON physical.physical_face_id = member.physical_face_id
WHERE face.state = 'valid';

CREATE VIEW current_matchable_physical_face AS
SELECT face.*, member.physical_face_id, member.reconciliation_state
FROM current_face_physical_member member
JOIN face_observation face ON face.face_id = member.canonical_face_id
WHERE member.face_id = member.canonical_face_id
  AND member.reconciliation_state <> 'conflict'
  AND face.state = 'valid';

CREATE VIEW current_display_face AS
SELECT face.*, member.physical_face_id, member.reconciliation_state,
  member.reconciliation_group_id
FROM current_face_physical_member member
JOIN face_observation face ON face.face_id = member.canonical_face_id
WHERE member.face_id = member.canonical_face_id
  AND face.state = 'valid';

CREATE VIEW current_physical_face_identity AS
SELECT DISTINCT ON (member.physical_face_id, identity.person_id)
  member.physical_face_id, member.canonical_face_id,
  identity.face_id AS claim_face_id, identity.person_id, identity.state,
  identity.origin, identity.calibrated_confidence, identity.identity_claim_id
FROM current_face_identity identity
JOIN current_face_physical_member member ON member.face_id = identity.face_id
ORDER BY member.physical_face_id, identity.person_id,
  CASE identity.state
    WHEN 'accepted' THEN 0 WHEN 'candidate' THEN 1
    WHEN 'rejected' THEN 2 ELSE 3
  END,
  identity.identity_claim_id;

-- Every graph-v1 cluster candidate came from a snapshot that admitted parallel
-- observations as independent people. They are unconfirmed machine output, so
-- retire them with an append-only repair record and leave accepted identity
-- truth untouched.
INSERT INTO physical_face_reconciliation_action (
  action_id, subject_type, subject_id, prior_state, resulting_state,
  reason_code, evidence, producer_receipt_id
)
SELECT 'physical_action_' || substr(encode(digest(claim.identity_claim_id, 'sha256'), 'hex'), 1, 40),
  'identity_claim', claim.identity_claim_id, claim.state, 'superseded',
  'possible_people_graph_v1_parallel_observation_repair',
  jsonb_build_object(
    'automaticAcceptance', false,
    'origin', claim.origin,
    'priorAssignmentDecision', claim.evidence_refs->>'assignment_decision'
  ),
  'receipt_cimmich_physical_face_reconciliation_v1'
FROM identity_claim claim
WHERE claim.state = 'candidate' AND claim.origin = 'cluster_propagation'
  AND coalesce(claim.evidence_refs->>'policy_version', '') =
    'cimmich-possible-people-graph-v1';

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, note, producer_receipt_id, privacy_class
)
SELECT 'decision_physical_' || substr(encode(digest(action.subject_id, 'sha256'), 'hex'), 1, 40),
  'identity_claim', action.subject_id, 'ignore', 'policy',
  'cimmich-physical-face-reconciliation-v1', action.reason_code,
  'Retire unconfirmed graph-v1 output produced from parallel Face observations',
  'receipt_cimmich_physical_face_reconciliation_v1', 'sensitive-biometric'
FROM physical_face_reconciliation_action action
WHERE action.subject_type = 'identity_claim'
  AND action.reason_code = 'possible_people_graph_v1_parallel_observation_repair';

UPDATE identity_claim claim
SET state = 'superseded',
  decision_id = 'decision_physical_' ||
    substr(encode(digest(claim.identity_claim_id, 'sha256'), 'hex'), 1, 40)
FROM physical_face_reconciliation_action action
WHERE action.subject_type = 'identity_claim'
  AND action.subject_id = claim.identity_claim_id
  AND action.reason_code = 'possible_people_graph_v1_parallel_observation_repair'
  AND claim.state = 'candidate';

-- Retire any older matcher candidate that is now proven to be the same
-- physical Face and Person as accepted evidence on another observation lane.
INSERT INTO physical_face_reconciliation_action (
  action_id, subject_type, subject_id, prior_state, resulting_state,
  reason_code, evidence, producer_receipt_id
)
SELECT 'physical_action_' || substr(encode(digest('duplicate:' || candidate.identity_claim_id, 'sha256'), 'hex'), 1, 40),
  'identity_claim', candidate.identity_claim_id, candidate.state, 'superseded',
  'physical_face_already_accepted_for_person',
  jsonb_build_object('physicalFaceId', candidate_member.physical_face_id),
  'receipt_cimmich_physical_face_reconciliation_v1'
FROM identity_claim candidate
JOIN current_face_physical_member candidate_member
  ON candidate_member.face_id = candidate.face_id
WHERE candidate.state = 'candidate'
  AND candidate_member.reconciliation_state = 'active'
  AND EXISTS (
    SELECT 1
    FROM current_face_physical_member accepted_member
    JOIN identity_claim accepted ON accepted.face_id = accepted_member.face_id
      AND accepted.state = 'accepted'
      AND accepted.person_id = candidate.person_id
    WHERE accepted_member.physical_face_id = candidate_member.physical_face_id
  )
ON CONFLICT (subject_type, subject_id, reason_code) DO NOTHING;

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, note, producer_receipt_id, privacy_class
)
SELECT 'decision_physical_' ||
    substr(encode(digest('duplicate:' || action.subject_id, 'sha256'), 'hex'), 1, 40),
  'identity_claim', action.subject_id, 'ignore', 'policy',
  'cimmich-physical-face-reconciliation-v1', action.reason_code,
  'Retire an unconfirmed candidate already accepted for this Person on an equivalent Face observation',
  'receipt_cimmich_physical_face_reconciliation_v1', 'sensitive-biometric'
FROM physical_face_reconciliation_action action
WHERE action.subject_type = 'identity_claim'
  AND action.reason_code = 'physical_face_already_accepted_for_person';

UPDATE identity_claim claim
SET state = 'superseded',
  decision_id = 'decision_physical_' ||
    substr(encode(digest('duplicate:' || claim.identity_claim_id, 'sha256'), 'hex'), 1, 40)
FROM physical_face_reconciliation_action action
WHERE action.subject_type = 'identity_claim'
  AND action.subject_id = claim.identity_claim_id
  AND action.reason_code = 'physical_face_already_accepted_for_person'
  AND claim.state = 'candidate';

COMMIT;
