import { OpenQueryParam } from '$lib/constants';
import { Route } from '$lib/route';

describe('Route', () => {
  describe(Route.login.name, () => {
    it('should encode continue', () => {
      expect(Route.login({ continue: '/some/path?with=query', autoLaunch: 1 })).toBe(
        '/auth/login?continue=%2Fsome%2Fpath%3Fwith%3Dquery&autoLaunch=1',
      );
    });
  });

  describe(Route.search.name, () => {
    it('should work', () => {
      expect(Route.search({})).toBe('/search');
    });

    it('should work', () => {
      expect(Route.search({ make: undefined, model: 'Immich' })).toBe('/search?query=%7B%22model%22%3A%22Immich%22%7D');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });

  describe(Route.cimmichSmartSearch.name, () => {
    it('opens a photo-scoped visual search without encoding it as text', () => {
      expect(Route.cimmichSmartSearch()).toBe('/cimmich/smart-search');
      expect(Route.cimmichSmartSearch({ lens: 'visual', queryAssetId: 'asset-1' })).toBe(
        '/cimmich/smart-search?lens=visual&queryAssetId=asset-1',
      );
    });
  });

  describe(Route.viewCimmichPersonAsset.name, () => {
    it('preserves the Person viewer context with encoded stable identity', () => {
      expect(Route.viewCimmichPersonAsset({ id: 'asset-1', personId: 'person-1', personName: 'Rupert BP' })).toBe(
        '/photos/asset-1?cimmichPersonId=person-1&cimmichPersonName=Rupert%20BP',
      );
      expect(
        Route.viewCimmichPersonAsset({
          faceId: 'face-1',
          id: 'asset-1',
          personId: 'person-1',
          personName: 'Rupert BP',
          overlay: 'machinery',
        }),
      ).toBe(
        '/photos/asset-1?cimmichFaceId=face-1&cimmichOverlay=machinery&cimmichPersonId=person-1&cimmichPersonName=Rupert%20BP',
      );
    });
  });

  describe(Route.cimmichPerson.name, () => {
    it('carries a known review count into the Person workspace without forcing Identity to load', () => {
      expect(Route.cimmichPerson({ identityReviewCount: 12, name: 'Rupert BP', personId: 'person-1' })).toBe(
        '/cimmich/people/Rupert%20BP?identityReviewCount=12&personId=person-1',
      );
      expect(Route.cimmichPerson({ identityReviewCount: 0, name: 'Rupert BP', personId: 'person-1' })).toBe(
        '/cimmich/people/Rupert%20BP?personId=person-1',
      );
    });
  });

  describe(Route.viewCimmichFaceAsset.name, () => {
    it('opens a Face directly without inventing a Person context', () => {
      expect(Route.viewCimmichFaceAsset({ faceId: 'face-1', id: 'asset-1' })).toBe(
        '/photos/asset-1?cimmichFaceId=face-1&cimmichOverlay=machinery',
      );
    });
  });

  describe(Route.viewCimmichPetAsset.name, () => {
    it('preserves the Pet viewer context with encoded stable identity', () => {
      expect(Route.viewCimmichPetAsset({ id: 'asset-1', petId: 'pet-1', petName: 'Juniper' })).toBe(
        '/photos/asset-1?cimmichPetId=pet-1&cimmichPetName=Juniper',
      );
      expect(Route.cimmichPet({ name: 'Juniper', petId: 'pet-1' })).toBe('/cimmich/pets/Juniper?petId=pet-1');
      expect(Route.cimmichPet({ name: 'Juniper' })).toBe('/cimmich/pets/Juniper');
    });
  });

  describe(Route.cimmichThings.name, () => {
    it('opens the Things family in the shared Places and Objects workspace', () => {
      expect(Route.cimmichThings()).toBe('/cimmich/things');
    });
  });

  describe(Route.cimmichSetup.name, () => {
    it('keeps newcomer library setup separate from advanced maintenance', () => {
      expect(Route.cimmichSetup()).toBe('/cimmich/setup');
      expect(Route.cimmichMaintenance()).toBe('/cimmich/maintenance');
      expect(Route.cimmichArchiveIntegrity()).toBe('/cimmich/archive-integrity');
      expect(Route.cimmichArchiveIntegrity({ assetId: 'asset-1', mode: 'variants' })).toBe(
        '/cimmich/archive-integrity?assetId=asset-1&mode=variants',
      );
      expect(Route.cimmichArchiveIntegrity({ folder: '/archive/Trips/Sydney', mode: 'variants' })).toBe(
        '/cimmich/archive-integrity?folder=%2Farchive%2FTrips%2FSydney&mode=variants',
      );
      expect(Route.cimmichArchiveIntegrity({ folder: '/archive/Trips/Sydney', mode: 'folder' })).toBe(
        '/cimmich/archive-integrity?folder=%2Farchive%2FTrips%2FSydney&mode=folder',
      );
      expect(Route.cimmichArchiveIntegrity({ mode: 'rotation' })).toBe('/cimmich/archive-integrity?mode=rotation');
    });
  });

  describe(Route.viewFolderAsset.name, () => {
    it('opens the asset inside its containing folder context', () => {
      expect(Route.folders({ path: '/archive/Trips/Sydney', cimmichContext: 1 })).toBe(
        '/folders?path=%2Farchive%2FTrips%2FSydney&cimmichContext=1',
      );
      expect(Route.viewFolderAsset({ id: 'asset-1', path: '/archive/Trips/Sydney' })).toBe(
        '/folders/photos/asset-1?path=%2Farchive%2FTrips%2FSydney',
      );
      expect(Route.viewFolderAsset({ cimmich: 1, id: 'asset-1', path: '/archive/Trips/Sydney' })).toBe(
        '/folders/photos/asset-1?cimmichContext=1&path=%2Farchive%2FTrips%2FSydney',
      );
    });
  });

  describe(Route.tags.name, () => {
    it('should work', () => {
      expect(Route.tags()).toBe('/tags');
    });

    it('should support query parameters', () => {
      expect(Route.tags({ path: '/some/path' })).toBe('/tags?path=%2Fsome%2Fpath');
    });

    it('should ignore an empty path', () => {
      expect(Route.tags({ path: '' })).toBe('/tags');
    });
  });

  describe(Route.systemSettings.name, () => {
    it('should work', () => {
      expect(Route.systemSettings()).toBe('/admin/system-settings');
    });

    it('should support query parameters', () => {
      expect(Route.systemSettings({ isOpen: OpenQueryParam.OAUTH })).toBe('/admin/system-settings?isOpen=oauth');
    });
  });

  describe(Route.continue.name, () => {
    beforeEach(() => {
      // @ts-expect-error - override location for testing
      globalThis.location = new URL('https://my.immich.server');
      vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://my.immich.server/');
    });

    it('should resolve relative URLs', () => {
      expect(Route.continue('/some/path', '/fallback')).property('href', 'https://my.immich.server/some/path');
    });

    it('should resolve absolute URLs on the same origin', () => {
      expect(Route.continue('https://my.immich.server/some/path', '/fallback')).property(
        'href',
        'https://my.immich.server/some/path',
      );
    });

    it('should return fallback for absolute URLs on a different origin', () => {
      expect(Route.continue('https://malicious.site/evil', '/fallback')).toBe('/fallback');
    });

    it('should return fallback for null URLs', () => {
      expect(Route.continue(null, '/fallback')).property('href', 'https://my.immich.server/fallback');
    });

    it('should block javascript: URLs', () => {
      expect(Route.continue('javascript:alert(1)', '/fallback')).toBe('/fallback');
    });

    it(String.raw`should block \/ URLs`, () => {
      expect(Route.continue(String.raw`\/malicious.com`, '/fallback')).toBe('/fallback');
    });
  });
});
