export const filterVisibleCimmichAssets = async <Asset extends { id: string }>(
  assets: Asset[],
  canRead: (sourceAssetId: string) => Promise<unknown>,
  concurrency = 8,
) => {
  const visible = Array.from<boolean>({ length: assets.length }).fill(false);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < assets.length) {
      const index = nextIndex++;
      try {
        await canRead(assets[index].id);
        visible[index] = true;
      } catch {
        // An unavailable asset is intentionally omitted. Its identity and
        // metadata must not leak through a picker in the current view.
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), assets.length) }, () => worker()));
  return assets.filter((_, index) => visible[index]);
};
