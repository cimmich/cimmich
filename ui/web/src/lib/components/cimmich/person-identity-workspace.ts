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
  body: CimmichPersonAsset[];
  bodyCandidate: number;
  bodyConfirmed: number;
  bodyTotal: number;
  presence: CimmichPersonAsset[];
  presenceTotal: number;
};

export const emptyPersonAppearanceAssets = (): CimmichPersonAppearanceAssets => ({
  body: [],
  bodyCandidate: 0,
  bodyConfirmed: 0,
  bodyTotal: 0,
  presence: [],
  presenceTotal: 0,
});

export const loadPersonAppearanceAssets = async (personId: string): Promise<CimmichPersonAppearanceAssets> => {
  const [body, presence] = await Promise.all([
    getCimmichPersonAssetsPage(personId, 250, undefined, 'body'),
    getCimmichPersonAssetsPage(personId, 250, undefined, 'presence'),
  ]);
  return {
    body: body.items,
    bodyCandidate: body.summary.bodyCandidate,
    bodyConfirmed: body.summary.body,
    bodyTotal: body.summary.body + body.summary.bodyCandidate,
    presence: presence.items,
    presenceTotal: presence.summary.presence,
  };
};

export const loadPersonIdentityPrimary = async (
  personId: string,
  loadAssets: () => Promise<Pick<CimmichPersonAssetPage, 'items' | 'nextCursor'>>,
) => {
  const [facesPage, assetsPage, appearanceAssets, candidates, presentation] = await Promise.all([
    getCimmichIdentityFacesPage(personId, 120),
    loadAssets(),
    loadPersonAppearanceAssets(personId),
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
      id: 'references',
      label: 'Face evidence',
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
        { id: 'head', label: 'Head', count: cimmichIdentityCountLabel(faceSummary.head) },
        {
          id: 'body',
          label: 'Body review',
          count:
            loading && !loaded
              ? '…'
              : `${cimmichAppearanceAssets.bodyConfirmed.toLocaleString()} accepted · ${cimmichAppearanceAssets.bodyCandidate.toLocaleString()} placement`,
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
      id: 'review',
      label: 'Review',
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
  { id: 'head', label: 'Head references', description: 'Face-derived, not manual tags' },
  { id: 'body', label: 'Body', description: 'Body-only until a Face or Head is confirmed' },
  { id: 'presence', label: 'Presence', description: 'Known appearance without usable person geometry' },
];
