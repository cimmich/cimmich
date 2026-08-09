export const createIdentityAuditLeads = ({
  latest,
  presentationRank,
  projectRun,
  reconcileInterruptedRun,
  schemaVersion,
  sql,
}) =>
  async function leads() {
    await reconcileInterruptedRun();
    const [run] = await sql`
      SELECT * FROM identity_audit_run
      WHERE state = 'completed'
      ORDER BY started_at DESC, audit_run_id DESC
      LIMIT 1
    `;
    if (!run) {
      return {
        items: [],
        run: await latest(),
        schemaVersion,
        total: 0,
      };
    }
    const rows = await sql`
      WITH accepted_face_identity AS MATERIALIZED (
        SELECT DISTINCT member.physical_face_id, face.asset_id, identity.person_id
        FROM current_face_identity identity
        JOIN current_face_physical_member member ON member.face_id = identity.face_id
        JOIN face_observation face ON face.face_id = identity.face_id
          AND face.state = 'valid'
        WHERE identity.state = 'accepted'
      ), accepted_people_by_asset AS MATERIALIZED (
        SELECT DISTINCT accepted.asset_id, accepted.person_id
        FROM accepted_face_identity accepted
      )
      SELECT item.suggested_person_id, person.display_name,
        count(DISTINCT item.physical_face_id)::int AS suggestion_count
      FROM current_physical_identity_audit_item item
      JOIN identity_audit_run item_run
        ON item_run.audit_run_id = item.audit_run_id
      JOIN face_observation face
        ON face.face_id = item.face_id
      JOIN asset ON asset.asset_id = item.asset_id
      JOIN source_pack item_pack ON item_pack.pack_id = item_run.pack_id
      JOIN face_embedding query_embedding
        ON query_embedding.face_id = item.face_id
        AND query_embedding.state = 'active'
        AND query_embedding.model_family = item_pack.model_family
        AND query_embedding.model_version = item_pack.model_version
        AND query_embedding.config_digest = item_pack.config_digest
      JOIN current_person person
        ON person.person_id = item.suggested_person_id
      LEFT JOIN accepted_face_identity selected_identity
        ON selected_identity.physical_face_id = item.physical_face_id
      LEFT JOIN accepted_people_by_asset same_photo_identity
        ON same_photo_identity.asset_id = item.asset_id
        AND same_photo_identity.person_id = item.suggested_person_id
      WHERE item.audit_run_id = ${run.audit_run_id}
        AND item.audit_kind = 'untagged_match'
        AND item.review_state = 'open'
        AND person.status = 'active'
        AND person.subject_kind = 'person'
        AND cimmich_visibility_person_rank(person.person_id)
          <= ${presentationRank()}
        AND face.state = 'valid'
        AND asset.state = 'active'
        AND cimmich_visibility_asset_rank(asset.asset_id)
          <= ${presentationRank()}
        AND cimmich_face_match_eligible(
          face.detection_confidence, face.box_w, face.box_h
        )
        AND coalesce((SELECT review.reason_code FROM decision review WHERE review.subject_type = 'face_review' AND review.subject_id = face.face_id ORDER BY review.created_at DESC, review.decision_id DESC LIMIT 1), '') <> 'face_review_unknown'
        AND selected_identity.physical_face_id IS NULL
        AND same_photo_identity.person_id IS NULL
      GROUP BY item.suggested_person_id, person.display_name
      ORDER BY suggestion_count DESC, lower(person.display_name),
        item.suggested_person_id
    `;
    return {
      items: rows.map((row) => ({
        displayName: row.display_name,
        personId: row.suggested_person_id,
        suggestionCount: Number(row.suggestion_count),
      })),
      run: projectRun(run, run.pack_id),
      schemaVersion,
      total: rows.length,
    };
  };
