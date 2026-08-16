import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { cimmichLocalAiExperiment } from '$lib/stores/cimmich-experience.store';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import AssetViewerNavBar from './AssetViewerNavBar.svelte';

const appState = vi.hoisted(() => ({ data: {}, url: new URL('http://localhost/photos/asset-1') }));

vi.mock('$app/state', () => ({ page: appState }));

vi.mock('$lib/components/cimmich/duplicate-indicators', () => ({
  getCimmichDuplicateIndicator: vi.fn().mockResolvedValue(null),
}));

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
    cimmichLocalAiExperiment.set(false);
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

    expect(source).toContain('restorePreference={false}');
    expect(source).not.toContain('Immich view. All photos are visible.');
  });

  it('places privacy first and centers Cimmich tools in the single viewer bar', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/asset-viewer/AssetViewerNavBar.svelte'),
      'utf8',
    );

    expect(source.indexOf('<CimmichViewingMode')).toBeLessThan(source.indexOf('<ActionButton action={Close} />'));
    expect(source).toContain('sourceAssetId={isCimmichSurface ? asset.id : undefined}');
    expect(source).toContain('data-testid="cimmich-photo-tools"');
    expect(source).toContain('id="cimmich-photo-overlay-toolbar"');
    expect(source).toContain('<CimmichSummaryAction {asset}');
    expect(source).toContain('<CimmichDuplicateIndicator sourceAssetId={asset.id} variant="navbar" />');
    expect(source).toContain('<CimmichFileLocationActions {asset} variant="overlay" />');
    expect(source).not.toContain('<CimmichAssetVisibility');
    expect(source).not.toContain('Tooltip text="Immich view · All photos are visible"');
  });

  it('gives Local AI the same fast tooltip treatment as the other viewer icons', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/cimmich/CimmichLocalAiAction.svelte'),
      'utf8',
    );

    expect(source).toContain('<TooltipProvider delayDuration={120}>');
    expect(source).toContain('<Tooltip text="Local AI">');
    expect(source).not.toContain('title="Local AI"');
  });

  it('keeps Local AI hidden until the separate experiment is enabled', () => {
    const owner = userAdminFactory.build();
    authManager.setUser(owner);
    authManager.setPreferences(preferencesFactory.build({ cast: { gCastEnabled: false } }));
    appState.url = new URL('http://localhost/photos/asset-1?organise=1');

    const asset = assetFactory.build({ isTrashed: false, ownerId: owner.id, type: AssetTypeEnum.Image });
    const { queryByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });

    expect(queryByLabelText('Open Local AI review')).not.toBeInTheDocument();
  });

  it('shows Local AI when its experiment is enabled on a Cimmich photo surface', () => {
    const owner = userAdminFactory.build();
    authManager.setUser(owner);
    authManager.setPreferences(preferencesFactory.build({ cast: { gCastEnabled: false } }));
    cimmichLocalAiExperiment.set(true);
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
