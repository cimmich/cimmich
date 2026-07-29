import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readOverlay = () => readFile('src/lib/components/cimmich/CimmichPhotoOverlay.svelte', 'utf8');

describe('Face evidence reclassification', () => {
  it('classifies the selected box instead of offering unrelated add actions', async () => {
    const source = await readOverlay();

    expect(source).toContain('aria-label="Treat selected box as"');
    expect(source).toContain("{#each ['face', 'head', 'body'] as evidenceKind");
    expect(source).toContain('Reclassifies this same highlighted box.');
    expect(source).not.toContain('Add missed Head');
    expect(source).not.toContain('Add missed Body');
  });

  it('turns the same Face region into Body evidence and retires the mistaken Face', async () => {
    const source = await readOverlay();

    expect(source).toContain('const region = observationRegion(faceBox(face), image);');
    expect(source).toContain("tagType: 'body'");
    expect(source).toContain('await markCimmichFaceNotFace(face.id');
    expect(source).toContain('The original Face observation was retired.');
  });
});
