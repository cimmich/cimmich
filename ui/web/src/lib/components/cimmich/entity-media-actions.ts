import {
  mdiAccountMultipleOutline,
  mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline,
  mdiCalendarBlankOutline,
  mdiHeartOutline,
  mdiImageAlbum,
  mdiLinkOff,
  mdiLockOutline,
  mdiMapMarkerOutline,
  mdiPackageVariantClosed,
  mdiPawOutline,
  mdiRotateLeft,
  mdiRotateRight,
  mdiTagOutline,
} from '@mdi/js';
import type { CimmichContextFamily, CimmichVisibilityTier } from '$lib/services/cimmich.service';
import { CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY } from './cimmich-undo-receipt-context.svelte';
import {
  loadPersistedUndoReceipt,
  savePersistedUndoReceipt,
  type CimmichUndoReceiptContext,
} from './persisted-undo-receipt';

export const ENTITY_MEDIA_SELECTION_LIMIT = 100;
export const ENTITY_MEDIA_ACTION_RECEIPT_KEY = CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY;

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
  | 'rotate-left'
  | 'rotate-right'
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

export const CIMMICH_ENTITY_MEDIA_ACTION_GROUPS = [
  {
    actions: ['presence-current', 'presence-person', 'presence-pet'],
    icon: mdiAccountMultipleOutline,
    id: 'presence',
    label: 'People & pets',
  },
  {
    actions: ['visibility-standard', 'visibility-personal', 'visibility-private'],
    icon: mdiLockOutline,
    id: 'privacy',
    label: 'Privacy',
  },
  {
    actions: ['rotate-left', 'rotate-right', 'tag-add', 'tag-remove', 'album-add'],
    icon: mdiTagOutline,
    id: 'metadata',
    label: 'Photo details',
  },
  {
    actions: ['favorite', 'unfavorite', 'archive', 'unarchive'],
    icon: mdiImageAlbum,
    id: 'library',
    label: 'Library',
  },
] as const;

export const cimmichEntityMediaActionIcon = (
  action: CimmichEntityMediaActionKind,
  currentSubject?: CimmichEntityMediaSubject | null,
) =>
  ({
    'album-add': mdiImageAlbum,
    archive: mdiArchiveArrowDownOutline,
    'context-detach': mdiLinkOff,
    'event-attach': mdiCalendarBlankOutline,
    favorite: mdiHeartOutline,
    'object-attach': mdiPackageVariantClosed,
    'place-attach': mdiMapMarkerOutline,
    'presence-current': currentSubject?.subjectKind === 'pet' ? mdiPawOutline : mdiAccountMultipleOutline,
    'presence-person': mdiAccountMultipleOutline,
    'presence-pet': mdiPawOutline,
    'rotate-left': mdiRotateLeft,
    'rotate-right': mdiRotateRight,
    'tag-add': mdiTagOutline,
    'tag-remove': mdiTagOutline,
    unarchive: mdiArchiveArrowUpOutline,
    unfavorite: mdiHeartOutline,
    'visibility-personal': mdiLockOutline,
    'visibility-private': mdiLockOutline,
    'visibility-standard': mdiLockOutline,
  })[action];

export type CimmichEntityMediaActionReceipt = {
  action: CimmichEntityMediaActionKind;
  assetCorrectionDecisionIds?: string[];
  assetIds: string[];
  completedAt: string;
  contextDecisionIds: string[];
  label: string;
  labelDecisionIds: string[];
  presenceDecisionIds: string[];
  targetId: string;
  version: 2;
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
  'rotate-left',
  'rotate-right',
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
    receipt.version === 2 &&
    actions.has(receipt.action as CimmichEntityMediaActionKind) &&
    (receipt.assetCorrectionDecisionIds === undefined || stringArray(receipt.assetCorrectionDecisionIds)) &&
    stringArray(receipt.assetIds) &&
    typeof receipt.completedAt === 'string' &&
    Number.isFinite(Date.parse(receipt.completedAt)) &&
    stringArray(receipt.contextDecisionIds) &&
    typeof receipt.label === 'string' &&
    stringArray(receipt.labelDecisionIds) &&
    stringArray(receipt.presenceDecisionIds) &&
    typeof receipt.targetId === 'string' &&
    stringArray(receipt.visibilityDecisionIds)
  );
};

export const loadCimmichEntityMediaActionReceipt = (
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  context: CimmichUndoReceiptContext | null,
  now?: number,
): CimmichEntityMediaActionReceipt | null =>
  loadPersistedUndoReceipt(storage, ENTITY_MEDIA_ACTION_RECEIPT_KEY, context, isCimmichEntityMediaActionReceipt, now);

export const saveCimmichEntityMediaActionReceipt = (
  storage: Pick<Storage, 'removeItem' | 'setItem'>,
  receipt: CimmichEntityMediaActionReceipt | null,
  context: CimmichUndoReceiptContext | null,
  now?: number,
) => savePersistedUndoReceipt(storage, ENTITY_MEDIA_ACTION_RECEIPT_KEY, receipt, context, now);

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
    'album-add': 'Add to Cimmich collection',
    archive: 'Archive',
    'context-detach': `Remove from ${currentScope?.displayName || 'this page'}`,
    'event-attach': 'Add to Event',
    favorite: 'Favourite',
    'object-attach': 'Mark Thing depicted',
    'place-attach': 'Add to Place',
    'rotate-left': 'Rotate left',
    'rotate-right': 'Rotate right',
    'presence-current': `Mark ${currentSubject?.displayName || 'subject'} present`,
    'presence-person': 'Mark Person present',
    'presence-pet': 'Mark Pet present',
    'tag-add': 'Add Cimmich tag',
    'tag-remove': 'Remove Cimmich tag',
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
