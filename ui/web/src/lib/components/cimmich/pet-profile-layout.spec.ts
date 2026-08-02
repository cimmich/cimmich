import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPetWorkspace = () => readFile('src/routes/(user)/cimmich/pets/+page.svelte', 'utf8');

describe('Pet profile layout', () => {
  it('turns an opened Pet into a destination instead of retaining collection controls', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('{#if !selectedPet}\n      <CimmichSectionHeader');
    expect(source).toContain('onclick={closePet}');
    expect(source).toContain('<Icon icon={mdiArrowLeft} size="16" />');
    expect(source).toContain('onclick={beginEdit}>Edit profile</button');
    expect(source).toContain('aria-label="Edit display photos"');
    expect(source).not.toContain('onfocus={() => selectedPet && closePet()}');
  });

  it('opens with the same immersive identity-hero rhythm as People', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('data-testid="cimmich-pet-hero"');
    expect(source).toContain(
      'class="relative min-h-100 overflow-hidden rounded-[1.75rem] bg-slate-950 text-white shadow-2xl ring-1 ring-white/10"',
    );
    expect(source).toContain('bg-linear-to-r from-black/92 via-black/60 to-black/18');
    expect(source).toContain('rounded-full bg-slate-700 bg-cover bg-center shadow-2xl ring-4 ring-white/90');
    expect(source).toContain('text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl');
    expect(source.indexOf('data-testid="cimmich-pet-hero"')).toBeLessThan(source.indexOf('aria-label="Pet content"'));
    expect(source).not.toContain('sm:grid-cols-[minmax(15rem,42%)_minmax(0,1fr)]');
  });

  it('keeps display-photo maintenance in the hero shortcut and gallery actions', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain("onclick={() => selectPetContent('display')}");
    expect(source).toContain("'Current profile photo' : 'Use as profile photo'");
    expect(source).toContain("'Current hero photo' : 'Use as hero photo'");
    expect(source).not.toContain("title: selectedPet?.cover ? 'Change cover' : 'Choose cover'");
  });

  it('makes photos navigable while keeping evidence machinery out of the gallery', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('href={Route.viewCimmichPetAsset({');
    expect(source).toContain(
      'aria-label={`Open ${formatCaptureDate(item.capture_time)} photo of ${selectedPet.displayName}`}',
    );
    expect(source).not.toContain('<CimmichEvidenceBadge');
    expect(source).not.toContain('Advanced: attach by Cimmich asset ID');
  });

  it('keeps the active Photos action in the shared content rail', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain("{#if activePetContent === 'photos'}");
    expect(source).toContain("{$t('add_photos')}");
    expect(source).not.toContain('<h2 class="text-xl font-semibold">Photos of {selectedPet.displayName}</h2>');
  });

  it('adds the shared selected-photo workspace to confirmed Pet media', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('<CimmichEntityMediaActions');
    expect(source).toContain("subjectKind: 'pet'");
    expect(source).toContain('petMediaSelectionMode');
    expect(source).toContain('Maximum ${ENTITY_MEDIA_SELECTION_LIMIT} photos');
    expect(source).toContain('handleCimmichMediaCardClick(event, petMediaSelectionMode');
    expect(source).not.toContain("tagType: 'face'");
  });

  it('gives Pet profiles the same durable information architecture as People', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('type PetContentView,');
    expect(source).toContain('const requestedPetContent = $derived(getPetContentView(page.url));');
    expect(source).toContain('const href = getPetContentHref(page.url, view);');
    expect(source).toContain('id="pet-details-tab"');
    expect(source).toContain('id="pet-connections-tab"');
    expect(source).toContain('id="pet-documents-tab"');
    expect(source.indexOf('id="pet-photos-tab"')).toBeLessThan(source.indexOf('id="pet-details-tab"'));
    expect(source.indexOf('id="pet-details-tab"')).toBeLessThan(source.indexOf('id="pet-connections-tab"'));
    expect(source.indexOf('id="pet-connections-tab"')).toBeLessThan(source.indexOf('id="pet-documents-tab"'));
  });

  it('makes Details useful without exposing internal IDs or pretending missing Pet fields exist', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('<h2 class="text-xl font-semibold">Profile details</h2>');
    expect(source).toContain('Other names');
    expect(source).toContain('Photo history');
    expect(source).toContain('Care and records');
    expect(source).toContain("onclick={() => selectPetContent('documents')}");
    expect(source).not.toContain('Microchip ID');
    expect(source).not.toContain('Registration ID');
  });

  it('renders real privacy-filtered connections as destination cards', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('selectedPet.connections.length === 0');
    expect(source).toContain('title="No connections yet"');
    expect(source).toContain('Part of {selectedPet.displayName}’s story');
    expect(source).toContain('getPetRelatedConnectionsHref(selectedPet.displayName, group.items, group.kind)');
    expect(source).toContain('href={getPetConnectionHref(connection)}>Show</a');
    expect(source).not.toContain('Connections will appear here');
  });

  it('places independent Pet visibility beside the global profile controls', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('<CimmichObjectVisibility');
    expect(source).toContain('object={selectedPet.visibility}');
    expect(source).toContain('objectLabel="Pet"');
  });

  it('uses one owner-facing Documents system instead of stacking two competing workflows', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('<CimmichDocuments');
    expect(source).toContain("subject={{ id: selectedPet.petId, kind: 'pet', name: selectedPet.displayName }}");
    expect(source).not.toContain('CimmichLegacyPetDocuments');
    expect(source).not.toContain('Photo-linked records');
    expect(source).not.toContain('selectedPet.documentCount');
  });

  it('keeps the tab rail usable on narrow screens without hiding Add photos', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('min-w-0 flex-1 overflow-x-auto');
    expect(source).toContain("aria-label={$t('add_photos')}");
    expect(source).toContain('<span class="hidden sm:inline">{$t(\'add_photos\')}</span>');
    expect(source).toContain('>\n                  Documents\n                </button>');
    expect(source).toContain("onkeydown={(event) => handlePetContentKeydown(event, 'photos')}");
    expect(source).toContain("tabindex={activePetContent === 'documents' ? 0 : -1}");
    expect(source).toContain('bind:this={photosTab}');
  });
});
