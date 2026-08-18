import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('photo correction integration', () => {
  it('replaces the redundant review label with date/place context and reversible rotation', async () => {
    const [person, media, controller, image] = await Promise.all([
      read('../../../routes/(user)/cimmich/people/[personName]/+page.svelte'),
      read('./CimmichReviewPhotoMedia.svelte'),
      read('./photo-review-controller.svelte.ts'),
      read('./CimmichIdentityReviewImage.svelte'),
    ]);
    expect(person).not.toContain('Photo to review');
    expect(person).toContain('<CimmichReviewPhotoMedia');
    expect(media).toContain('{contextLabel || filename}');
    expect(media).toContain("onRotate('left')");
    expect(media).toContain("onRotate('right')");
    expect(media).toContain('fitReviewPhotoPreview');
    expect(media).toContain('bind:clientHeight={previewViewportHeight}');
    expect(media).toContain('bind:clientWidth={previewViewportWidth}');
    expect(media).toContain('previewZoom = 1');
    expect(media).not.toContain('requestAnimationFrame(centerPreview)');
    expect(media).not.toContain('width: max(100%, min(');
    expect(controller).toContain('async undo(assetId: string, decisionId: string)');
    expect(image).toContain('stroke-width="2"');
    expect(image).toContain('stroke-dasharray="0.1 4"');
    expect(image).toContain('stroke-linecap="round"');
  });

  it('offers detail checks and promotes orientation into Archive Health', async () => {
    const [page, archiveHealth, rotationReview] = await Promise.all([
      read('../../../routes/(user)/cimmich/steward/photos/+page.svelte'),
      read('../../../routes/(user)/cimmich/archive-integrity/+page.svelte'),
      read('./ArchiveRotationReview.svelte'),
    ]);
    expect(page).toContain("{ id: 'orientation', label: 'Orientation' }");
    expect(page).toContain("{ id: 'dates', label: 'Dates' }");
    expect(page).toContain("{ id: 'locations', label: 'Locations' }");
    expect(page).toContain('source media and Immich');
    expect(archiveHealth).toContain("mode: 'rotation'");
    expect(archiveHealth).toContain('setCimmichAssetRotations');
    expect(archiveHealth).toContain('confirmCandidateRotations');
    expect(archiveHealth).not.toContain('undoCimmichAssetCorrections');
    expect(page).toContain('undoCimmichAssetCorrections');
    expect(rotationReview).toContain("Immich's visual index");
    expect(rotationReview).toContain('<CimmichReviewPhotoMedia');
    expect(rotationReview).toContain('Save / Confirm all');
  });
});
