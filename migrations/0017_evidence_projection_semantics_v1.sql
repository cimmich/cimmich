BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_evidence_projection_semantics_v1', 'system',
    'cimmich-evidence-projection-semantics', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

-- A body inherited from an accepted face is linked geometry, not standalone
-- Body identity evidence. Preserve both records while projecting them as
-- distinct association types for product reads.
CREATE OR REPLACE VIEW asset_people AS
SELECT fo.asset_id, cfi.person_id,
       CASE WHEN head.face_id IS NULL THEN 'face'::text ELSE 'head'::text END AS association_type,
       cfi.state AS authority_state, fo.face_id AS geometry_id
FROM current_face_identity cfi
JOIN face_observation fo ON fo.face_id = cfi.face_id
LEFT JOIN LATERAL (
    SELECT g.face_id
    FROM current_reference_gallery g
    WHERE g.person_id = cfi.person_id AND g.face_id = cfi.face_id
      AND g.bucket_kind = 'head' AND g.membership_state = 'active'
    LIMIT 1
) head ON true
UNION ALL
SELECT bo.asset_id, bt.person_id,
       CASE
         WHEN bt.origin = 'face_body_linkage' AND bt.supporting_face_id IS NOT NULL
           THEN 'body_link'::text
         ELSE 'body'::text
       END,
       bt.state, bo.body_id
FROM current_body_tag bt
JOIN body_observation bo ON bo.body_id = bt.body_id
UNION ALL
SELECT pt.asset_id, pt.person_id,
       CASE WHEN pt.reason_code = 'head_evidence' THEN 'head'::text ELSE 'presence'::text END,
       pt.state, NULL::text
FROM current_presence_tag pt;

COMMIT;
