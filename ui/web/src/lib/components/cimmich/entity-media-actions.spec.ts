import { AssetVisibility } from '@immich/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  ENTITY_MEDIA_ACTION_RECEIPT_KEY,
  ENTITY_MEDIA_SELECTION_LIMIT,
  cimmichEntityMediaActionLabel,
  cimmichEntityMediaActionNeedsTarget,
  isCimmichEntityMediaActionReceipt,
  loadCimmichEntityMediaActionReceipt,
  saveCimmichEntityMediaActionReceipt,
  selectCimmichEntityMediaItems,
  type CimmichEntityMediaActionReceipt,
} from './entity-media-actions';

const receipt: CimmichEntityMediaActionReceipt = {
  action: 'event-attach',
  albumId: '',
  assetIds: ['asset-1'],
  completedAt: '2026-08-01T00:00:00.000Z',
  contextDecisionIds: ['decision-1'],
  label: 'Add to Event · Birthday',
  nativePrevious: [{ id: 'source-1', isFavorite: false, visibility: AssetVisibility.Timeline }],
  presenceDecisionIds: [],
  sourceAssetIds: ['source-1'],
  tagId: '',
  targetId: 'event-1',
  version: 1,
  visibilityDecisionIds: [],
};
const privateContext = { ownerId: 'owner-1', sessionId: 'session-1', viewingMode: 'private' as const };

describe('entity media actions', () => {
  it('caps visible selection at 100 before an action can be submitted', () => {
    const selection = selectCimmichEntityMediaItems(
      Array.from({ length: ENTITY_MEDIA_SELECTION_LIMIT + 12 }, (_, index) => ({
        assetId: `asset-${index}`,
        filename: `${index}.jpg`,
        sourceAssetId: `source-${index}`,
      })),
    );
    expect(selection.items).toHaveLength(100);
    expect(selection.capped).toBe(true);
  });

  it('distinguishes target actions from direct actions', () => {
    expect(cimmichEntityMediaActionNeedsTarget('event-attach')).toBe(true);
    expect(cimmichEntityMediaActionNeedsTarget('visibility-private')).toBe(false);
    expect(
      cimmichEntityMediaActionLabel('context-detach', null, {
        displayName: 'Gulmarrad',
        entityId: 'place-1',
        family: 'places',
      }),
    ).toBe('Remove from Gulmarrad');
  });

  it('persists only complete versioned Undo receipts', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn((key: string) => values.delete(key)),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    saveCimmichEntityMediaActionReceipt(storage, receipt, privateContext, 1000);
    expect(loadCimmichEntityMediaActionReceipt(storage, privateContext, 1001)).toEqual(receipt);
    expect(isCimmichEntityMediaActionReceipt({ ...receipt, assetIds: 'asset-1' })).toBe(false);
    saveCimmichEntityMediaActionReceipt(storage, null, privateContext);
    expect(values.has(ENTITY_MEDIA_ACTION_RECEIPT_KEY)).toBe(false);
  });

  it('clears Private receipts after a viewing-mode, owner, session, or expiry boundary', () => {
    const cases = [
      { ...privateContext, viewingMode: 'standard' as const },
      { ...privateContext, ownerId: 'owner-2' },
      { ...privateContext, sessionId: 'session-2' },
    ];
    for (const context of cases) {
      const values = new Map<string, string>();
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      };
      saveCimmichEntityMediaActionReceipt(storage, receipt, privateContext, 1000);
      expect(loadCimmichEntityMediaActionReceipt(storage, context, 1001)).toBeNull();
      expect(values.has(ENTITY_MEDIA_ACTION_RECEIPT_KEY)).toBe(false);
    }

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveCimmichEntityMediaActionReceipt(storage, receipt, privateContext, 1000);
    expect(loadCimmichEntityMediaActionReceipt(storage, privateContext, 1000 + 30 * 60_000)).toBeNull();
  });
});
