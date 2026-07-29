import { readFile } from 'node:fs/promises';

describe('Pet unknown review workspace', () => {
  it('makes unmatched animal detections visible and directly classifiable', async () => {
    const source = await readFile('src/routes/(user)/cimmich/pets/+page.svelte', 'utf8');

    expect(source).toContain('Unknown pets');
    expect(source).toContain('No identity cleared the matching threshold');
    expect(source).toContain("reviewUnknownPet(observation, 'assign', pet.petId)");
    expect(source).toContain("reviewUnknownPet(observation, 'reject')");
    expect(source).toContain('border-2 border-dashed');
    expect(source).toContain('Not a {observation.speciesKind.replace');
  });

  it('uses the connected unknown read and owner-decision endpoints', async () => {
    const service = await readFile('src/lib/services/cimmich.service.ts', 'utf8');

    expect(service).toContain('/v1/pets/matching/unknown?limit=');
    expect(service).toContain('/v1/pets/matching/unknown/${encodeURIComponent(observationId)}/${action}');
    expect(service).toContain("headers: { 'x-cimmich-actor': 'local-operator' }");
  });
});
