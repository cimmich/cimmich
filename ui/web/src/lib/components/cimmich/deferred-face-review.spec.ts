import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readSteward = () => readFile('src/routes/(user)/cimmich/steward/+page.svelte', 'utf8');
const readOverlay = async () => {
  const sources = await Promise.all([
    readFile('src/lib/components/cimmich/CimmichPhotoOverlay.svelte', 'utf8'),
    readFile('src/lib/components/cimmich/CimmichFaceReviewQueueActions.svelte', 'utf8'),
    readFile('src/lib/services/cimmich-deferred-face-review.ts', 'utf8'),
  ]);
  return sources.join('\n');
};

describe('Durable deferred Face review', () => {
  it('persists Steward Later and exposes a resumable queue', async () => {
    const source = await readSteward();

    expect(source).toContain('getCimmichDeferredFaceReviews(100)');
    expect(source).toContain('saveActiveForLater');
    expect(source).toContain('setCimmichFaceReviewDisposition(');
    expect(source).toContain("'steward-review-later'");
    expect(source).toContain('Saved for later');
    expect(source).toContain('Durable review pointers');
    expect(source).toContain('resumeDeferred');
    expect(source).not.toContain("resultMessage = 'Skipped for this visit.'");
  });

  it('lets a misaligned region enter the durable Box fixes lane', async () => {
    const source = await readOverlay();

    expect(source).toContain('Fix box later');
    expect(source).toContain("onSet('later', 'geometry')");
    expect(source).toContain('Saved in Box fixes. This Face will not be lost when matching changes.');
  });
});
