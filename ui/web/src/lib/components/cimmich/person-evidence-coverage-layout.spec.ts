import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Person Evidence & coverage workspace', () => {
  it('is a first-class keyboard tab with a reloadable URL mode', async () => {
    const [page, load, navigation, tabs] = await Promise.all([
      readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8'),
      readFile('src/routes/(user)/cimmich/people/[personName]/+page.ts', 'utf8'),
      readFile('src/lib/components/cimmich/person-workspace-navigation.ts', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichPersonPrimaryTabs.svelte', 'utf8'),
    ]);

    expect(load).toContain("mode === 'evidence'");
    expect(navigation).toContain("'evidence'");
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('use:keyboardTabs');
    expect(tabs).toContain('label="Evidence"');
    expect(page).toContain("cimmichMode === 'evidence'");
    expect(page).toContain('getCimmichPersonEvidenceCoverage(cimmichPerson.person_id)');
    expect(page).toContain('<CimmichPersonEvidenceCoverage');
  });

  it('reconciles photo and observation populations with actionable context and exact review routes', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichPersonEvidenceCoverage.svelte', 'utf8');

    expect(source).toContain('Evidence &amp; coverage');
    expect(source).toContain('none is an identity-confidence score');
    expect(source).toContain('Profile photos');
    expect(source).toContain('Accepted evidence photos');
    expect(source).toContain('Outside this map');
    expect(source).toContain("label: 'Face photos'");
    expect(source).toContain("label: 'Body photos'");
    expect(source).toContain("label: 'Body-only photos'");
    expect(source).toContain("label: 'Head photos'");
    expect(source).toContain("label: 'Presence photos'");
    expect(source).toContain("label: 'Pose geometry'");
    expect(source).toContain('Matcher reference gallery');
    expect(source).toContain('Supporting matcher refs');
    expect(source).toContain('Representative evidence');
    expect(source).toContain("overlay: 'machinery'");
    expect(source).toContain('contextHref(group.kind, item.entityId)');
    expect(source).toContain('Context observed');
    expect(source).toContain('Coverage notes');
    expect(source).toContain("onopenidentity('candidates')");
    expect(source).toContain('onopenphotos({ futureDates: true })');
    expect(source).not.toContain('for covers or closer review');
  });
});
