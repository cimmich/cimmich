import type { AssetVisibility } from '@immich/sdk';
import type { CimmichContextFamily, CimmichVisibilityTier } from '$lib/services/cimmich.service';

export const ENTITY_MEDIA_SELECTION_LIMIT = 100;
export const ENTITY_MEDIA_ACTION_RECEIPT_KEY = 'cimmich.entity-media-action.receipt.v1';

export type CimmichEntityMediaItem = {
  assetId: string;
  directlyAssigned?: boolean;
  filename: string;
  sourceAssetId: string;
};

export type CimmichEntityMediaScope = {
  displayName: string;
  entityId: string;
  family: CimmichContextFamily;
};

export type CimmichEntityMediaSubject = {
  displayName: string;
  subjectId: string;
  subjectKind: 'person' | 'pet';
};

export type CimmichEntityMediaPlaceTarget = {
  depth: number;
  entityId: string;
  label: string;
  path: string;
};

export type CimmichEntityMediaActionKind =
  | 'album-add'
  | 'archive'
  | 'context-detach'
  | 'event-attach'
  | 'favorite'
  | 'object-attach'
  | 'place-attach'
  | 'presence-current'
  | 'presence-person'
  | 'presence-pet'
  | 'tag-add'
  | 'tag-remove'
  | 'unarchive'
  | 'unfavorite'
  | 'visibility-personal'
  | 'visibility-private'
  | 'visibility-standard';

export type CimmichEntityMediaActionReceipt = {
  action: CimmichEntityMediaActionKind;
  albumId: string;
  assetIds: string[];
  completedAt: string;
  contextDecisionIds: string[];
  label: string;
  nativePrevious: Array<{
    id: string;
    isFavorite: boolean;
    visibility: AssetVisibility;
  }>;
  presenceDecisionIds: string[];
  sourceAssetIds: string[];
  tagId: string;
  targetId: string;
  version: 1;
  visibilityDecisionIds: string[];
};

const actions = new Set<CimmichEntityMediaActionKind>([
  'album-add',
  'archive',
  'context-detach',
  'event-attach',
  'favorite',
  'object-attach',
  'place-attach',
  'presence-current',
  'presence-person',
  'presence-pet',
  'tag-add',
  'tag-remove',
  'unarchive',
  'unfavorite',
  'visibility-personal',
  'visibility-private',
  'visibility-standard',
]);

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const isCimmichEntityMediaActionReceipt = (value: unknown): value is CimmichEntityMediaActionReceipt => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const receipt = value as Record<string, unknown>;
  return (
    receipt.version === 1 &&
    actions.has(receipt.action as CimmichEntityMediaActionKind) &&
    typeof receipt.albumId === 'string' &&
    stringArray(receipt.assetIds) &&
    typeof receipt.completedAt === 'string' &&
    Number.isFinite(Date.parse(receipt.completedAt)) &&
    stringArray(receipt.contextDecisionIds) &&
    typeof receipt.label === 'string' &&
    Array.isArray(receipt.nativePrevious) &&
    receipt.nativePrevious.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).isFavorite === 'boolean' &&
        typeof (item as Record<string, unknown>).visibility === 'string',
    ) &&
    stringArray(receipt.presenceDecisionIds) &&
    stringArray(receipt.sourceAssetIds) &&
    typeof receipt.tagId === 'string' &&
    typeof receipt.targetId === 'string' &&
    stringArray(receipt.visibilityDecisionIds)
  );
};

export const loadCimmichEntityMediaActionReceipt = (
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
): CimmichEntityMediaActionReceipt | null => {
  try {
    const serialized = storage.getItem(ENTITY_MEDIA_ACTION_RECEIPT_KEY);
    if (!serialized) {
      return null;
    }
    const parsed: unknown = JSON.parse(serialized);
    if (isCimmichEntityMediaActionReceipt(parsed)) {
      return parsed;
    }
    storage.removeItem(ENTITY_MEDIA_ACTION_RECEIPT_KEY);
  } catch {
    storage.removeItem(ENTITY_MEDIA_ACTION_RECEIPT_KEY);
  }
  return null;
};

export const saveCimmichEntityMediaActionReceipt = (
  storage: Pick<Storage, 'removeItem' | 'setItem'>,
  receipt: CimmichEntityMediaActionReceipt | null,
) => {
  try {
    if (receipt) {
      storage.setItem(ENTITY_MEDIA_ACTION_RECEIPT_KEY, JSON.stringify(receipt));
    } else {
      storage.removeItem(ENTITY_MEDIA_ACTION_RECEIPT_KEY);
    }
  } catch {
    // The in-memory receipt remains available when browser storage is blocked.
  }
};

export const cimmichEntityMediaActionNeedsTarget = (action: CimmichEntityMediaActionKind) =>
  [
    'album-add',
    'event-attach',
    'object-attach',
    'place-attach',
    'presence-person',
    'presence-pet',
    'tag-add',
    'tag-remove',
  ].includes(action);

export const cimmichEntityMediaActionVisibilityTier = (
  action: CimmichEntityMediaActionKind,
): CimmichVisibilityTier | null =>
  action.startsWith('visibility-') ? (action.replace('visibility-', '') as CimmichVisibilityTier) : null;

export const cimmichEntityMediaActionLabel = (
  action: CimmichEntityMediaActionKind,
  currentSubject?: CimmichEntityMediaSubject | null,
  currentScope?: CimmichEntityMediaScope | null,
) =>
  ({
    'album-add': 'Add to album',
    archive: 'Archive',
    'context-detach': `Remove from ${currentScope?.displayName || 'this page'}`,
    'event-attach': 'Add to Event',
    favorite: 'Favourite',
    'object-attach': 'Mark Thing depicted',
    'place-attach': 'Add to Place',
    'presence-current': `Mark ${currentSubject?.displayName || 'subject'} present`,
    'presence-person': 'Mark Person present',
    'presence-pet': 'Mark Pet present',
    'tag-add': 'Add tag',
    'tag-remove': 'Remove tag',
    unarchive: 'Unarchive',
    unfavorite: 'Remove favourite',
    'visibility-personal': 'Set photo privacy to Personal',
    'visibility-private': 'Set photo privacy to Private',
    'visibility-standard': 'Set photo privacy to Standard',
  })[action];

export const selectCimmichEntityMediaItems = (items: CimmichEntityMediaItem[]) => ({
  capped: items.length > ENTITY_MEDIA_SELECTION_LIMIT,
  items: items.slice(0, ENTITY_MEDIA_SELECTION_LIMIT),
});
