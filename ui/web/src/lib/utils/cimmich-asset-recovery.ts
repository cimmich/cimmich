export const cimmichAssetRecoveryHref = ({
  currentSourceAssetId,
  resolvedSourceAssetId,
  url,
}: {
  currentSourceAssetId: string;
  resolvedSourceAssetId: string;
  url: URL;
}) => {
  const currentId = currentSourceAssetId.trim();
  const resolvedId = resolvedSourceAssetId.trim();
  if (!currentId || !resolvedId || currentId === resolvedId) {
    return null;
  }
  const target = new URL(url);
  target.pathname = `/photos/${encodeURIComponent(resolvedId)}`;
  return `${target.pathname}${target.search}${target.hash}`;
};
