import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('context collection search', () => {
  it('updates collection results as the user types and keeps Enter immediate', async () => {
    const source = await readFile('src/lib/components/cimmich/CimmichContextBrowser.svelte', 'utf8');

    expect(source).toContain('oninput={queueCollectionSearch}');
    expect(source).toContain('globalThis.setTimeout(() =>');
    expect(source).toContain('void loadEntities({ preserveCollection: true });');
    expect(source).toContain('submitCollectionSearch();');
    expect(source).toContain('onDestroy(clearCollectionSearchTimeout);');
  });

  it('sends a bounded query and matches both display names and aliases', async () => {
    const [client, service] = await Promise.all([
      readFile('src/lib/services/cimmich.service.ts', 'utf8'),
      readFile('../../service/src/context-entities.mjs', 'utf8'),
    ]);

    expect(client).toContain("search.set('q', options.query.trim());");
    expect(service).toContain('entity.display_name ILIKE ${search}');
    expect(service).toContain('alias.label ILIKE ${search}');
    expect(service).toContain('LIMIT ${cleanLimit(limit)}');
  });
});
