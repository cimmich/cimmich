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
    expect(source).toContain('data-testid="cimmich-person-display-shortcut"');
    expect(source).toContain(
      "aria-label={cimmichPerson.subject_kind === 'person' ? 'Edit display photos' : 'Edit details'}",
    );
    expect(source).toContain('void openCimmichDisplay()');
    expect(source).not.toContain('<span>Edit</span>');
    expect(source).not.toContain('startInEdit={cimmichProfileEditOnOpen}');
    expect(source).toContain("field.fieldKey === 'gender_identity'");
    expect(source).toContain('icon={cimmichGenderIcon ?? mdiGenderMaleFemaleVariant}');
  });

  it('keeps Photos compact and makes Identity an operational maintenance workspace', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('aria-label="Photo view options"');
    expect(source).toContain('aria-label="Thumbnail size"');
    expect(source).toContain('<option value="medium">Medium</option>');
    expect(source).toContain('<h2 class="text-xl font-semibold">Identity</h2>');
    expect(source).toContain('Display photos');
    expect(source).toContain('Face photo');
    expect(source).toContain('Body photo');
    expect(source).toContain('Hero photo');
    expect(source).toContain('Identity workspaces');
    expect(source).toContain('grid grid-cols-4 gap-2 sm:grid-cols-8');
    expect(source).not.toContain('overflow-x-auto pb-1');
    expect(source).toContain("{ id: 'presentation', label: 'Display'");
    expect(source).toContain('aria-label="Display photo choices"');
    expect(source).toContain("{ id: 'prime', label: 'Prime'");
    expect(source).toContain("{ id: 'secondary', label: 'Supporting'");
    expect(source).toContain('Use automatic');
    expect(source).toContain("'Not selected'");
    expect(source).toContain("cimmichIdentityFilter === 'candidates'");
    expect(source).toContain("cimmichPresentationPickerSlot === slotKind ? '' : slotKind");
    expect(source).toContain('Select from this person');
    expect(source).toContain('Drag · Wheel · Arrow keys');
    expect(source).toContain('startCimmichPresentationDrag');
    expect(source).toContain('zoomCimmichPresentation');
    expect(source).toContain('keyCimmichPresentation');
    expect(source).toContain("slotKind === 'face'");
    expect(source).toContain("'aspect-square h-[76%] rounded-full'");
    expect(source).toContain("'aspect-12/5 w-[94%] rounded-lg'");
    expect(source).toContain("media?.selectionMode === 'automatic'");
    expect(source).toContain('class="max-w-none"');
    expect(source).toContain('width: ${100 / crop.w}%');
    expect(source).toContain('height: auto');
    expect(source).not.toContain('Save framing');
    expect(source).not.toContain('Choose confirmed evidence below for the Face, Body, and Hero image.');
    expect(source).not.toContain("'Automatic'");
    expect(source).not.toContain('mt-4 grid gap-3 border-t');
    expect(source).toContain("label: 'Prime'");
    expect(source).toContain("label: 'Supporting'");
    expect(source).toContain("label: 'Unclassified'");
    expect(source).toContain('Awaiting confirmation');
    expect(source).toContain('Show 20 more');
    expect(source).toContain('getCimmichIdentityFaces(personId, 5000)');
    expect(source).toContain('setCimmichPersonPresentation(cimmichPerson.person_id, slotKind');
    expect(source).toContain("chooseCimmichPresentation('face', face, 'face')");
    expect(source).toContain("chooseCimmichPresentation('body', face, 'body')");
    expect(source).toContain("chooseCimmichPresentation('hero', face, 'face')");
    expect(source).toContain('Reject selected');
    expect(source).toContain("{ id: 'prime', label: 'Strong', description: 'Best reference photos' }");
    expect(source).toContain("{ id: 'head', label: 'Head references', description: 'Face-derived, not manual tags' }");
    expect(source).toContain(
      "{ id: 'non_face', label: 'Body & Presence', description: 'Appearance evidence, not matching references' }",
    );
    expect(source).toContain('manual Head tags are not counted in this library');
    expect(source).toContain('No Face-derived Head references');
    expect(source).toContain("association_types.includes('body') || association_types.includes('presence')");
    expect(source).toContain('Review face');
    expect(source).not.toContain("id: 'face_only', label: 'Not used'");
    expect(source).not.toContain('<h2 class="text-xl font-semibold">Matching</h2>');
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
