import {
  emptyPersonAppearanceAssets,
  identitySectionDefaultFilter,
  identitySectionForFilter,
  loadPersonAppearanceAssets,
  loadPersonIdentityPrimary,
  personIdentityWorkspaceGroups,
} from './person-identity-workspace';

const mocks = vi.hoisted(() => ({
  getIdentityFacesPage: vi.fn(),
  getPersonAssetsPage: vi.fn(),
  getPersonCandidates: vi.fn(),
  getPersonPresentation: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal()),
  getCimmichIdentityFacesPage: mocks.getIdentityFacesPage,
  getCimmichPersonAssetsPage: mocks.getPersonAssetsPage,
  getCimmichPersonCandidates: mocks.getPersonCandidates,
  getCimmichPersonPresentation: mocks.getPersonPresentation,
}));

describe('person identity workspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads mutually exclusive Appearance, Head, Body, and Presence projections', async () => {
    const headItems = [{ asset_id: 'head-1', association_types: ['head'] }];
    const bodyItems = [{ asset_id: 'body-1', association_types: ['body'] }];
    const presenceItems = [{ asset_id: 'presence-1' }];
    mocks.getPersonAssetsPage
      .mockResolvedValueOnce({
        items: [...headItems, ...bodyItems],
        nextCursor: null,
        pageSize: 250,
        schemaVersion: 'cimmich.person-projection-page.v1',
        summary: { body: 54, bodyCandidate: 0, head: 3, presence: 0, total: 57 },
      })
      .mockResolvedValueOnce({
        items: presenceItems,
        nextCursor: null,
        pageSize: 250,
        schemaVersion: 'cimmich.person-projection-page.v1',
        summary: { body: 0, bodyCandidate: 0, head: 0, presence: 12, total: 12 },
      });

    await expect(loadPersonAppearanceAssets('person-1')).resolves.toEqual({
      appearance: [...headItems, ...bodyItems],
      appearanceTotal: 57,
      body: bodyItems,
      bodyTotal: 54,
      head: headItems,
      headTotal: 3,
      presence: presenceItems,
      presenceTotal: 12,
    });
    expect(mocks.getPersonAssetsPage).toHaveBeenNthCalledWith(1, 'person-1', 250, undefined, 'appearance');
    expect(mocks.getPersonAssetsPage).toHaveBeenNthCalledWith(2, 'person-1', 250, undefined, 'presence');
  });

  it('creates an independent empty appearance state', () => {
    const first = emptyPersonAppearanceAssets();
    const second = emptyPersonAppearanceAssets();
    expect(first).toEqual({
      appearance: [],
      appearanceTotal: 0,
      body: [],
      bodyTotal: 0,
      head: [],
      headTotal: 0,
      presence: [],
      presenceTotal: 0,
    });
    expect(first).not.toBe(second);
  });

  it('publishes Appearance as soon as its bounded pages resolve', async () => {
    let releaseCandidates!: (value: never[]) => void;
    mocks.getIdentityFacesPage.mockResolvedValue({ items: [], nextCursor: null, summary: {} });
    mocks.getPersonPresentation.mockResolvedValue({});
    mocks.getPersonCandidates.mockReturnValue(new Promise((resolve) => (releaseCandidates = resolve)));
    mocks.getPersonAssetsPage
      .mockResolvedValueOnce({ items: [], summary: { body: 0, head: 0, total: 0 } })
      .mockResolvedValueOnce({ items: [], summary: { total: 0 } });
    const onAppearance = vi.fn();
    const primary = loadPersonIdentityPrimary(
      'person-1',
      () => Promise.resolve({ items: [], nextCursor: null }),
      onAppearance,
    );

    await vi.waitFor(() => expect(onAppearance).toHaveBeenCalledOnce());
    releaseCandidates([]);
    await primary;
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
    expect(identitySectionDefaultFilter('appearance')).toBe('appearance');
    expect(identitySectionForFilter('candidates')).toBe('checks');
    expect(identitySectionDefaultFilter('face')).toBe('all');
  });
});
