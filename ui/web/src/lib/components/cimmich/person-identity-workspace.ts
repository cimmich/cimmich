import type { CimmichPersonAsset } from '$lib/services/cimmich.service';
import { getCimmichPersonAssetsPage } from '$lib/services/cimmich.service';
import type { CimmichIdentityFilter } from './person-workspace-navigation';

export type CimmichPersonAppearanceAssets = {
  body: CimmichPersonAsset[];
  bodyTotal: number;
  presence: CimmichPersonAsset[];
  presenceTotal: number;
};

export const emptyPersonAppearanceAssets = (): CimmichPersonAppearanceAssets => ({
  body: [],
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
    bodyTotal: body.summary.body + body.summary.bodyCandidate,
    presence: presence.items,
    presenceTotal: presence.summary.presence,
  };
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
