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
});
