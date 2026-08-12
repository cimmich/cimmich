export const projectIdentityAuditRun = (
  row,
  currentPackId,
  { defaultIndependenceScoreFloor, defaultQueryFrontierLimit, schemaVersion },
) => {
  if (!row) return null;
  const queryFrontierLimit = Number(
    row.query_frontier_limit ?? defaultQueryFrontierLimit,
  );
  const untaggedQueriesEligible = Number(row.untagged_queries_eligible || 0);
  const contradictionQueriesEligible = Number(
    row.contradiction_queries_eligible || 0,
  );
  const independenceCandidatesEligible = Number(
    row.independence_candidates_eligible || 0,
  );
  const independenceCandidatesVerified = Number(
    row.independence_candidates_verified || 0,
  );
  return {
    acceptedComparableFaces: Number(row.accepted_comparable_faces || 0),
    acceptedEmbeddedFaces: Number(row.accepted_embedded_faces || 0),
    auditRunId: row.audit_run_id,
    completedAt: row.completed_at || null,
    contradictionCandidates: Number(row.contradiction_candidates || 0),
    contradictionQueriesEligible,
    derivativeCandidatesSuppressed: Number(
      row.derivative_candidates_suppressed || 0,
    ),
    errorCode: row.error_code || null,
    independenceCandidatesEligible,
    independenceCandidatesVerified,
    independenceComparisonLimit:
      row.independence_comparison_limit == null
        ? null
        : Number(row.independence_comparison_limit),
    independenceProviderConfigDigest:
      row.independence_provider_config_digest || null,
    independenceScoreFloor: Number(
      row.independence_score_floor ?? defaultIndependenceScoreFloor,
    ),
    independenceVerificationTruncated:
      independenceCandidatesVerified < independenceCandidatesEligible,
    marginFloor: Number(row.margin_floor),
    packId: row.pack_id,
    policyVersion: row.policy_version,
    queryFrontierLimit,
    queryFrontierTruncated:
      untaggedQueriesEligible > queryFrontierLimit ||
      contradictionQueriesEligible > queryFrontierLimit,
    schemaVersion,
    scoreFloor: Number(row.score_floor),
    stale: row.state === "completed" && currentPackId !== row.pack_id,
    startedAt: row.started_at,
    state: row.state,
    truncationProjectionComplete: Boolean(row.truncation_projection_complete),
    untaggedCandidates: Number(row.untagged_candidates || 0),
    untaggedEmbeddedFaces: Number(row.untagged_embedded_faces || 0),
    untaggedQueriesEligible,
  };
};
