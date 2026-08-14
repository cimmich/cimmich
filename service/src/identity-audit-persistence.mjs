const numericOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);

export const persistIdentityAuditScoredRows = async (
  tx,
  { kind, packId, rows, runId },
) => {
  const eligibleQueries = Number(rows[0]?.eligible_queries || 0);
  const candidates = rows
    .filter((row) => row.face_id)
    .map((row) => ({
      asset_id: row.asset_id,
      assigned_person_id: row.assigned_person_id || null,
      comparison_score: numericOrNull(row.comparison_score),
      face_id: row.face_id,
      margin: Number(row.margin),
      suggested_person_id: row.suggested_person_id,
      suggested_reference_asset_id: row.suggested_reference_asset_id,
      suggested_score: Number(row.suggested_score),
    }));
  if (candidates.length === 0) return eligibleQueries;

  await tx`
    INSERT INTO identity_audit_item (
      audit_run_id, audit_kind, face_id, asset_id, assigned_person_id,
      suggested_person_id, suggested_score, comparison_score, margin,
      suggested_reference_asset_id
    )
    SELECT ${runId}, ${kind}, candidate.face_id, candidate.asset_id,
      candidate.assigned_person_id, candidate.suggested_person_id,
      candidate.suggested_score, candidate.comparison_score,
      candidate.margin, candidate.suggested_reference_asset_id
    FROM jsonb_to_recordset(${tx.json(candidates)}::jsonb)
      AS candidate(
        face_id text, asset_id text, assigned_person_id text,
        suggested_person_id text, suggested_score float8,
        comparison_score float8, margin float8,
        suggested_reference_asset_id text
      )
    WHERE NOT cimmich_probable_same_photo_derivative(
      ${packId}, candidate.asset_id,
      candidate.suggested_reference_asset_id
    )
  `;
  return eligibleQueries;
};
