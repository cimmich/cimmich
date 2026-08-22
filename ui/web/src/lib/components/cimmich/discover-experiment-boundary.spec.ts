import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

describe('Discover experimental boundary', () => {
  it('defaults off and keeps a separate durable preference', async () => {
    const store = await read('src/lib/stores/cimmich-experience.store.ts');

    expect(store).toContain("CIMMICH_DISCOVER_EXPERIMENT_PREFERENCE_KEY = 'cimmich-discover-experiment-v1'");
    expect(store).toContain('PUBLIC_CIMMICH_DISCOVER_EXPERIMENTAL_DEFAULT');
    expect(store).toContain("resolveCimmichExperimentDefault = (value: string | undefined) => value === 'true'");
  });

  it('hides both navigation entry points while the experiment is off', async () => {
    const [frontier, companion] = await Promise.all([
      read('src/lib/components/shared-components/side-bar/CimmichSidebar.svelte'),
      read('src/lib/components/shared-components/side-bar/ImmichSidebar.svelte'),
    ]);

    expect(frontier).toContain('{#if $cimmichDiscoverExperiment}');
    expect(companion).toContain('...($cimmichDiscoverExperiment');
  });

  it('gates direct Discover and Person-web access before requesting graph data', async () => {
    const [discover, personWeb] = await Promise.all([
      read('src/routes/(user)/cimmich/discover/+page.svelte'),
      read('src/lib/components/cimmich/CimmichPersonConnectionWeb.svelte'),
    ]);

    for (const source of [discover, personWeb]) {
      expect(source).toContain('if (!$cimmichDiscoverExperiment)');
      expect(source).toContain('<CimmichExperimentPrompt');
    }
  });

  it('does not offer the Person Web toggle as a core connection view', async () => {
    const toolbar = await read('src/lib/components/cimmich/CimmichPersonConnectionToolbar.svelte');

    expect(toolbar).toContain('{#if $cimmichDiscoverExperiment}');
    expect(toolbar.indexOf('{#if $cimmichDiscoverExperiment}')).toBeLessThan(toolbar.indexOf('aria-label="Web view"'));
  });
});
