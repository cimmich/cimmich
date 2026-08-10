import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
import { request } from './cimmich.service';

export type CimmichAssetLabel = {
  assetCount: number;
  createdAt: string;
  displayName: string;
  labelId: string;
  schemaVersion: 'cimmich.asset-labels.v1';
  status: 'active' | 'retired';
};

export type CimmichAssetLabelMembershipResult = {
  action?: 'attach' | 'detach';
  changed: boolean;
  changedAssetIds: string[];
  decisionId: string;
  labelId: string;
  schemaVersion: 'cimmich.asset-labels.v1';
  skippedAssetIds?: string[];
  unchangedAssetIds?: string[];
  undidDecisionId?: string;
};

export const createCimmichAssetLabelCommandId = (kind: string) =>
  `asset-label.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 24)}.${createCimmichUuid()}`;

export const getCimmichAssetLabels = async (query = '', limit = 250) => {
  const search = new URLSearchParams({ limit: String(Math.max(1, Math.min(250, limit))) });
  if (query.trim()) {
    search.set('q', query.trim());
  }
  const result = await request<{ items: CimmichAssetLabel[]; schemaVersion: 'cimmich.asset-labels.v1' }>(
    `/v1/asset-labels?${search.toString()}`,
  );
  return result.items;
};

export const createCimmichAssetLabel = (displayName: string, commandId = createCimmichAssetLabelCommandId('create')) =>
  request<{ changed: boolean; label: CimmichAssetLabel; schemaVersion: 'cimmich.asset-labels.v1' }>(
    '/v1/asset-labels',
    {
      body: JSON.stringify({ commandId, displayName }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const changeCimmichAssetLabelMembership = (
  labelId: string,
  action: 'attach' | 'detach',
  assetIds: string[],
  commandId = createCimmichAssetLabelCommandId(action),
) =>
  request<CimmichAssetLabelMembershipResult>(`/v1/asset-labels/${encodeURIComponent(labelId)}/assets:${action}`, {
    body: JSON.stringify({ assetIds, commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichAssetLabelDecision = (
  decisionId: string,
  commandId = createCimmichAssetLabelCommandId('undo'),
) =>
  request<CimmichAssetLabelMembershipResult>(`/v1/asset-label-decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });
