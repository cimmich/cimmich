export const identityAuditConfidenceBand = (score) =>
  Number(score) >= 0.75 ? "high" : Number(score) >= 0.6 ? "medium" : "low";
