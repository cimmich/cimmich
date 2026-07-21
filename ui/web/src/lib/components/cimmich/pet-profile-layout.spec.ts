import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPetWorkspace = () => readFile('src/routes/(user)/cimmich/objects/+page.svelte', 'utf8');

describe('Pet profile layout', () => {
  it('turns an opened Pet into a destination instead of retaining collection controls', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain('{#if !selectedPet}\n      <CimmichSectionHeader');
    expect(source).toContain('onclick={closePet}');
    expect(source).toContain('<Icon icon={mdiArrowLeft} size="17" />');
    expect(source).toContain('aria-label={`Edit ${selectedPet.displayName}`}');
    expect(source).not.toContain('onfocus={() => selectedPet && closePet()}');
  });

  it('keeps cover maintenance in the profile menu and gallery actions', async () => {
    const source = await readPetWorkspace();

    expect(source).toContain(
      "actions.push({ title: 'Adjust cover', icon: mdiCrop, onAction: openCurrentCoverEditor });",
    );
    expect(source).toContain("title: selectedPet?.cover ? 'Change cover' : 'Choose cover'");
    expect(source).not.toContain('class="absolute bottom-3 left-3 flex flex-wrap gap-2"');
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
    expect(source).toContain('<span class="sm:hidden">Docs</span><span class="hidden sm:inline">Documents</span>');
    expect(source).toContain("onkeydown={(event) => handlePetContentKeydown(event, 'photos')}");
    expect(source).toContain("tabindex={activePetContent === 'documents' ? 0 : -1}");
    expect(source).toContain('bind:this={photosTab}');
  });
});
