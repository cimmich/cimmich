import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPeoplePage = () => readFile('src/routes/(user)/cimmich/people/+page.svelte', 'utf8');

describe('People suggestions layout', () => {
  it('uses current SourcePack candidate totals for known People and keeps possible People separate', async () => {
    const source = await readPeoplePage();

    expect(source).toContain('getCimmichPersonCandidateSummary()');
    expect(source).toContain('new Map((cimmichCandidateSummary?.items ?? [])');
    expect(source).toContain('personMachineSuggestionCount(person.person_id)');
    expect(source).toContain("viewMode === 'candidates' ? personMachineSuggestionCount(person.person_id) : undefined");
    expect(source).toContain('identityReviewCount:');
    expect(source).toContain('comparePeopleByReviewCount(a, b, cimmichCandidateCounts, peopleSort)');
    expect(source).toContain("viewMode === 'candidates' ? 'Sort equal review counts' : 'Sort people'");
    expect(source).toContain('matched faces from a saved evaluated reference');
    expect(source).toMatch(/Nothing\s+changes until you confirm/);
    expect(source).not.toContain('getCimmichIdentityAuditLeads()');
    expect(source).not.toContain('getCimmichMachineSuggestions(80)');
    expect(source).not.toContain('Full-library audit suggestions');
    expect(source).not.toContain('latest full-library audit');
    expect(source).toContain("{#if viewMode === 'possible'}");
    expect(source).toContain('<CimmichPossiblePeople mode="active"');
    expect(source.indexOf("{#if viewMode === 'possible'}")).toBeLessThan(
      source.indexOf('<CimmichPossiblePeople mode="active"'),
    );
    expect(source).not.toContain('{#if viewMode === \'candidates\'}\n        <CimmichPossiblePeople mode="active"');
  });
});
