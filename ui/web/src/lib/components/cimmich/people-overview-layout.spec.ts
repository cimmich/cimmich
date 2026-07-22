import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPeopleOverview = () => readFile('src/routes/(user)/cimmich/people/+page.svelte', 'utf8');

describe('People overview layout', () => {
  it('uses one category filter state with All as the reset state', async () => {
    const source = await readPeopleOverview();

    expect(source).toContain('aria-label="Filter people"');
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

    expect(source).toContain("{ id: 'photos', label: '# of Photos' }");
    expect(source).toContain("{ id: 'names', label: 'Names A - Z' }");
    expect(source).toContain('choose again to reverse');
    expect(source).not.toContain('Most accepted faces');
    expect(source).not.toContain('Most candidates');
    expect(source).not.toContain('Most reference faces');
    expect(source).toContain("peopleSort.direction === 'asc'");
    expect(source).toContain('sortDirectionArrow(option.id)');
    expect(source).toContain("return direction === 'asc' ? '↑' : '↓'");
    expect(source).toContain('icon: peopleSort.key === option.id ? mdiCheck : undefined');
    expect(source).toContain('Any photo count');
    expect(source).toContain('Minimum photo count');
    expect(source).toContain('aria-label="Sort people"');
  });

  it('reuses the compact profile control language and supports grid density', async () => {
    const source = await readPeopleOverview();

    expect(source).toContain('aria-label="People view options"');
    expect(source).toContain('mdiSortVariant');
    expect(source).toContain('mdiFilterVariant');
    expect(source).toContain('mdiViewGridOutline');
    expect(source).toContain('bind:value={peopleThumbnailSize}');
    expect(source).toContain('<option value="small">Small</option>');
    expect(source).toContain('<option value="medium">Medium</option>');
    expect(source).toContain('<option value="large">Large</option>');
    expect(source).toContain("peopleThumbnailSize === 'small'");
    expect(source).toContain("peopleThumbnailSize === 'large'");
  });
});
