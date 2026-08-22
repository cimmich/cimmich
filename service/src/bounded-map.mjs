export const mapWithConcurrency = async (items, concurrency, project) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await project(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};
