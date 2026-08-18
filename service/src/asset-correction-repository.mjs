import { createAssetCorrectionStore } from "./asset-corrections.mjs";
import { bridgeFields } from "./bridge-fields.mjs";

export const attachAssetCorrections = (
  repository,
  sql,
  bridge,
  presentationRank,
) => {
  const store = createAssetCorrectionStore(sql, {
    bridgeFields: (assetId) => bridgeFields(bridge, assetId),
    presentationRank,
  });
  Object.assign(repository, {
    assetCorrectionDetails: store.details,
    assetCorrectionReview: store.review,
    rotateAssets: store.rotate,
    setAssetRotations: store.setRotation,
    setAssetCaptureTime: store.setCaptureTime,
    setAssetPlace: store.setPlace,
    undoAssetCorrections: store.undo,
  });
};
