const cleanKind = (value) =>
  value === "accepted_contradiction"
    ? "accepted_contradiction"
    : "untagged_match";

export const carryForwardIdentityAuditDismissals = async (
  sql,
  { kind, runId } = {},
) => {
  const auditKind = cleanKind(kind);
  await sql`
    WITH previous AS (
      SELECT DISTINCT ON (current.face_id)
        current.face_id, prior.reviewed_at, prior.reviewed_by
      FROM identity_audit_item current
      JOIN identity_audit_item prior
        ON prior.audit_run_id <> current.audit_run_id
        AND prior.audit_kind = current.audit_kind
        AND prior.face_id = current.face_id
        AND prior.suggested_person_id = current.suggested_person_id
        AND prior.assigned_person_id IS NOT DISTINCT FROM
          current.assigned_person_id
        AND prior.review_state = 'dismissed'
      JOIN identity_audit_run prior_run
        ON prior_run.audit_run_id = prior.audit_run_id
        AND prior_run.state = 'completed'
      WHERE current.audit_run_id = ${runId}
        AND current.audit_kind = ${auditKind}
        AND current.review_state = 'open'
      ORDER BY current.face_id, prior.reviewed_at DESC, prior.audit_run_id DESC
    )
    UPDATE identity_audit_item current
    SET review_state = 'dismissed',
      reviewed_at = previous.reviewed_at,
      reviewed_by = previous.reviewed_by
    FROM previous
    WHERE current.audit_run_id = ${runId}
      AND current.audit_kind = ${auditKind}
      AND current.face_id = previous.face_id
      AND current.review_state = 'open'
  `;
};
