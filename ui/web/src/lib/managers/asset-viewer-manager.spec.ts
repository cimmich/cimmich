import type { AssetResponseDto } from '@immich/sdk';
import { assetViewerManager } from './asset-viewer-manager.svelte';

const asset = (id: string) => ({ id }) as AssetResponseDto;

describe('AssetViewerManager return route', () => {
  afterEach(() => {
    assetViewerManager.setReturnRoute(null);
  });

  it('consumes the previous location exactly once', () => {
    assetViewerManager.setReturnRoute('/cimmich/places/Parents%20Home?placeId=place-1&tab=photos');

    expect(assetViewerManager.takeReturnRoute()).toBe('/cimmich/places/Parents%20Home?placeId=place-1&tab=photos');
    expect(assetViewerManager.takeReturnRoute()).toBeNull();
  });

  it('can clear a stale previous location before another viewer opens', () => {
    assetViewerManager.setReturnRoute('/cimmich/people/Avery%20Example');
    assetViewerManager.setReturnRoute(null);

    expect(assetViewerManager.takeReturnRoute()).toBeNull();
  });
});

describe('AssetViewerManager detail panel lifecycle', () => {
  beforeEach(() => {
    assetViewerManager.closeDetailPanel();
    assetViewerManager.showAssetViewer(false);
  });

  it('closes Info when navigation changes the viewed photo', () => {
    assetViewerManager.setAsset(asset('asset-a'));
    assetViewerManager.openDetailPanel();

    assetViewerManager.setAsset(asset('asset-b'));

    expect(assetViewerManager.isShowDetailPanel).toBe(false);
  });

  it('does not close Info when the current photo is merely refreshed', () => {
    assetViewerManager.setAsset(asset('asset-a'));
    assetViewerManager.openDetailPanel();

    assetViewerManager.setAsset(asset('asset-a'));

    expect(assetViewerManager.isShowDetailPanel).toBe(true);
  });

  it('does not carry Info into a later viewer session', () => {
    assetViewerManager.setAsset(asset('asset-a'));
    assetViewerManager.openDetailPanel();

    assetViewerManager.showAssetViewer(false);

    expect(assetViewerManager.isShowDetailPanel).toBe(false);
  });
});
