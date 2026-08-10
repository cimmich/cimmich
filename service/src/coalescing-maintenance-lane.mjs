const cleanPriority = (value) => {
  const priority = Number(value);
  return Number.isFinite(priority) ? priority : 0;
};

export const createCoalescingMaintenanceLane = ({
  concurrency = 1,
  name,
  onEvent = () => {},
  worker,
}) => {
  if (typeof worker !== "function") {
    throw new Error("Maintenance lane requires a worker");
  }
  const maximumConcurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
  const jobs = new Map();
  const pending = [];
  const idleWaiters = new Set();
  let active = 0;
  let drainScheduled = false;
  let completed = 0;
  let failed = 0;
  let coalesced = 0;

  const snapshot = () => ({
    active,
    coalesced,
    completed,
    failed,
    name,
    pending: pending.length,
    tracked: jobs.size,
  });

  const settleIdle = () => {
    if (active > 0 || pending.length > 0 || jobs.size > 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const nextJob = () => {
    pending.sort(
      (left, right) =>
        right.priority - left.priority || left.requestedAt - right.requestedAt,
    );
    return pending.shift();
  };

  const queueDrain = () => {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      drain();
    });
  };

  const run = async (job) => {
    active += 1;
    job.state = "running";
    job.dirty = false;
    const startedAt = performance.now();
    const queueAgeMs = Date.now() - job.requestedAt;
    try {
      await worker(job.key);
      completed += 1;
      onEvent({
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        key: job.key,
        kind: "completed",
        name,
        queueAgeMs,
        requestCount: job.requestCount,
      });
    } catch (error) {
      failed += 1;
      onEvent({
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        error: error instanceof Error ? error.message : String(error),
        key: job.key,
        kind: "failed",
        name,
        queueAgeMs,
        requestCount: job.requestCount,
      });
    } finally {
      active -= 1;
      if (job.dirty) {
        job.requestedAt = Date.now();
        job.state = "queued";
        pending.push(job);
      } else {
        jobs.delete(job.key);
      }
      queueDrain();
      settleIdle();
    }
  };

  function drain() {
    while (active < maximumConcurrency && pending.length > 0) {
      const job = nextJob();
      void run(job);
    }
    settleIdle();
  }

  const schedule = (rawKey, { priority = 0 } = {}) => {
    const key = String(rawKey || "").trim();
    if (!key) return false;
    const existing = jobs.get(key);
    if (existing) {
      existing.priority = Math.max(existing.priority, cleanPriority(priority));
      existing.requestCount += 1;
      if (existing.state === "running") existing.dirty = true;
      coalesced += 1;
      onEvent({
        key,
        kind: "coalesced",
        name,
        requestCount: existing.requestCount,
        state: existing.state,
      });
      return true;
    }
    const job = {
      dirty: false,
      key,
      priority: cleanPriority(priority),
      requestedAt: Date.now(),
      requestCount: 1,
      state: "queued",
    };
    jobs.set(key, job);
    pending.push(job);
    queueDrain();
    return true;
  };

  const whenIdle = () => {
    if (active === 0 && pending.length === 0 && jobs.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => idleWaiters.add(resolve));
  };

  return { schedule, snapshot, whenIdle };
};
