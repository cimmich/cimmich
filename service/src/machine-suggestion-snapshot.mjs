const snapshotTtlMs = 15 * 60 * 1000;
const refreshRetryMs = 30 * 1000;

export const createMachineSuggestionSnapshot = () => {
  let cache = null;
  let epoch = 0;

  const invalidate = () => {
    epoch += 1;
    // Explicit identity decisions are stronger than ordinary TTL expiry: the
    // next review read must not project the invalidated result even once.
    cache = null;
  };

  const peek = ({ visibleRank }) => {
    if (
      !cache?.settled ||
      cache.visibleRank !== visibleRank ||
      cache.expiresAt <= Date.now() ||
      !Array.isArray(cache.result)
    ) {
      return null;
    }
    return cache.result;
  };

  const read = async ({ load, project, visibleRank }) => {
    if (cache?.visibleRank === visibleRank && cache.expiresAt > Date.now()) {
      return project(await cache.promise);
    }

    const stale = cache;
    if (
      stale?.settled &&
      stale.visibleRank === visibleRank &&
      Array.isArray(stale.result)
    ) {
      if (!stale.refreshPromise) {
        const refreshEpoch = epoch;
        stale.refreshPromise = load()
          .then((result) => {
            if (cache !== stale) return result;
            stale.epoch = refreshEpoch;
            stale.expiresAt =
              refreshEpoch === epoch ? Date.now() + snapshotTtlMs : 0;
            stale.promise = Promise.resolve(result);
            stale.result = result;
            return result;
          })
          .catch(() => {
            if (cache === stale) {
              // A failed refresh never turns a working review surface into a
              // timeout loop. Retry soon while retaining the last proof.
              stale.expiresAt = Date.now() + refreshRetryMs;
            }
            return stale.result;
          })
          .finally(() => {
            if (cache === stale) stale.refreshPromise = null;
          });
      }
      return project(stale.result);
    }

    const entry = {
      epoch,
      expiresAt: Number.POSITIVE_INFINITY,
      promise: null,
      refreshPromise: null,
      result: null,
      settled: false,
      visibleRank,
    };
    entry.promise = load()
      .then((result) => {
        entry.result = result;
        entry.settled = true;
        entry.expiresAt =
          entry.epoch === epoch ? Date.now() + snapshotTtlMs : 0;
        return result;
      })
      .catch((error) => {
        if (cache === entry) cache = null;
        throw error;
      });
    cache = entry;
    return project(await entry.promise);
  };

  return { invalidate, peek, read };
};
