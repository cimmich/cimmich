import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Archive integrity layout', () => {
  it('keeps exact duplicate discovery explicit, inspectable and read-only', async () => {
    const source = await readFile('src/routes/(user)/cimmich/archive-integrity/+page.svelte', 'utf8');
    const maintenance = await readFile('src/routes/(user)/cimmich/maintenance/+page.svelte', 'utf8');

    expect(source).toContain('Know what is genuinely duplicated');
    expect(source).toContain('Exact means byte-for-byte');
    expect(source).toContain('Sidecars are');
    expect(source).toContain('not compared yet');
    expect(source).toContain('Route.viewAsset({ id: copy.sourceAssetId })');
    expect(source).toContain('Metadata variants');
    expect(source).toContain('Backup proof');
    expect(source).toContain('Sidecar export');
    expect(source).not.toContain("method: 'POST'");
    expect(maintenance).toContain('Route.cimmichArchiveIntegrity()');
    expect(maintenance).toContain('Exact duplicate discovery');
  });
});
