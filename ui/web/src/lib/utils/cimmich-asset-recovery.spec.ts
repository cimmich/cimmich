import { describe, expect, it } from 'vitest';
import { cimmichAssetRecoveryHref } from './cimmich-asset-recovery';

describe('cimmichAssetRecoveryHref', () => {
  it('preserves Cimmich overlay context while replacing a stale Immich UUID', () => {
    const url = new URL(
      'http://immich.test/photos/source-stale?cimmichOverlay=people&cimmichPersonId=person-one&cimmichPersonName=Synthetic%20Person',
    );

    expect(
      cimmichAssetRecoveryHref({
        currentSourceAssetId: 'source-stale',
        resolvedSourceAssetId: 'source-current',
        url,
      }),
    ).toBe(
      '/photos/source-current?cimmichOverlay=people&cimmichPersonId=person-one&cimmichPersonName=Synthetic%20Person',
    );
  });

  it('does not redirect when Cimmich resolves to the requested Immich UUID', () => {
    expect(
      cimmichAssetRecoveryHref({
        currentSourceAssetId: 'source-current',
        resolvedSourceAssetId: 'source-current',
        url: new URL('http://immich.test/photos/source-current?cimmichOverlay=people'),
      }),
    ).toBeNull();
  });
});
