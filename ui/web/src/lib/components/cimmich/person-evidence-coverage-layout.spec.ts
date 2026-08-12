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

  it('shows observed ratios, diverse source frames, context and review notes without a confidence score', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichPersonEvidenceCoverage.svelte', 'utf8');

    expect(source).toContain('Evidence &amp; coverage');
    expect(source).toContain('they are not identity confidence or a completeness score');
    expect(source).toContain("label: 'Face observed'");
    expect(source).toContain("label: 'Body observed'");
    expect(source).toContain("label: 'Pose geometry'");
    expect(source).toContain('Source suggestions');
    expect(source).toContain("overlay: 'machinery'");
    expect(source).toContain('Context observed');
    expect(source).toContain('Coverage notes');
    expect(source).not.toContain('confidence score:');
  });
});
