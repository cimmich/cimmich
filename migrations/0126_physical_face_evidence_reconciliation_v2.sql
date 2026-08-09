BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES
(
    'receipt_cimmich_physical_face_reconciliation_v2', 'system',
    'cimmich-physical-face-reconciliation', 'v2', now(), now(),
    encode(digest('cimmich.physical-face-reconciliation.v2', 'sha256'), 'hex'),
    'sensitive-biometric'
),
(
    'receipt_cimmich_xmp_sidecar_face_import_v2', 'trusted_import',
    'cimmich-xmp-sidecar-face-import', 'v2', now(), now(),
    encode(digest('cimmich.xmp-sidecar-face-import.v2', 'sha256'), 'hex'),
    'sensitive-biometric'
)
ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Raw Face rows are observations. This projection is the review identity:
-- detector, sidecar and import regions that describe one physical Face must
-- converge before matching, audit or owner review can treat them as subjects.
CREATE OR REPLACE FUNCTION cimmich_refresh_physical_face_reconciliation()
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
  coalesce(identity.accepted_person_ids, ARRAY[]::text[]) AS accepted_person_ids,
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
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT claim.person_id ORDER BY claim.person_id)
    AS accepted_person_ids
  FROM identity_claim claim
  WHERE claim.face_id = face.face_id AND claim.state = 'accepted'
) identity ON true
WHERE face.state = 'valid';

CREATE INDEX physical_face_source_asset
  ON physical_face_source(asset_id, source_priority, producer_name, face_id);

CREATE TEMP TABLE physical_face_pair_candidate ON COMMIT DROP AS
WITH overlap AS MATERIALIZED (
  SELECT canonical.face_id AS canonical_face_id,
    member.face_id AS member_face_id,
    canonical.producer_name AS canonical_source,
    member.producer_name AS member_source,
    canonical.accepted_person_ids AS canonical_people,
    member.accepted_person_ids AS member_people,
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
   AND (
     (
       member.source_priority > canonical.source_priority
       AND member.producer_name <> canonical.producer_name
     )
     OR (
       member.producer_name = 'cimmich-xmp-sidecar-face-import'
       AND canonical.producer_name = member.producer_name
       AND canonical.face_id < member.face_id
       AND cardinality(canonical.accepted_person_ids) = 1
       AND canonical.accepted_person_ids = member.accepted_person_ids
     )
   )
), scored AS MATERIALIZED (
  SELECT *,
    intersection_area /
      nullif(canonical_area + member_area - intersection_area, 0) AS geometry_iou,
    intersection_area / nullif(least(canonical_area, member_area), 0)
      AS containment_ratio,
    greatest(canonical_area, member_area) /
      nullif(least(canonical_area, member_area), 0) AS area_ratio
  FROM overlap
  WHERE intersection_area > 0
), qualified AS MATERIALIZED (
  SELECT *
  FROM scored
  WHERE geometry_iou >= 0.5
     OR (containment_ratio >= 0.85 AND area_ratio <= 4)
), ranked AS (
  SELECT *,
    row_number() OVER (
      PARTITION BY member_face_id
      ORDER BY geometry_iou DESC, containment_ratio DESC,
        canonical_priority, canonical_face_id
    ) AS member_choice
  FROM qualified
)
SELECT canonical_face_id, member_face_id, geometry_iou,
  containment_ratio, canonical_priority, member_priority
FROM ranked
WHERE member_choice = 1;

CREATE UNIQUE INDEX physical_face_pair_member
  ON physical_face_pair_candidate(member_face_id);

-- Every edge points to a lower source priority, or to a lexically earlier XMP
-- observation with the same accepted Person, so the walk is acyclic.
CREATE TEMP TABLE physical_face_root ON COMMIT DROP AS
WITH RECURSIVE walk AS (
  SELECT pair.member_face_id AS face_id,
    pair.canonical_face_id AS current_face_id,
    pair.geometry_iou AS path_iou,
    pair.containment_ratio AS path_containment, 1 AS depth
  FROM physical_face_pair_candidate pair
  UNION ALL
  SELECT walk.face_id, parent.canonical_face_id,
    least(walk.path_iou, parent.geometry_iou),
    least(walk.path_containment, parent.containment_ratio), walk.depth + 1
  FROM walk
  JOIN physical_face_pair_candidate parent
    ON parent.member_face_id = walk.current_face_id
), root AS (
  SELECT DISTINCT ON (walk.face_id)
    walk.face_id, walk.current_face_id AS root_face_id,
    walk.path_iou, walk.path_containment
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
SELECT root.root_face_id, root.face_id, root.path_iou, root.path_containment
FROM physical_face_root root
UNION
SELECT DISTINCT root.root_face_id, root.root_face_id, 1::numeric, 1::numeric
FROM physical_face_root root;

CREATE TEMP TABLE physical_face_group ON COMMIT DROP AS
SELECT member.root_face_id,
  count(*)::int AS member_count,
  count(DISTINCT accepted.person_id)::int AS accepted_person_count,
  coalesce(
    jsonb_agg(DISTINCT accepted.person_id)
      FILTER (WHERE accepted.person_id IS NOT NULL),
    '[]'::jsonb
  ) AS accepted_person_ids,
  min(member.path_iou) AS minimum_path_iou,
  min(member.path_containment) AS minimum_path_containment
FROM physical_face_group_member member
LEFT JOIN identity_claim accepted
  ON accepted.face_id = member.face_id AND accepted.state = 'accepted'
GROUP BY member.root_face_id;

INSERT INTO physical_face (
  physical_face_id, asset_id, canonical_face_id, state, member_count,
  accepted_person_count, policy_version, evidence, producer_receipt_id
)
SELECT 'physical_face_' ||
    substr(encode(digest(grouped.root_face_id, 'sha256'), 'hex'), 1, 40),
  source.asset_id, grouped.root_face_id,
  CASE WHEN grouped.accepted_person_count > 1 THEN 'conflict' ELSE 'active' END,
  grouped.member_count, grouped.accepted_person_count,
  'cimmich-physical-face-reconciliation-v2',
  jsonb_build_object(
    'acceptedPersonIds', grouped.accepted_person_ids,
    'automaticMerge', grouped.accepted_person_count <= 1,
    'areaRatioCeiling', 4,
    'containmentFloor', 0.85,
    'geometryIouFloor', 0.5,
    'minimumPathContainment', grouped.minimum_path_containment,
    'minimumPathIou', grouped.minimum_path_iou,
    'sourcePolicy', 'canonical-physical-face-evidence-v2'
  ),
  'receipt_cimmich_physical_face_reconciliation_v2'
FROM physical_face_group grouped
JOIN physical_face_source source ON source.face_id = grouped.root_face_id;

INSERT INTO physical_face_member (
  physical_face_id, face_id, is_canonical, geometry_iou, source_priority,
  producer_receipt_id
)
SELECT physical.physical_face_id, member.face_id,
  member.face_id = member.root_face_id, member.path_iou,
  source.source_priority, 'receipt_cimmich_physical_face_reconciliation_v2'
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
  'policyVersion', 'cimmich-physical-face-reconciliation-v2'
);
END;
$$;

SELECT cimmich_refresh_physical_face_reconciliation();

CREATE VIEW current_physical_identity_audit_item AS
SELECT ranked.*
FROM (
  SELECT item.*, member.physical_face_id,
    row_number() OVER (
      PARTITION BY item.audit_run_id, item.audit_kind,
        item.suggested_person_id, member.physical_face_id
      ORDER BY CASE
          WHEN item.audit_kind = 'accepted_contradiction' AND EXISTS (
            SELECT 1
            FROM current_face_identity accepted
            WHERE accepted.face_id = item.face_id
              AND accepted.person_id = item.assigned_person_id
              AND accepted.state = 'accepted'
          ) THEN 0 ELSE 1
        END,
        item.suggested_score DESC, item.margin DESC, item.face_id
    ) AS physical_rank
  FROM identity_audit_item item
  JOIN current_face_physical_member member ON member.face_id = item.face_id
) ranked
WHERE ranked.physical_rank = 1;

-- Only unconfirmed candidates can be retired automatically. Accepted owner or
-- trusted-import identity remains append-only truth and is merely read through
-- the canonical physical-Face projection.
INSERT INTO physical_face_reconciliation_action (
  action_id, subject_type, subject_id, prior_state, resulting_state,
  reason_code, evidence, producer_receipt_id
)
SELECT 'physical_action_' || substr(
    encode(digest('v2-duplicate:' || candidate.identity_claim_id, 'sha256'), 'hex'),
    1, 40
  ),
  'identity_claim', candidate.identity_claim_id, candidate.state, 'superseded',
  'physical_face_v2_already_accepted_for_person',
  jsonb_build_object('physicalFaceId', candidate_member.physical_face_id),
  'receipt_cimmich_physical_face_reconciliation_v2'
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
SELECT 'decision_physical_' || substr(
    encode(digest('v2-duplicate:' || action.subject_id, 'sha256'), 'hex'), 1, 40
  ),
  'identity_claim', action.subject_id, 'ignore', 'policy',
  'cimmich-physical-face-reconciliation-v2', action.reason_code,
  'Retire an unconfirmed candidate already accepted for this Person on equivalent Face evidence',
  'receipt_cimmich_physical_face_reconciliation_v2', 'sensitive-biometric'
FROM physical_face_reconciliation_action action
WHERE action.subject_type = 'identity_claim'
  AND action.reason_code = 'physical_face_v2_already_accepted_for_person';

UPDATE identity_claim claim
SET state = 'superseded',
  decision_id = 'decision_physical_' || substr(
    encode(digest('v2-duplicate:' || claim.identity_claim_id, 'sha256'), 'hex'),
    1, 40
  )
FROM physical_face_reconciliation_action action
WHERE action.subject_type = 'identity_claim'
  AND action.subject_id = claim.identity_claim_id
  AND action.reason_code = 'physical_face_v2_already_accepted_for_person'
  AND claim.state = 'candidate';

COMMIT;
