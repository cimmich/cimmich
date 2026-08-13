import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Person overview actions and split workspace', () => {
  it('places Needs attention, Merge and Split directly below Review queue', async () => {
    const overview = await readFile('src/lib/components/cimmich/CimmichPersonEvidenceCoverage.svelte', 'utf8');

    expect(overview).toContain('Review queue');
    expect(overview).toContain('Organise this person');
    expect(overview).toContain('Needs attention');
    expect(overview).toContain('Merge');
    expect(overview).toContain('Split');
    expect(overview.indexOf('Review queue')).toBeLessThan(overview.indexOf('Organise this person'));
    expect(overview.indexOf('Organise this person')).toBeLessThan(overview.indexOf('Technical details'));
    expect(overview).toContain('aria-pressed={needsAttention}');
    expect(overview).toContain('onclick={onneedsattention}');
    expect(overview).toContain('onclick={onmerge}');
    expect(overview).toContain('onclick={onsplit}');
  });

  it('routes Split to a dedicated bulk face workspace with only explicit destinations', async () => {
    const [component, load, navigation, page] = await Promise.all([
      readFile('src/lib/components/cimmich/CimmichPersonSplitWorkspace.svelte', 'utf8'),
      readFile('src/routes/(user)/cimmich/people/[personName]/+page.ts', 'utf8'),
      readFile('src/lib/components/cimmich/person-workspace-navigation.ts', 'utf8'),
      readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8'),
    ]);

    expect(load).toContain("resolvedMode === 'split'");
    expect(navigation).toContain("| 'split'");
    expect(page).toContain("const openCimmichSplit = () => selectCimmichMode('split')");
    expect(page).toContain("cimmichMode === 'split'");
    expect(page).toContain('<CimmichPersonSplitWorkspace');
    expect(component).toContain('Create New');
    expect(component).toContain('Move to');
    expect(component).toContain('setCimmichFaceIdentitiesBatch');
    expect(component).toContain('getCimmichIdentityFaces(person.person_id, 5000)');
    expect(component).toContain("getCimmichPeople(500, '', { presentation: false })");
    expect(component).toContain("personPhotoGridClass('medium')");
    expect(component).not.toContain('lg:grid-cols-6 xl:grid-cols-8');
    expect(component).toContain('const selectionLimit = 100');
    expect(component).toContain('row.person_id !== person.person_id');
    expect(component).toContain('!row.needs_holding');
    expect(component).toContain(
      "action === 'create' ? { faceId, newPersonName: name } : { faceId, personId: movePersonId }",
    );
    expect(component).not.toContain('mergeCimmichPeople');
    expect(component).not.toContain('setCimmichPersonCategory');
    expect(component).toContain('Smart split');
    expect(component).toContain('getCimmichSmartSplitRecommendations');
    expect(component).toContain('Anything ambiguous stays together in Unclear');
    expect(component).toContain("smartRecommendations.groups.find(({ kind }) => kind === 'clear')");
  });

  it('keeps Needs attention one-click while Holding remains guarded', async () => {
    const page = await readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8');

    expect(page).toContain('const toggleCimmichNeedsAttention = async () =>');
    expect(page).toContain("setup.category_catalog.find(({ slug }) => slug === 'sort')");
    expect(page).toContain('cimmichPerson.needs_holding && cimmichPerson.needs_sort');
    expect(page).toContain('needsAttentionDisabled={cimmichPerson.needs_holding}');
    expect(page).not.toContain('Keep matches visible, but treat this identity as review-only.');
  });
});
