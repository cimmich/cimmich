import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Pet hero framing', () => {
  it('renders the saved 12:5 crop inside the same 12:5 viewport shown by Display', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/routes/(user)/cimmich/objects/+page.svelte'), 'utf8');

    expect(source).toMatch(
      /data-testid="cimmich-pet-hero-photo-frame"[\s\S]*?petPresentationImageStyle\('hero', petPresentation\.hero\)/,
    );
    expect(source).toMatch(
      /class="absolute inset-x-0 top-0 block aspect-12\/5 overflow-hidden"[\s\S]*?data-testid="cimmich-pet-hero-photo-frame"/,
    );
    expect(source).not.toMatch(
      /<img\s+class="absolute max-w-none"\s+src=\{petPresentationImageUrl\(petPresentation\.hero\)\}/,
    );
  });
});
