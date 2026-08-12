import {
  emptyPersonAppearanceAssets,
  identitySectionDefaultFilter,
  identitySectionForFilter,
  loadPersonAppearanceAssets,
  personIdentityWorkspaceGroups,
} from './person-identity-workspace';

const mocks = vi.hoisted(() => ({
  getPersonAssetsPage: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal()),
  getCimmichPersonAssetsPage: mocks.getPersonAssetsPage,
}));

describe('person identity workspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads dedicated Body and Presence projections and preserves their exact totals', async () => {
    const bodyItems = [{ asset_id: 'body-1' }];
    const presenceItems = [{ asset_id: 'presence-1' }];
    mocks.getPersonAssetsPage
      .mockResolvedValueOnce({
        items: bodyItems,
        nextCursor: null,
        pageSize: 250,
        schemaVersion: 'cimmich.person-projection-page.v1',
        summary: { body: 54, bodyCandidate: 3, presence: 0, total: 57 },
      })
      .mockResolvedValueOnce({
        items: presenceItems,
        nextCursor: null,
        pageSize: 250,
        schemaVersion: 'cimmich.person-projection-page.v1',
        summary: { body: 0, bodyCandidate: 0, presence: 12, total: 12 },
      });

    await expect(loadPersonAppearanceAssets('person-1')).resolves.toEqual({
      body: bodyItems,
      bodyCandidate: 3,
      bodyConfirmed: 54,
      bodyTotal: 57,
      presence: presenceItems,
      presenceTotal: 12,
    });
    expect(mocks.getPersonAssetsPage).toHaveBeenNthCalledWith(1, 'person-1', 250, undefined, 'body');
    expect(mocks.getPersonAssetsPage).toHaveBeenNthCalledWith(2, 'person-1', 250, undefined, 'presence');
  });

  it('creates an independent empty appearance state', () => {
    const first = emptyPersonAppearanceAssets();
    const second = emptyPersonAppearanceAssets();
    expect(first).toEqual({
      body: [],
      bodyCandidate: 0,
      bodyConfirmed: 0,
      bodyTotal: 0,
      presence: [],
      presenceTotal: 0,
    });
    expect(first).not.toBe(second);
  });

  it('keeps Identity jobs in five stable sections', () => {
    const groups = personIdentityWorkspaceGroups({
      appearanceAssets: emptyPersonAppearanceAssets(),
      awaitingCounts: { newMatches: 7, possibleMistags: 2 },
      faceSummary: { all: 10, head: 1, lowQuality: 2, prime: 3, secondary: 5 },
      loaded: true,
      loading: false,
      presentationSelectionCount: 2,
    });

    expect(groups.map(({ id }) => id)).toEqual(['overview', 'face', 'appearance', 'display', 'checks']);
    expect(groups.find(({ id }) => id === 'face')?.filters.map(({ id }) => id)).toEqual([
      'all',
      'prime',
      'secondary',
      'lq',
    ]);
    expect(identitySectionForFilter('overview')).toBe('overview');
    expect(identitySectionForFilter('head')).toBe('appearance');
    expect(identitySectionForFilter('candidates')).toBe('checks');
    expect(identitySectionDefaultFilter('face')).toBe('all');
  });
});
