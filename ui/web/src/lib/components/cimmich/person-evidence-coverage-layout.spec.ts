import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Person identity overview', () => {
  it('merges the former Evidence surface into a reloadable Identity overview', async () => {
    const [page, load, navigation, tabs] = await Promise.all([
      readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8'),
      readFile('src/routes/(user)/cimmich/people/[personName]/+page.ts', 'utf8'),
      readFile('src/lib/components/cimmich/person-workspace-navigation.ts', 'utf8'),
      readFile('src/lib/components/cimmich/CimmichPersonPrimaryTabs.svelte', 'utf8'),
    ]);

    expect(load).toContain("mode === 'evidence' ? 'identity'");
    expect(load).toContain("mode === 'evidence' ? 'overview'");
    expect(navigation).not.toContain("| 'evidence'");
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('use:keyboardTabs');
    expect(tabs).not.toContain('label="Evidence"');
    expect(tabs).toContain('Identity');
    expect(page).toContain("cimmichIdentityFilter === 'overview'");
    expect(page).toContain('getCimmichPersonEvidenceCoverage(cimmichPerson.person_id)');
    expect(page).toContain('<CimmichPersonEvidenceCoverage');
  });

  it('leads with photos and user questions while keeping machinery detail optional', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichPersonEvidenceCoverage.svelte', 'utf8');

    expect(source).toContain('{coverage.person.displayName} in Cimmich');
    expect(source).toContain('{coverage.assets.total.toLocaleString()} available photos');
    expect(source).not.toContain('missingSourceCount');
    expect(source).not.toContain('source files missing');
    expect(source).not.toContain('not connected yet');
    expect(source).toContain('Recognition examples');
    expect(source).toContain('shown oldest first');
    expect(source).toContain('How Cimmich recognises {coverage.person.displayName}');
    expect(source).toContain('Why do these numbers overlap?');
    expect(source).toContain('When these photos were taken');
    expect(source).toContain('Where {coverage.person.displayName} appears');
    expect(source).toContain('Needs your attention');
    expect(source).toContain('Advanced evidence details');
    expect(source).toContain('What these terms mean');
    expect(source).toContain('Imported Body hint');
    expect(source).not.toContain('none is an identity-confidence score');
    expect(source).not.toContain('Outside this map');
    expect(source).not.toContain('Coverage notes');
    expect(source).not.toContain('Representative evidence');
    expect(source).not.toContain('None observed');
    expect(source).toContain("label: 'Face photos'");
    expect(source).toContain("label: 'Body photos'");
    expect(source).toContain("label: 'Body-only photos'");
    expect(source).toContain("label: 'Head photos'");
    expect(source).toContain("label: 'Presence photos'");
    expect(source).toContain("label: 'Pose geometry'");
    expect(source).toContain('Recognition reference gallery');
    expect(source).toContain('Supporting matcher refs');
    expect(source).toContain("overlay: 'machinery'");
    expect(source).toContain('contextHref(group.kind, item.entityId)');
    expect(source).toContain("onopenidentity('body')");
    expect(source).toContain("onopenidentity('candidates')");
    expect(source).toContain('onopenphotos({ futureDates: true })');
    expect(source).toContain('actionableNotes');
  });
});
