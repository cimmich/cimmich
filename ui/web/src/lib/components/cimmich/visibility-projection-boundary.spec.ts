import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Cimmich visibility projection boundary', () => {
  it.each([
    'src/lib/components/cimmich/CimmichPhotoOverlay.svelte',
    'src/lib/components/cimmich/CimmichAppearancesPanel.svelte',
    'src/lib/components/cimmich/CimmichContextBrowser.svelte',
    'src/lib/components/cimmich/CimmichDocuments.svelte',
    ['src/routes/(user)/cimmich', 'home', '+page.svelte'].join('/'),
    'src/routes/(user)/cimmich/objects/+page.svelte',
    'src/routes/(user)/cimmich/people/+page.svelte',
    'src/routes/(user)/cimmich/people/[personName]/+page.svelte',
    'src/routes/(user)/cimmich/smart-search/+page.svelte',
    'src/routes/(user)/cimmich/steward/+page.svelte',
  ])('%s subscribes and suppresses stale projection responses', (path) => {
    const contents = source(path);
    expect(contents).toContain('cimmichVisibilityManager.version');
    expect(contents).toMatch(/(?:generation|Generation)/);
    expect(contents).toMatch(/(?:generation|Generation)\s*!==|(?:generation|Generation)\s*===/);
  });

  it('re-discovers current eligible identity correction Undo after navigation or reload', () => {
    expect(source('src/lib/components/cimmich/CimmichPhotoOverlay.svelte')).toContain(
      'getCimmichIdentityCorrectionDiscovery({ sourceAssetId: assetId }',
    );
    expect(source('src/routes/(user)/cimmich/people/[personName]/+page.svelte')).toContain(
      '{ personId: row.person_id }',
    );
  });

  it('requests archived detail only for a row already disclosed by the archived collection', () => {
    expect(source('src/lib/components/cimmich/CimmichContextBrowser.svelte')).toContain(
      "includeArchived: entity.status === 'archived'",
    );
  });
});
