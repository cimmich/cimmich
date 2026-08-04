import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('nested Event context', () => {
  it('separates direct membership from inherited nested context', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichContextBrowser.svelte', 'utf8');

    expect(source).toContain('child.subtreeAssetCount ?? child.assetCount');
    expect(source).toContain('{child.assetCount} direct');
    expect(source).toContain('including nested moments');
    expect(source).toContain('aria-label="Event hierarchy"');
  });
});
