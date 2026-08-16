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
    'src/routes/(user)/cimmich/+page.svelte',
    'src/routes/(user)/cimmich/pets/+page.svelte',
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
    expect(source('src/lib/components/cimmich/person-secondary-projections.ts')).toContain(
      'getCimmichIdentityCorrectionDiscovery({ personId }, { limit: 12 })',
    );
  });

  it('keeps People and Context inside the single centred photo toolbar', () => {
    const overlay = source('src/lib/components/cimmich/CimmichPhotoOverlay.svelte');
    const navbar = source('src/lib/components/asset-viewer/AssetViewerNavBar.svelte');
    expect(overlay).toContain('<Portal target="#cimmich-photo-overlay-toolbar">');
    expect(overlay).toContain('class="pointer-events-auto flex shrink-0 items-center gap-1"');
    expect(navbar).toContain('id="cimmich-photo-overlay-toolbar"');
    expect(navbar).toContain('items-center justify-center gap-0.5 overflow-x-auto');
    expect(overlay).not.toContain('fixed top-17');
  });

  it('requests archived detail only for a row already disclosed by the archived collection', () => {
    expect(source('src/lib/components/cimmich/CimmichContextBrowser.svelte')).toContain(
      "const includeArchived = selected.entity.status === 'archived'",
    );
  });
});
