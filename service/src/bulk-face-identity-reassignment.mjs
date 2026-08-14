const maximumBatchSize = 100;
const workerCount = 4;

const failureFor = (entry, error) => ({
  code: error?.code || null,
  error: String(error?.message || error).slice(0, 300),
  faceId: entry.faceId,
  index: entry.index,
  statusCode: error?.statusCode || 500,
});

const inputFor = (actorId, entry, override = {}) => {
  const input = { actorId, faceId: entry.faceId };
  for (const key of ["personId", "personName", "newPersonName"]) {
    if (Object.hasOwn(entry.item, key)) input[key] = entry.item[key];
  }
  return Object.assign(input, override);
};

const runWorkers = async (entries, run) => {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(workerCount, entries.length) }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor];
        cursor += 1;
        await run(entry);
      }
    }),
  );
};

export const bulkReassignFaceIdentities = async ({
  actorId,
  items,
  reassign,
}) => {
  if (!Array.isArray(items)) {
    throw Object.assign(new Error("items must be an array"), {
      statusCode: 400,
    });
  }
  if (items.length === 0) {
    throw Object.assign(new Error("Select at least one Face"), {
      statusCode: 400,
    });
  }
  if (items.length > maximumBatchSize) {
    throw Object.assign(
      new Error(`Assign no more than ${maximumBatchSize} Faces at once`),
      { statusCode: 400 },
    );
  }

  const seenFaceIds = new Set();
  const entries = items.map((item, index) => {
    const faceId = String(item?.faceId || "").trim();
    if (!faceId) {
      throw Object.assign(new Error("Every item requires a faceId"), {
        statusCode: 400,
      });
    }
    if (seenFaceIds.has(faceId)) {
      throw Object.assign(
        new Error("Selection contains the same Face more than once"),
        { details: { faceId }, statusCode: 409 },
      );
    }
    seenFaceIds.add(faceId);
    return { faceId, index, item };
  });

  const assigned = [];
  const failures = [];
  const deferred = entries.filter(
    ({ item }) => !String(item?.newPersonName || "").trim(),
  );
  const newPersonGroups = new Map();
  for (const entry of entries.filter(({ item }) =>
    String(item?.newPersonName || "").trim(),
  )) {
    const key = String(entry.item.newPersonName).trim().toLowerCase();
    const group = newPersonGroups.get(key) || [];
    group.push(entry);
    newPersonGroups.set(key, group);
  }

  const record = async (entry, input) => {
    try {
      assigned.push({ index: entry.index, result: await reassign(input) });
      return assigned.at(-1).result;
    } catch (error) {
      failures.push(failureFor(entry, error));
      return null;
    }
  };

  // The first successful Face for each new name creates exactly one Person.
  // Later Faces can then use that Person ID in the bounded worker pool.
  for (const group of newPersonGroups.values()) {
    let target = null;
    let cursor = 0;
    while (!target && cursor < group.length) {
      const entry = group[cursor];
      cursor += 1;
      target = await record(entry, inputFor(actorId, entry));
    }
    if (target) {
      for (const entry of group.slice(cursor)) {
        deferred.push({ ...entry, targetPersonId: target.personId });
      }
    }
  }

  await runWorkers(deferred, async (entry) => {
    const override = entry.targetPersonId
      ? { newPersonName: undefined, personId: entry.targetPersonId }
      : {};
    const input = inputFor(actorId, entry, override);
    if (entry.targetPersonId) delete input.newPersonName;
    await record(entry, input);
  });

  assigned.sort((left, right) => left.index - right.index);
  failures.sort((left, right) => left.index - right.index);
  const results = assigned.map(({ result }) => result);
  return {
    assigned: results,
    assignedCount: results.length,
    changed: results.some((result) => result.changed),
    failureCount: failures.length,
    failures: failures.map(({ index: _, ...failure }) => failure),
  };
};
