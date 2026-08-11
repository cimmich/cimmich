import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import AssetViewerNavBar from './AssetViewerNavBar.svelte';

const appState = vi.hoisted(() => ({ data: {}, url: new URL('http://localhost/photos/asset-1') }));

vi.mock('$app/state', () => ({ page: appState }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    init: vi.fn(),
    loadFeatureFlags: vi.fn(),
    value: { smartSearch: true, trash: true },
  } as never,
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich.service')>()),
  getCimmichAssetEvidence: vi.fn().mockResolvedValue({ asset_id: 'cimmich-asset-1' }),
  getCimmichVisibilityObject: vi.fn().mockResolvedValue({
    objectId: 'cimmich-asset-1',
    objectScope: 'asset',
    visibilityTier: 'private',
  }),
  getCimmichVisibilityStatus: vi.fn().mockResolvedValue({
    capabilities: { album: true, asset: true, collection: true, document: true, entityProfile: true },
    forcedStandard: false,
    inactivitySeconds: 300,
    maxPrivateSessionSeconds: 3600,
    principalBound: true,
    principalId: 'test-owner',
    privateAuthorized: false,
    privateConfigured: false,
    schemaVersion: 'cimmich.visibility.v1',
    surface: 'interactive',
    viewingMode: 'Standard',
  }),
}));

describe('AssetViewerNavBar component', () => {
  const additionalProps = {
    preAction: () => {},
    onAction: () => {},
    onClose: () => {},
    isPlayingOriginalVideo: false,
    setPlayOriginalVideo: () => Promise.resolve(),
  };

  beforeAll(() => {
    Element.prototype.animate = vi.fn().mockImplementation(function () {
      return {
        cancel: () => {},
      };
    });
    vi.stubGlobal('ResizeObserver', getResizeObserverMock());
  });

  afterEach(() => {
    authManager.reset();
    appState.url = new URL('http://localhost/photos/asset-1');
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('shows back button', () => {
    const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
    authManager.setPreferences(preferences);

    const asset = assetFactory.build({ isTrashed: false });
    const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
    expect(getByLabelText('go_back')).toBeInTheDocument();
  });

  it('keeps the privacy control available in a plain photo viewer', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/asset-viewer/AssetViewerNavBar.svelte'),
      'utf8',
    );

    expect(source).toContain('<CimmichViewingMode variant="overlay" restorePreference={false} />');
    expect(source).not.toContain('Immich view. All photos are visible.');
  });

  it('keeps viewing mode and this-photo visibility as distinct Cimmich controls', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/asset-viewer/AssetViewerNavBar.svelte'),
      'utf8',
    );

    expect(source).toContain('<CimmichViewingMode variant="overlay" restorePreference={false} />');
    expect(source).toContain('<span class="hidden md:inline">This </span>photo');
    expect(source).toContain('<CimmichAssetVisibility sourceAssetId={asset.id} variant="overlay" />');
    expect(source).not.toContain('Tooltip text="Immich view · All photos are visible"');
    expect(source).not.toContain('Immich view · All photos visible</span>');
    expect(source).not.toContain('Immich · All visible</span>');
  });

  it('shows Local AI when Library opens a photo with the Cimmich organise marker', () => {
    const owner = userAdminFactory.build();
    authManager.setUser(owner);
    authManager.setPreferences(preferencesFactory.build({ cast: { gCastEnabled: false } }));
    appState.url = new URL('http://localhost/photos/asset-1?organise=1');

    const asset = assetFactory.build({ isTrashed: false, ownerId: owner.id, type: AssetTypeEnum.Image });
    const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });

    expect(getByLabelText('Open Local AI review')).toBeInTheDocument();
  });

  describe('if the current user owns the asset', () => {
    it('shows delete button', () => {
      const ownerId = 'id-of-the-user';
      const user = userAdminFactory.build({ id: ownerId });
      const asset = assetFactory.build({ ownerId, isTrashed: false });
      authManager.setUser(user);

      const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
      authManager.setPreferences(preferences);

      const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
      expect(getByLabelText('delete')).toBeInTheDocument();
    });
  });
});
