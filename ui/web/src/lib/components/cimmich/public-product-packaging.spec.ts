import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceRoot = resolve(process.cwd(), 'src');

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
    }),
  );
  return files.flat();
};

describe('public Cimmich packaging boundary', () => {
  it('ships no lab-era local API routes', async () => {
    const files = await sourceFiles(resolve(sourceRoot, 'routes/cimmich-api'));
    expect(files).toEqual([]);
  });

  it('contains no public caller for lab endpoints or proof filesystem roots', async () => {
    const allFiles = await sourceFiles(sourceRoot);
    const files = allFiles.filter((path) => !path.endsWith('.spec.ts') && /\.(?:svelte|ts)$/.test(path));
    const sources = await Promise.all(files.map((path) => readFile(path, 'utf8')));
    const combined = sources.join('\n');

    expect(combined).not.toMatch(/\/cimmich-api\//);
    expect(combined).not.toMatch(/\/cimmich-data\//);
    expect(combined).not.toMatch(/CIMMICH_(?:RMP|FULL_ARCHIVE_QC)_/);
    expect(combined).not.toMatch(/(?:\/mnt\/cimmich|\/media\/library|runtime\/cimmich\/(?:step2|wave1|full-archive))/);
  });

  it('keeps canonical API calls behind the Cimmich service boundary', async () => {
    const service = await readFile(resolve(sourceRoot, 'lib/services/cimmich.service.ts'), 'utf8');
    expect(service).toContain('request<CimmichAssetEvidence>(`/v1/assets/evidence?');
    expect(service).toContain("request<CimmichIntegrationStatus>('/v1/integrations/status')");
  });
});
