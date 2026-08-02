import { describe, expect, it } from 'vitest';
import type { CimmichPlaceRollupAsset } from '$lib/services/cimmich.service';
import { cimmichPlaceChildCoverAssetId } from './place-child-cover';

const asset = (sourceAssetId: string, branchEntityIds: string[]): CimmichPlaceRollupAsset => ({
  assetId: `asset-${sourceAssetId}`,
  assignedEntityIds: [],
  associationId: `association-${sourceAssetId}`,
  associationKind: 'captured_at',
  branchEntityIds,
  captureTime: '2026-08-03T00:00:00Z',
  directlyAssigned: false,
  filename: `${sourceAssetId}.jpg`,
  height: 100,
  linkedAt: '2026-08-03T00:00:00Z',
  mediaKind: 'image',
  mimeType: 'image/jpeg',
  sourceAssetId,
  width: 100,
});

describe('Place child cover presentation', () => {
  it('keeps an explicit or automatic child cover authoritative', () => {
    expect(
      cimmichPlaceChildCoverAssetId({ coverAssetId: 'saved-cover', entityId: 'office' }, [
        asset('fallback', ['office']),
      ]),
    ).toBe('saved-cover');
  });

  it('falls back to the first photo in that child branch', () => {
    expect(
      cimmichPlaceChildCoverAssetId({ coverAssetId: null, entityId: 'office' }, [
        asset('yard-photo', ['yard']),
        asset('office-photo', ['office']),
        asset('older-office-photo', ['office']),
      ]),
    ).toBe('office-photo');
  });

  it('does not borrow a photo from another child', () => {
    expect(
      cimmichPlaceChildCoverAssetId({ coverAssetId: null, entityId: 'empty-room' }, [
        asset('office-photo', ['office']),
      ]),
    ).toBeNull();
  });
});
