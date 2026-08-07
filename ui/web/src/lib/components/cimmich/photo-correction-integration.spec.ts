import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('photo correction integration', () => {
  it('replaces the redundant review label with date/place context and reversible rotation', async () => {
    const [person, media, controller] = await Promise.all([
      read('../../../routes/(user)/cimmich/people/[personName]/+page.svelte'),
      read('./CimmichReviewPhotoMedia.svelte'),
      read('./photo-review-controller.svelte.ts'),
    ]);
    expect(person).not.toContain('Photo to review');
    expect(person).toContain('<CimmichReviewPhotoMedia');
    expect(media).toContain('{contextLabel || filename}');
    expect(media).toContain("onRotate('left')");
    expect(media).toContain("onRotate('right')");
    expect(controller).toContain('async undo(assetId: string, decisionId: string)');
  });

  it('offers a separate Photo details review with deterministic tabs', async () => {
    const page = await read('../../../routes/(user)/cimmich/steward/photos/+page.svelte');
    expect(page).toContain("{ id: 'orientation', label: 'Orientation' }");
    expect(page).toContain("{ id: 'dates', label: 'Dates' }");
    expect(page).toContain("{ id: 'locations', label: 'Locations' }");
    expect(page).toContain('source media and Immich');
  });
});
