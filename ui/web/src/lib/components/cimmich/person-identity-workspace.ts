import {
  getCimmichIdentityAuditItems,
  getCimmichIdentityFacesPage,
  getCimmichMachineSuggestions,
  getCimmichPersonAssetsPage,
  getCimmichPersonCandidates,
  getCimmichPersonPresentation,
  type CimmichIdentityFaceSummary,
  type CimmichPersonAsset,
  type CimmichPersonAssetPage,
} from '$lib/services/cimmich.service';
import { getCimmichKnownPersonClusterSuggestions } from '$lib/services/possible-people.service';
import type { CimmichIdentityFilter } from './person-workspace-navigation';

export type CimmichPersonAppearanceAssets = {
  appearance: CimmichPersonAsset[];
  appearanceTotal: number;
  body: CimmichPersonAsset[];
  bodyTotal: number;
  head: CimmichPersonAsset[];
  headTotal: number;
  presence: CimmichPersonAsset[];
  presenceTotal: number;
};

export const emptyPersonAppearanceAssets = (): CimmichPersonAppearanceAssets => ({
  appearance: [],
  appearanceTotal: 0,
  body: [],
  bodyTotal: 0,
  head: [],
  headTotal: 0,
  presence: [],
  presenceTotal: 0,
});

export const loadPersonAppearanceAssets = async (personId: string): Promise<CimmichPersonAppearanceAssets> => {
  const [appearance, presence] = await Promise.all([
    getCimmichPersonAssetsPage(personId, 250, undefined, 'appearance'),
    getCimmichPersonAssetsPage(personId, 250, undefined, 'presence'),
  ]);
  return {
    appearance: appearance.items,
    appearanceTotal: appearance.summary.total,
    body: appearance.items.filter((asset) => asset.association_types.includes('body')),
    bodyTotal: appearance.summary.body,
    head: appearance.items.filter((asset) => asset.association_types.includes('head')),
    headTotal: appearance.summary.head,
    presence: presence.items,
    presenceTotal: presence.summary.total,
  };
};

export const loadPersonIdentityPrimary = async (
  personId: string,
  loadAssets: () => Promise<Pick<CimmichPersonAssetPage, 'items' | 'nextCursor'>>,
  onAppearanceAssets?: (appearanceAssets: CimmichPersonAppearanceAssets) => void,
) => {
  const appearancePromise = loadPersonAppearanceAssets(personId).then((appearanceAssets) => {
    onAppearanceAssets?.(appearanceAssets);
    return appearanceAssets;
  });
  const [facesPage, assetsPage, appearanceAssets, candidates, presentation] = await Promise.all([
    getCimmichIdentityFacesPage(personId, 120),
    loadAssets(),
    appearancePromise,
    getCimmichPersonCandidates(personId),
    getCimmichPersonPresentation(personId),
  ]);
  return { appearanceAssets, assetsPage, candidates, facesPage, presentation };
};

export const loadPersonIdentityReview = async (personId: string) => {
  const [untaggedAudit, contradictionAudit, knownClusterSuggestions] = await Promise.all([
    getCimmichIdentityAuditItems('untagged_match', 0, 50, personId),
    getCimmichIdentityAuditItems('accepted_contradiction', 0, 50, personId),
    getCimmichKnownPersonClusterSuggestions(personId),
  ]);
  const machineSuggestions =
    untaggedAudit.run?.state === 'completed' ? [] : await getCimmichMachineSuggestions(80, personId);
  return { contradictionAudit, knownClusterSuggestions, machineSuggestions, untaggedAudit };
};

type IdentityWorkspaceGroupsInput = {
  appearanceAssets: CimmichPersonAppearanceAssets;
  awaitingCounts: { newMatches: number; possibleMistags: number };
  faceSummary: CimmichIdentityFaceSummary;
  loaded: boolean;
  loading: boolean;
  presentationSelectionCount: number;
};

export type CimmichIdentitySection = 'appearance' | 'checks' | 'display' | 'face' | 'overview';

export const identitySectionForFilter = (filter: CimmichIdentityFilter): CimmichIdentitySection => {
  if (filter === 'overview') {
    return 'overview';
  }
  if (filter === 'appearance' || filter === 'body' || filter === 'head' || filter === 'presence') {
    return 'appearance';
  }
  if (filter === 'candidates') {
    return 'checks';
  }
  if (filter === 'presentation') {
    return 'display';
  }
  return 'face';
};

export const identitySectionDefaultFilter = (section: CimmichIdentitySection): CimmichIdentityFilter =>
  section === 'overview'
    ? 'overview'
    : section === 'appearance'
      ? 'appearance'
      : section === 'checks'
        ? 'candidates'
        : section === 'display'
          ? 'presentation'
          : 'all';

export const personIdentityWorkspaceGroups = ({
  appearanceAssets: cimmichAppearanceAssets,
  awaitingCounts,
  faceSummary,
  loaded,
  loading,
  presentationSelectionCount,
}: IdentityWorkspaceGroupsInput) => {
  const cimmichIdentityCountLabel = (count: number) => (loading && !loaded ? '…' : count.toLocaleString());
  return [
    {
      id: 'overview',
      label: 'Overview',
      filters: [{ id: 'overview', label: 'Overview', count: '' }],
    },
    {
      id: 'face',
      label: 'Face',
      filters: [
        { id: 'all', label: 'All confirmed', count: cimmichIdentityCountLabel(faceSummary.all) },
        { id: 'prime', label: 'Core matching set', count: cimmichIdentityCountLabel(faceSummary.prime) },
        {
          id: 'secondary',
          label: 'Supporting Face evidence',
          count: cimmichIdentityCountLabel(faceSummary.secondary),
        },
        { id: 'lq', label: 'Low quality', count: cimmichIdentityCountLabel(faceSummary.lowQuality) },
      ],
    },
    {
      id: 'appearance',
      label: 'Appearance',
      filters: [
        {
          id: 'appearance',
          label: 'All appearance',
          count: cimmichIdentityCountLabel(cimmichAppearanceAssets.appearanceTotal),
        },
        { id: 'head', label: 'Head', count: cimmichIdentityCountLabel(cimmichAppearanceAssets.headTotal) },
        {
          id: 'body',
          label: 'Body',
          count: cimmichIdentityCountLabel(cimmichAppearanceAssets.bodyTotal),
        },
        {
          id: 'presence',
          label: 'Presence',
          count: cimmichIdentityCountLabel(cimmichAppearanceAssets.presenceTotal),
        },
      ],
    },
    {
      id: 'display',
      label: 'Display',
      filters: [
        {
          id: 'presentation',
          label: 'Photos',
          count: loading && !loaded ? '…' : `${presentationSelectionCount}/3`,
        },
      ],
    },
    {
      id: 'checks',
      label: 'Checks',
      filters: [
        {
          id: 'candidates',
          label: 'Checks',
          count:
            loading && !loaded
              ? '…'
              : `${awaitingCounts.newMatches.toLocaleString()} new · ${awaitingCounts.possibleMistags.toLocaleString()} mistags`,
        },
      ],
    },
  ];
};

export const cimmichIdentityAdvancedFilters: Array<{
  id: CimmichIdentityFilter;
  label: string;
  description: string;
}> = [
  { id: 'prime', label: 'Core', description: 'Selected to cover the person for matching' },
  { id: 'secondary', label: 'Supporting', description: 'Remaining usable Face evidence' },
  { id: 'lq', label: 'Low quality', description: 'Condition-routed Face evidence' },
  { id: 'appearance', label: 'Appearance', description: 'Head or Body placement without a Face' },
  { id: 'head', label: 'Head', description: 'Head placement without a usable Face' },
  { id: 'body', label: 'Body', description: 'Body placement without a usable Face' },
  { id: 'presence', label: 'Presence', description: 'Attributed without a visible Face, Head, or Body placement' },
];
