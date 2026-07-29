// Shared bounded worker-pool driver for the detection backlog runs. The face
// and body drivers must classify the run's end the same way:
// - an operator pause ends the run and is reported as state "paused", never
//   silently folded into a clean bounded_run_complete;
// - one crashed worker must not discard the whole-run summary the surviving
//   workers produced — the run settles every worker and reports the failures
//   inside a partial summary instead of rejecting.

export const runBoundedBacklogWorkers = async ({
  limit,
  onProgress = () => {},
  runNext,
  tally,
  workers,
}) => {
  let issued = 0;
  let paused = false;
  const runWorker = async (worker) => {
    while (issued < limit) {
      issued += 1;
      const result = await runNext(worker);
      if (result?.state === "idle") return;
      if (result?.state === "paused") {
        paused = true;
        return;
      }
      tally(result);
      await onProgress();
    }
  };
  const settled = await Promise.allSettled(workers.map(runWorker));
  const workerFailures = settled
    .filter((outcome) => outcome.status === "rejected")
    .map((outcome) =>
      String(
        outcome.reason?.code ||
          outcome.reason?.message ||
          outcome.reason ||
          "BACKLOG_WORKER_FAILED",
      ).slice(0, 200),
    );
  return { paused, workerFailures };
};

export const boundedBacklogState = ({
  failed,
  paused,
  retryPending,
  workerFailures,
}) =>
  paused
    ? "paused"
    : failed > 0 || workerFailures.length > 0
      ? "bounded_run_complete_with_failures"
      : retryPending > 0
        ? "bounded_run_complete_with_retries"
        : "bounded_run_complete";
