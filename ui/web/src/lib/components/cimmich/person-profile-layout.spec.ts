import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPersonProfile = () => readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8');

describe('Person profile layout', () => {
  it('opens with a photo-led identity hero instead of an administrative record card', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('data-testid="cimmich-person-hero"');
    expect(source).toContain('style={cimmichPersonHeroStyle(cimmichPerson)}');
    expect(source).toContain('min-h-100');
    expect(source).toContain('sm:text-5xl lg:text-6xl');
    expect(source).toContain('bg-linear-to-r from-black/92');
    expect(source).toContain('ring-4 ring-white/90');
    expect(source).toContain('bg-black/30 px-3 font-semibold backdrop-blur-md');
  });

  it('pins navigation and editing to the hero corners while keeping administration in Details', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('absolute top-5 left-5 z-10');
    expect(source).toContain('absolute top-5 right-5 z-10');
    expect(source).toContain('<CimmichObjectVisibility');
    expect(source).toContain('Merge duplicate');
    expect(source).toContain('data-testid="cimmich-person-edit"');
    expect(source).toContain(
      "cimmichPerson?.subject_kind === 'person' ? openCimmichDetails() : void openCimmichSetup()",
    );
    expect(source).not.toContain('startInEdit={cimmichProfileEditOnOpen}');
    expect(source).toContain("field.fieldKey === 'gender_identity'");
    expect(source).toContain('icon={cimmichGenderIcon ?? mdiGenderMaleFemaleVariant}');
  });

  it('keeps Photos visual controls compact and makes Tags a bucket-first matching library', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('aria-label="Photo view options"');
    expect(source).toContain('aria-label="Thumbnail size"');
    expect(source).toContain('<option value="medium">Medium</option>');
    expect(source).toContain('<h2 class="text-xl font-semibold">Face matching references</h2>');
    expect(source).toContain('<legend class="sr-only">Choose a Face matching reference bucket</legend>');
    expect(source).toContain("{ id: 'prime', label: 'Strong', description: 'Best reference photos' }");
    expect(source).toContain("{ id: 'head', label: 'Head references', description: 'Face-derived, not manual tags' }");
    expect(source).toContain("{ id: 'non_face', label: 'Not for matching', description: 'Body and Presence truth' }");
    expect(source).toContain('manual Head tags are not counted in this library');
    expect(source).toContain('No Face-derived Head references');
    expect(source).toContain("association_types.includes('body') || association_types.includes('presence')");
    expect(source).not.toContain("id: 'face_only', label: 'Not used'");
    expect(source).not.toContain('Tagged appearances');
    expect(source).not.toContain('Filter tagged appearances');
    expect(source).toContain("preparePersonPhotos(cimmichAssets, 'all', cimmichPhotoSort)");
    expect(source).toContain("{cimmichFuturePhotoDateCount === 1 ? 'date needs' : 'dates need'} review");
    expect(source).toContain('date.getTime() > Date.now()');
  });

  it('promotes Connections and keeps Details free of add and administration rails', async () => {
    const source = await readPersonProfile();

    expect(source).toContain("cimmichMode === 'connections'");
    expect(source).toContain('aria-label="Connections"');
    expect(source).not.toContain('id="person-connections-heading"');
    expect(source).not.toContain("connected through {cimmichPerson.display_name}'s photo stories");
    expect(source).toContain(".filter((category) => category.category_kind === 'relationship')");
    expect(source).toContain(".join(' · ') || 'Connected person'");
    expect(source).toContain("{ id: 'person', label: 'People' }");
    expect(source).toContain("{ id: 'event', label: 'Events' }");
    expect(source).toContain("{ id: 'place', label: 'Places' }");
    expect(source).toContain("{ id: 'object', label: 'Things' }");
    expect(source.indexOf("{ id: 'person', label: 'People' }")).toBeLessThan(
      source.indexOf("{ id: 'event', label: 'Events' }"),
    );
    expect(source).not.toContain('aria-label="Details tools"');
    expect(source).not.toContain('cimmichQuickDetailActions');
    expect(source).toContain('<h2 class="text-lg font-semibold">Profile settings</h2>');
  });
});
