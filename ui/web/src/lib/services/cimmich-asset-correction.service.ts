import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
import { request } from './cimmich.service';

export type CimmichAssetCorrectionDetails = {
  assetId: string;
  captureTime: string | null;
  captureTimeProvenance: 'manual_correction' | 'source_metadata';
  correctionDecisionIds: string[];
  filename: string;
  location: null | {
    entityId: string;
    label: string;
    provenance: 'cimmich_place' | 'manual_correction';
  };
  originalCaptureTime: string | null;
  rotationDecisionId: string | null;
  rotationQuarterTurns: number;
  schemaVersion: 'cimmich.asset-correction.v1';
  sourceAssetId: string;
};

export type CimmichAssetCorrectionResult = {
  changed: boolean;
  decisionIds?: string[];
  direction?: 'left' | 'right';
  item?: CimmichAssetCorrectionDetails;
  items?: CimmichAssetCorrectionDetails[];
  replayed: boolean;
  schemaVersion: 'cimmich.asset-correction.v1';
  undoDecisionIds?: string[];
};

export type CimmichPhotoDetailReviewItem = CimmichAssetCorrectionDetails & {
  confidenceSignal: number;
  reason:
    | 'future_capture_time'
    | 'immich_visual_rotation_candidate'
    | 'likely_sideways_face'
    | 'multiple_current_places';
};

export type CimmichPhotoDetailReviewPage = {
  items: CimmichPhotoDetailReviewItem[];
  kind: 'dates' | 'locations' | 'orientation';
  limit: number;
  offset: number;
  schemaVersion: 'cimmich.asset-correction.v1';
};

export const createCimmichAssetCorrectionCommandId = (kind: string) =>
  `asset-correction.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 18)}.${createCimmichUuid()}`;

export const getCimmichAssetCorrections = (assetIds: string[]) =>
  request<{ items: CimmichAssetCorrectionDetails[]; schemaVersion: 'cimmich.asset-correction.v1' }>(
    '/v1/assets/corrections:batch',
    { body: JSON.stringify({ assetIds }), method: 'POST' },
  );

export const getCimmichAssetCorrectionForSource = async (sourceAssetId: string) => {
  const display = await request<{ assetId: string }>(
    `/v1/assets/display?sourceAssetId=${encodeURIComponent(sourceAssetId)}`,
  );
  const response = await getCimmichAssetCorrections([display.assetId]);
  return response.items[0] ?? null;
};

export const rotateCimmichAssets = (
  assetIds: string[],
  direction: 'left' | 'right',
  commandId = createCimmichAssetCorrectionCommandId(`rotate-${direction}`),
) =>
  request<CimmichAssetCorrectionResult>('/v1/assets/corrections/rotation', {
    body: JSON.stringify({ assetIds, commandId, direction }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichAssetCaptureTime = (
  assetId: string,
  captureTime: string,
  commandId = createCimmichAssetCorrectionCommandId('capture-time'),
) =>
  request<CimmichAssetCorrectionResult>(`/v1/assets/${encodeURIComponent(assetId)}/corrections/capture-time`, {
    body: JSON.stringify({ captureTime, commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichAssetPlace = (
  assetId: string,
  placeEntityId: string,
  commandId = createCimmichAssetCorrectionCommandId('place'),
) =>
  request<CimmichAssetCorrectionResult>(`/v1/assets/${encodeURIComponent(assetId)}/corrections/place`, {
    body: JSON.stringify({ commandId, placeEntityId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichAssetCorrections = (
  decisionIds: string[],
  commandId = createCimmichAssetCorrectionCommandId('undo'),
) =>
  request<CimmichAssetCorrectionResult>('/v1/assets/corrections/undo', {
    body: JSON.stringify({ commandId, decisionIds }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichPhotoDetailReview = (kind: CimmichPhotoDetailReviewPage['kind'], limit = 50, offset = 0) =>
  request<CimmichPhotoDetailReviewPage>(
    `/v1/review/photo-details?kind=${kind}&limit=${Math.max(1, Math.min(100, limit))}&offset=${Math.max(0, offset)}`,
  );
