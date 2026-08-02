import { assetViewerManager } from './asset-viewer-manager.svelte';

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
    assetViewerManager.setReturnRoute('/cimmich/people/Benji');
    assetViewerManager.setReturnRoute(null);

    expect(assetViewerManager.takeReturnRoute()).toBeNull();
  });
});
