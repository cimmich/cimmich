import { readFile } from 'node:fs/promises';

describe('Pet unknown review workspace', () => {
  it('makes unmatched animal detections visible and owner-assignable', async () => {
    const route = await readFile('src/routes/(user)/cimmich/pets/+page.svelte', 'utf8');
    const source = await readFile('src/lib/components/cimmich/CimmichPetUnknownReview.svelte', 'utf8');

    expect(route).toContain('<CimmichPetUnknownReview');
    expect(source).toContain('Unknown pets');
    expect(source).toContain('No identity cleared the matching threshold');
    expect(source).toContain('openAssignment(observation)');
    expect(source).toContain("selectAssignmentMode('existing')");
    expect(source).toContain("selectAssignmentMode('new')");
    expect(source).toContain("reviewUnknown(observation, 'assign', selectedPet.petId, createSpeciesKind)");
    expect(source).toContain('createCimmichPet({ ...payload, commandId: createCommand.id })');
    expect(source).toContain("reviewUnknown(observation, 'assign', result.pet.petId, createSpeciesKind)");
    expect(source).toContain("reviewUnknown(observation, 'reject')");
    expect(source).toContain('commandFor(reviewCommand, `pet-unknown-${action}`, payload)');
    expect(source).toContain('onclick={() => void submitAssignment()}');
    expect(source).toContain('change this if the detector is wrong');
    expect(source).toContain('<Select bind:value={createSpeciesKind} options={speciesOptions} />');
    expect(source).toContain("formError = 'Give this Pet a name before creating it.'");
    expect(source).toContain('border-2 border-dashed');
    expect(source).toContain('Not a {observation.speciesKind.replace');
  });

  it('uses the connected unknown read and owner-decision endpoints', async () => {
    const service = await readFile('src/lib/services/cimmich.service.ts', 'utf8');

    expect(service).toContain('/v1/pets/matching/unknown?limit=');
    expect(service).toContain('/v1/pets/matching/unknown/${encodeURIComponent(observationId)}/${action}');
    expect(service).toContain('body: JSON.stringify({ commandId, petId, speciesKind })');
    expect(service).toContain("headers: { 'x-cimmich-actor': 'local-operator' }");
  });
});
