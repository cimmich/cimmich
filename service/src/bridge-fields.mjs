export const bridgeFields = (bridge, assetId) => {
  const linked = bridge.get(assetId);
  return linked
    ? { filename: linked.filename, sourceAssetId: linked.sourceAssetId }
    : { filename: "", sourceAssetId: "" };
};
