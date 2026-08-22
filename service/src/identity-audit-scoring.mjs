// The reference host has eight physical cores. PostgreSQL's parallel planner left the vector
// aggregation leader-bound even when it launched workers, so score the stable
// deterministic frontier through six independent connections. Each shard is
// deliberately serial: six real query leaders leave two host cores available
// for interactive reads and the rest of the stack.
export const identityAuditScoringConcurrency = 6;

export const reportIdentityAuditFrontierTruncation = ({
  auditKind,
  eligibleQueries,
  frontierLimit,
  runId,
}) => {
  if (eligibleQueries <= frontierLimit) return;
  console.warn(
    JSON.stringify({
      auditKind,
      code: "IDENTITY_AUDIT_QUERY_FRONTIER_TRUNCATED",
      eligibleQueries,
      queryFrontierLimit: frontierLimit,
      runId,
    }),
  );
};

export const scoreIdentityAuditShards = async (
  sql,
  { statementTimeoutMs, transactionTimeoutMs },
  scoreShard,
) => {
  const shards = await Promise.all(
    Array.from({ length: identityAuditScoringConcurrency }, (_, shardIndex) =>
      sql.begin(async (tx) => {
        await tx`
          SELECT set_config('statement_timeout',
              ${String(statementTimeoutMs)}, true),
            set_config('transaction_timeout',
              ${String(transactionTimeoutMs)}, true),
            set_config('max_parallel_workers_per_gather', '0', true)
        `;
        return scoreShard(tx, shardIndex);
      }),
    ),
  );
  return shards.flat();
};
