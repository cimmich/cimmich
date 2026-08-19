import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
import { request } from './cimmich.service';

export type CimmichBulkAlbumCheckpoint = {
  albumCreated: boolean;
  albumId: string;
  albumName: string;
  assetIds: string[];
  batchSequence: number;
  checkpointId: string;
  organizationDecisionId: string | null;
  sourcePath: string;
  state: 'applied' | 'undone';
};

export type CimmichBulkAlbumOperation = {
  albumCount: number;
  assetCount: number;
  checkpoints: CimmichBulkAlbumCheckpoint[];
  completedAt: string | null;
  createdAt: string;
  manifest: Array<{ assetCount: number; sourcePath: string; title: string }>;
  operationId: string;
  schemaVersion: 'cimmich.bulk-album-operation.v2';
  snapshotDigest: string;
  sourcePath: string;
  state: 'applying' | 'applied' | 'partial' | 'undoing' | 'undone' | 'kept';
  updatedAt: string;
};

export const createCimmichBulkAlbumCommandId = (kind: string) =>
  `bulk-album.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 24)}.${createCimmichUuid()}`;

export const getActiveCimmichBulkAlbumOperation = async () => {
  const result = await request<
    CimmichBulkAlbumOperation | { operation: null; schemaVersion: 'cimmich.bulk-album-operation.v2' }
  >('/v1/bulk-album-operations/active');
  return 'operation' in result ? null : result;
};

export const createCimmichBulkAlbumOperation = (input: {
  manifest: Array<{ assetCount: number; sourcePath: string; title: string }>;
  operationId: string;
  snapshotDigest: string;
  sourcePath: string;
}) =>
  request<CimmichBulkAlbumOperation>('/v1/bulk-album-operations', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const checkpointCimmichBulkAlbumOperation = (
  operationId: string,
  input: {
    albumCreated: boolean;
    albumId: string;
    albumName: string;
    assetIds: string[];
    batchSequence: number;
    commandId: string;
    organizationDecisionId?: string | null;
    sourcePath: string;
  },
) =>
  request<CimmichBulkAlbumCheckpoint & { schemaVersion: 'cimmich.bulk-album-operation.v2' }>(
    `/v1/bulk-album-operations/${encodeURIComponent(operationId)}/checkpoints`,
    {
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const setCimmichBulkAlbumOperationState = (
  operationId: string,
  state: CimmichBulkAlbumOperation['state'],
  commandId = createCimmichBulkAlbumCommandId(state),
) =>
  request<{ operationId: string; schemaVersion: 'cimmich.bulk-album-operation.v2'; state: string }>(
    `/v1/bulk-album-operations/${encodeURIComponent(operationId)}`,
    {
      body: JSON.stringify({ commandId, state }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'PATCH',
    },
  );

export const undoCimmichBulkAlbumCheckpoint = (
  checkpointId: string,
  commandId = createCimmichBulkAlbumCommandId('checkpoint-undo'),
) =>
  request<{
    changed: boolean;
    checkpointId: string;
    operationId: string;
    schemaVersion: 'cimmich.bulk-album-operation.v2';
    state: 'undone';
  }>(`/v1/bulk-album-operations/checkpoints/${encodeURIComponent(checkpointId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });
