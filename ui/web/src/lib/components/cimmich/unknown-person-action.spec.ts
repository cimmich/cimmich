import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Unknown person review action', () => {
  it('records the reversible owner disposition instead of inventing a named Person', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichUnknownPersonAction.svelte', 'utf8');

    expect(source).toContain('setCimmichFaceReviewDisposition(');
    expect(source).toContain("'unknown'");
    expect(source).toContain("createCimmichIdentityCorrectionCommandId('person-review-unknown')");
    expect(source).toContain("{saving ? 'Saving…' : 'Unknown person'}");
    expect(source).toContain('onChanged();');
  });
});
