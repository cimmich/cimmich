import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPeopleOverview = () => readFile('src/routes/(user)/cimmich/people/+page.svelte', 'utf8');

describe('People overview layout', () => {
  it('uses one category selector with All as the reset state', async () => {
    const source = await readPeopleOverview();

    expect(source).toContain('aria-label="People category"');
    expect(source).toContain("category.id === 'all' ? 'All categories'");
    expect(source).not.toContain('pinnedPeopleCategories');
    expect(source).not.toContain('togglePinnedPeopleCategory');
    expect(source).not.toContain('>Clear<');
  });

  it('separates the primary People view from the secondary controls', async () => {
    const source = await readPeopleOverview();

    expect(source).toContain('h-6 w-px shrink-0 bg-gray-300');
    expect(source).toContain('aria-hidden="true"');
  });

  it('offers only owner-meaningful reversible sorts', async () => {
    const source = await readPeopleOverview();

    expect(source).toContain("{ id: 'photos', label: 'Photos' }");
    expect(source).toContain("{ id: 'names', label: 'Names' }");
    expect(source).toContain('choose again to reverse');
    expect(source).not.toContain('Most accepted faces');
    expect(source).not.toContain('Most candidates');
    expect(source).not.toContain('Most reference faces');
    expect(source).not.toContain('Any photo count');
    expect(source).not.toContain('Minimum photo count');
    expect(source).toContain('aria-label="Sort people"');
  });
});
