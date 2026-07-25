import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPeoplePage = () => readFile('src/routes/(user)/cimmich/people/+page.svelte', 'utf8');

describe('People suggestions layout', () => {
  it('uses full-library audit totals for known People and keeps possible People separate', async () => {
    const source = await readPeoplePage();

    expect(source).toContain('getCimmichIdentityAuditLeads()');
    expect(source).toContain('new Map(cimmichIdentityAuditLeads.map');
    expect(source).toContain('personMachineSuggestionCount(person.person_id)');
    expect(source).toContain('Full-library audit suggestions grouped by the known Person');
    expect(source).toContain('<CimmichPossiblePeople mode="active"');
    expect(source).toContain("viewMode === 'candidates'");
  });
});
