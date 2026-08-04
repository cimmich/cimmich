import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPersonPage = () => readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8');

describe('Person identity move Undo', () => {
  it('retains an exact reverse-move receipt and exposes it beside the move result', async () => {
    const source = await readPersonPage();

    expect(source).toContain('let cimmichIdentityMoveUndo = $state<CimmichIdentityMoveUndo | null>(null);');
    expect(source).toContain('destinationPersonId: result.personId');
    expect(source).toContain('originalPersonId: result.previousPersonId');
    expect(source).toContain('moveCimmichIdentityFace(receipt.destinationPersonId, receipt.faceId');
    expect(source).toContain("cimmichIdentitySavingId === 'undo:move' ? 'Undoing…' : 'Undo move'");
    expect(source).toContain('cimmichIdentityMoveUndo = null;');
  });
});
