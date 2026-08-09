const invalidDecision = () =>
  Object.assign(new Error("Identity audit decision is incomplete"), {
    code: "IDENTITY_AUDIT_DECISION_INVALID",
    statusCode: 400,
  });

export const createIdentityAuditDecisions = ({
  cleanKind,
  reconcileInterruptedRun,
  schemaVersion,
  sql,
}) => {
  const dismiss = async ({ actorId, faceId, kind } = {}) => {
    await reconcileInterruptedRun();
    const actor = String(actorId || "")
      .trim()
      .slice(0, 120);
    const exactFaceId = String(faceId || "").trim();
    const auditKind = cleanKind(kind);
    if (!actor || !exactFaceId) throw invalidDecision();
    const rows = await sql`
      WITH target AS MATERIALIZED (
        SELECT selected.audit_run_id, selected.suggested_person_id,
          selected.physical_face_id
        FROM current_physical_identity_audit_item selected
        JOIN identity_audit_run selected_run
          ON selected_run.audit_run_id = selected.audit_run_id
          AND selected_run.state = 'completed'
        WHERE selected.audit_run_id = (
            SELECT latest.audit_run_id
            FROM identity_audit_run latest
            WHERE latest.state = 'completed'
            ORDER BY latest.started_at DESC, latest.audit_run_id DESC
            LIMIT 1
          )
          AND selected.audit_kind = ${auditKind}
          AND selected.face_id = ${exactFaceId}
        LIMIT 1
      )
      UPDATE identity_audit_item item
      SET review_state = 'dismissed', reviewed_at = now(),
        reviewed_by = ${actor}
      FROM target
      JOIN current_face_physical_member member
        ON member.physical_face_id = target.physical_face_id
      WHERE item.audit_run_id = target.audit_run_id
        AND item.audit_kind = ${auditKind}
        AND item.face_id = member.face_id
        AND item.suggested_person_id = target.suggested_person_id
        AND item.review_state = 'open'
      RETURNING item.face_id
    `;
    return {
      changed: rows.length > 0,
      faceId: exactFaceId,
      kind: auditKind,
      schemaVersion,
      state: rows.length > 0 ? "dismissed" : "unchanged",
    };
  };

  const dismissBatch = async ({ actorId, items: inputItems } = {}) => {
    if (!Array.isArray(inputItems) || inputItems.length === 0) {
      throw invalidDecision();
    }
    if (inputItems.length > 100) {
      throw Object.assign(
        new Error("Dismiss no more than 100 audit items at once"),
        { code: "IDENTITY_AUDIT_DECISION_INVALID", statusCode: 400 },
      );
    }
    const actor = String(actorId || "")
      .trim()
      .slice(0, 120);
    const cleanItems = inputItems.map((item) => ({
      faceId: String(item?.faceId || "").trim(),
      kind: cleanKind(item?.kind),
    }));
    if (!actor || cleanItems.some((item) => !item.faceId)) {
      throw invalidDecision();
    }
    await reconcileInterruptedRun();
    // One transaction and one completed run keep a batch from splitting across
    // audit snapshots or leaving a partial physical-Face dismissal.
    const results = await sql.begin(async (tx) => {
      const [run] = await tx`
        SELECT audit_run_id FROM identity_audit_run
        WHERE state = 'completed'
        ORDER BY started_at DESC, audit_run_id DESC
        LIMIT 1
      `;
      const outcomes = [];
      for (const item of cleanItems) {
        const rows = run
          ? await tx`
              WITH target AS MATERIALIZED (
                SELECT selected.suggested_person_id,
                  selected.physical_face_id
                FROM current_physical_identity_audit_item selected
                WHERE selected.audit_run_id = ${run.audit_run_id}
                  AND selected.audit_kind = ${item.kind}
                  AND selected.face_id = ${item.faceId}
                LIMIT 1
              )
              UPDATE identity_audit_item
              SET review_state = 'dismissed', reviewed_at = now(),
                reviewed_by = ${actor}
              FROM target
              JOIN current_face_physical_member member
                ON member.physical_face_id = target.physical_face_id
              WHERE identity_audit_item.audit_run_id = ${run.audit_run_id}
                AND audit_kind = ${item.kind}
                AND identity_audit_item.face_id = member.face_id
                AND identity_audit_item.suggested_person_id =
                  target.suggested_person_id
                AND review_state = 'open'
              RETURNING identity_audit_item.face_id
            `
          : [];
        outcomes.push({
          changed: rows.length > 0,
          faceId: item.faceId,
          kind: item.kind,
          schemaVersion,
          state: rows.length > 0 ? "dismissed" : "unchanged",
        });
      }
      return outcomes;
    });
    return {
      changed: results.some((result) => result.changed),
      dismissedCount: results.filter((result) => result.changed).length,
      items: results,
      schemaVersion,
    };
  };

  return { dismiss, dismissBatch };
};
