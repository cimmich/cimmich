import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('shared entity media action integration', () => {
  it('uses one action implementation across Places, Things, Events, People and Pets', async () => {
    const [context, people, pets] = await Promise.all([
      read('src/lib/components/cimmich/CimmichContextBrowser.svelte'),
      read('src/routes/(user)/cimmich/people/[personName]/+page.svelte'),
      read('src/routes/(user)/cimmich/pets/+page.svelte'),
    ]);

    expect(context).toContain('<CimmichEntityMediaActions');
    expect(context).toContain('family: activeFamily');
    expect(people).toContain('<CimmichEntityMediaActions');
    expect(pets).toContain('<CimmichEntityMediaActions');
  });

  it('keeps entity changes, contextual links and subject presence semantically separate', async () => {
    const source = await read('src/lib/components/cimmich/CimmichEntityMediaActions.svelte');
    const contract = await read('src/lib/components/cimmich/entity-media-actions.ts');

    expect(source).toMatch(/associationKind\s*=\s*selectedAction === 'event-attach' \? 'direct'/);
    expect(source).toContain("selectedAction === 'place-attach' ? 'captured_at' : 'depicts'");
    expect(source).toContain("action: 'attach'");
    expect(contract).toContain("subjectKind: 'person' | 'pet'");
    expect(source).not.toContain('manual-subject-tags');
    expect(source).not.toContain("tagType: 'face'");
  });

  it('starts with no implied action and provides a typeable destination', async () => {
    const source = await read('src/lib/components/cimmich/CimmichEntityMediaActions.svelte');

    expect(source).toContain("$state<CimmichEntityMediaActionKind | null>(null)");
    expect(source).toContain('Pick action…');
    expect(source).toContain('Type to search…');
    expect(source).toContain('list="entity-media-destinations"');
  });

  it('persists one exact Undo receipt and blocks a second action until disposition', async () => {
    const source = await read('src/lib/components/cimmich/CimmichEntityMediaActions.svelte');

    expect(source).toContain('saveCimmichEntityMediaActionReceipt');
    expect(source).toContain('!receipt');
    expect(source).toContain('Undo is saved across navigation and reload.');
    expect(source).toContain('undoCimmichContextDecision');
    expect(source).toContain('undoCimmichManualPresence');
    expect(source).toContain('undoCimmichVisibilityDecision');
  });
});
