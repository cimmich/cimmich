import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPeopleOverview = () => readFile('src/routes/(user)/cimmich/people/+page.svelte', 'utf8');

describe('People overview layout', () => {
  it('names the category shortcut picker instead of presenting an unexplained plus', async () => {
    const source = await readPeopleOverview();

    expect(source).toContain('<span>Categories</span>');
    expect(source).toContain('Choose which People categories appear as shortcuts');
    expect(source).toContain('aria-label="Choose People category shortcuts"');
  });
});
