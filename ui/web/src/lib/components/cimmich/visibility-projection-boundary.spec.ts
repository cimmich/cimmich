import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Cimmich visibility projection boundary', () => {
  it.each([
    'src/lib/components/cimmich/CimmichPhotoOverlay.svelte',
    'src/lib/components/cimmich/CimmichAppearancesPanel.svelte',
    'src/lib/components/cimmich/CimmichContextBrowser.svelte',
    'src/lib/components/cimmich/CimmichTagBrowser.svelte',
    'src/lib/components/cimmich/CimmichVisualSearch.svelte',
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

  it.each([
    ['Home', 'src/routes/(user)/cimmich/+page.svelte', 'summary = undefined'],
    ['Context detail', 'src/lib/components/cimmich/CimmichContextBrowser.svelte', 'clearSelectedProjection'],
    ['Visual Search', 'src/lib/components/cimmich/CimmichVisualSearch.svelte', 'assets = []'],
    ['Organise Tags', 'src/lib/components/cimmich/CimmichTagBrowser.svelte', 'cimmichOptions = []'],
  ])('%s synchronously clears the previously disclosed projection', (_surface, path, resetEvidence) => {
    const contents = source(path);
    expect(contents).toContain('beginCimmichProjection');
    expect(contents).toContain(resetEvidence);
  });

  it('invalidates dependent Home-cover and Context-detail requests at the same privacy boundary', () => {
    const home = source('src/routes/(user)/cimmich/+page.svelte');
    const context = source('src/lib/components/cimmich/CimmichContextBrowser.svelte');

    expect(home).toMatch(/beginCimmichProjection[\s\S]{0,300}coverGeneration \+= 1/);
    expect(context).toMatch(/clearSelectedProjection[\s\S]{0,300}connectionPresentationGeneration \+= 1/);
    expect(context).toMatch(/clearSelectedProjection[\s\S]{0,300}nearbyGeneration \+= 1/);
    expect(context).toMatch(/clearSelectedProjection[\s\S]{0,300}photoLocationGeneration \+= 1/);
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
    expect(navbar).toContain(
      'items-center justify-center gap-0.5 overflow-x-visible text-white *:shrink-0 sm:shrink sm:overflow-x-auto',
    );
    expect(overlay).not.toContain('fixed top-17');
  });

  it('requests archived detail only for a row already disclosed by the archived collection', () => {
    expect(source('src/lib/components/cimmich/CimmichContextBrowser.svelte')).toContain(
      "const includeArchived = selected.entity.status === 'archived'",
    );
  });
});
