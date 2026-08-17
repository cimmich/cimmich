import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
import type {
  CimmichExploreFacetResult,
  CimmichExploreFilters as CimmichExploreFilterState,
} from '$lib/services/cimmich.service';
import CimmichExploreFilters from './CimmichExploreFilters.svelte';

const filters: CimmichExploreFilterState = {
  eventIds: [],
  futureDates: false,
  labelIds: [],
  placeIds: [],
  privacyTiers: [],
  thingIds: [],
};

const result = (privateCount: number, labels: CimmichExploreFacetResult['facets']['labels'] = []) =>
  ({
    availableAssets: privateCount > 0 ? 37_893 : 32_267,
    facets: {
      events: [],
      labels,
      places: [],
      privacy: [
        { count: 32_267, displayName: 'Standard', id: 'standard' },
        { count: 0, displayName: 'Personal', id: 'personal' },
        { count: privateCount, displayName: 'Private', id: 'private' },
      ],
      things: [],
    },
    filters,
    people: [],
    schemaVersion: 'cimmich.explore-facets.v1',
    scope: { kind: 'people', personId: '' },
    totalAssets: privateCount > 0 ? 37_893 : 32_267,
  }) satisfies CimmichExploreFacetResult;

beforeEach(() => {
  cimmichVisibilityManager.recordVisibilityStatus({ viewingMode: 'standard' });
});

describe('Cimmich Explore protected discovery', () => {
  it('explains ambiguous top-bar and filter actions with product tooltips', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichExploreFilters.svelte', 'utf8');

    expect(source).toContain('Filter this view by exact privacy, tags, places, events and things');
    expect(source).toContain('Matching photos out of all photos available in the current viewing mode');
    expect(source).toContain('Remove every Explore filter');
    expect(source).toContain('Remove the future capture-date filter');
    expect(source).toContain('Remove the exact ${tier} privacy filter');
    expect(source).toContain('Remove the ${group.label.toLowerCase()} filter');
    expect(source).toContain('Show only photos with exact ${facet.displayName} privacy');
  });

  it('starts closed while keeping active filters visible and removable', async () => {
    const activeFilters = { ...filters, labelIds: ['label-restricted'] };
    const onchange = vi.fn();
    const { getByRole, queryByRole } = render(TestWrapper, {
      component: CimmichExploreFilters,
      componentProps: {
        filters: activeFilters,
        onchange,
        result: result(5626, [{ count: 5626, displayName: 'Restricted', id: 'label-restricted' }]),
      },
    });

    const explore = getByRole('button', { name: /Explore/ });
    expect(explore).toHaveAttribute('aria-expanded', 'false');
    expect(getByRole('button', { name: /Label: Restricted/ })).toBeVisible();
    expect(queryByRole('combobox', { name: 'Add tag or label filter' })).not.toBeInTheDocument();

    await fireEvent.click(explore);
    expect(getByRole('combobox', { name: 'Add tag or label filter' })).toBeVisible();
  });

  it('offers a deliberate Private transition instead of claiming protected photos are zero', async () => {
    const onchange = vi.fn();
    const requestedModes: string[] = [];
    const listener = (event: Event) => requestedModes.push((event as CustomEvent<{ mode: string }>).detail.mode);
    globalThis.addEventListener('cimmich:request-viewing-mode', listener);
    const { getByRole, getByText, queryByText } = render(TestWrapper, {
      component: CimmichExploreFilters,
      componentProps: {
        filters,
        initiallyExpanded: true,
        onchange,
        result: result(0),
      },
    });

    expect(getByRole('button', { name: 'Private Enter to inspect' })).toBeVisible();
    expect(getByText('Enter Private for protected tags & labels')).toBeVisible();
    expect(
      queryByText('“Private” means Private only, not everything this viewing mode can access.'),
    ).not.toBeInTheDocument();
    expect(queryByText('None in this scope')).not.toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Private Enter to inspect' }));
    expect(requestedModes).toEqual(['private']);
    expect(onchange).not.toHaveBeenCalled();

    cimmichVisibilityManager.recordVisibilityStatus({ viewingMode: 'private' });
    await waitFor(() => expect(onchange).toHaveBeenCalledWith({ ...filters, privacyTiers: ['private'] }));
    globalThis.removeEventListener('cimmich:request-viewing-mode', listener);
  });

  it('names first-class Labels as tags and labels when Private content is visible', () => {
    cimmichVisibilityManager.recordVisibilityStatus({ viewingMode: 'private' });
    const { getByRole } = render(TestWrapper, {
      component: CimmichExploreFilters,
      componentProps: {
        filters,
        initiallyExpanded: true,
        onchange: vi.fn(),
        result: result(5626, [{ count: 5626, displayName: 'Restricted', id: 'label-restricted' }]),
      },
    });

    expect(getByRole('combobox', { name: 'Add tag or label filter' })).toHaveTextContent('Restricted (5,626)');
    expect(getByRole('button', { name: 'Private 5,626' })).toBeVisible();
  });
});
