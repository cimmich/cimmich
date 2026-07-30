import {
  boundedBacklogState,
  runBoundedBacklogWorkers,
} from "./bounded-backlog.mjs";

export const faceDetectionBacklogVersion = "cimmich.face-detection-backlog.v1";

const boundedInteger = (value, label, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Face detection backlog ${label} must be from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
};

export const runFaceDetectionBacklog = async ({
  ensureJobs,
  limitJobs,
  onProgress = () => {},
  priorityTierMax = 2,
  timeoutMs = 120_000,
  workers,
} = {}) => {
  if (typeof ensureJobs !== "function") {
    throw new Error("Face detection backlog requires a job scheduler");
  }
  if (!Array.isArray(workers) || workers.length < 1 || workers.length > 8) {
    throw new Error("Face detection backlog requires from 1 to 8 workers");
  }
  if (
    workers.some(
      (worker) =>
        !worker ||
        typeof worker.runNext !== "function" ||
        typeof worker.close !== "function",
    )
  ) {
    throw new Error("Face detection backlog workers are invalid");
  }
  const boundedLimit = boundedInteger(limitJobs, "job limit", 1, 1_000_000);
  const boundedTimeout = boundedInteger(
    timeoutMs,
    "per-job timeout",
    1_000,
    600_000,
  );
  const boundedPriorityTierMax = boundedInteger(
    priorityTierMax,
    "priority tier maximum",
    0,
    2,
  );
  const startedAt = Date.now();
  const summary = {
    attempts: 0,
    completed: 0,
    failed: 0,
    facesDetected: 0,
    imagesWithFaces: 0,
    noFace: 0,
    paused: false,
    providerProcesses: workers.length,
    retryPending: 0,
    scheduled: 0,
    schemaVersion: faceDetectionBacklogVersion,
    sourceMediaWrite: "none",
    workerFailures: [],
  };

  try {
    let scheduleBudget = boundedLimit;
    while (scheduleBudget > 0) {
      const scheduled = await ensureJobs({
        limit: Math.min(10_000, scheduleBudget),
        priorityTierMax: boundedPriorityTierMax,
      });
      const ensured = Number(scheduled?.ensuredJobs || 0);
      if (!Number.isInteger(ensured) || ensured < 0) {
        throw new Error(
          "Face detection backlog scheduler returned invalid work",
        );
      }
      if (ensured > Math.min(10_000, scheduleBudget)) {
        throw new Error("Face detection backlog scheduler exceeded its limit");
      }
      summary.scheduled += ensured;
      scheduleBudget -= ensured;
      if (ensured === 0) break;
    }

    const { paused, workerFailures } = await runBoundedBacklogWorkers({
      limit: boundedLimit,
      onProgress: () => onProgress({ ...summary }),
      runNext: (worker) =>
        worker.runNext({
          priorityTierMax: boundedPriorityTierMax,
          timeoutMs: boundedTimeout,
        }),
      tally: (result) => {
        summary.attempts += 1;
        if (result?.status === "completed") {
          summary.completed += 1;
          const inserted = Number(result?.observations?.inserted || 0);
          const reused = Number(result?.observations?.reused || 0);
          summary.facesDetected += inserted + reused;
          if (result?.outcome === "faces_detected") {
            summary.imagesWithFaces += 1;
          } else if (result?.outcome === "no_face") {
            summary.noFace += 1;
          }
        } else if (result?.state === "failed") {
          summary.failed += 1;
        } else {
          summary.retryPending += 1;
        }
      },
      workers,
    });
    summary.paused = paused;
    summary.workerFailures = workerFailures;
    summary.elapsedSeconds = Number(
      ((Date.now() - startedAt) / 1000).toFixed(3),
    );
    summary.priorityTierMax = boundedPriorityTierMax;
    summary.state = boundedBacklogState(summary);
    return summary;
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.close()));
  }
};
