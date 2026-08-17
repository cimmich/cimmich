import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nestedFiles.flat();
};

describe('Archive integrity layout', () => {
  it('keeps em dashes out of Web copy', async () => {
    const allFiles = await sourceFiles('src');
    const files = allFiles.filter((file) => file.endsWith('.svelte') || file.endsWith('.ts'));
    const sources = await Promise.all(files.map(async (file) => ({ file, source: await readFile(file, 'utf8') })));
    const violations = sources.filter(({ source }) => source.includes('\u2014')).map(({ file }) => file);

    expect(violations).toEqual([]);
  });

  it('keeps exact duplicate discovery explicit, inspectable and read-only', async () => {
    const source = await readFile('src/routes/(user)/cimmich/archive-integrity/+page.svelte', 'utf8');
    const backupProof = await readFile('src/lib/components/cimmich/ArchiveBackupProof.svelte', 'utf8');
    const variants = await readFile('src/lib/components/cimmich/archive-variant-groups.ts', 'utf8');
    const maintenance = await readFile('src/routes/(user)/cimmich/maintenance/+page.svelte', 'utf8');
    const folderPage = await readFile(
      'src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/+page.svelte',
      'utf8',
    );
    const normalizedSource = source.replaceAll(/\s+/g, ' ');

    expect(source).toContain('Archive Health');
    expect(source).toContain('Exact means byte-for-byte');
    expect(source).toContain('Route.viewAsset({ id: copy.sourceAssetId })');
    expect(source).toContain('Possible duplicates');
    expect(normalizedSource).toContain('A visual match is a review lead, not deletion proof');
    expect(variants).toContain('Immich People differ');
    expect(normalizedSource).toContain('Cimmich intelligence follows verified content');
    expect(source).not.toContain('resolveDuplicates');
    expect(source).not.toContain('suggestedKeepAssetIds');
    expect(source).not.toContain('Canonical plan');
    expect(source).toContain('Recommended to keep');
    expect(source).toContain('No safe recommendation');
    expect(source).toContain('Why this recommendation');
    expect(source).toContain('archiveVariantFolderContext(variantGroups, asset)');
    expect(source).toContain('Folder check');
    expect(source).toContain('Check one folder against the archive');
    expect(source).toContain('Most impacted folders');
    expect(source).toContain('rankArchiveFoldersByImpact(nativeGroups)');
    expect(source).toContain('affectedAssetCount');
    expect(source).toContain('counterpartFolderCount');
    expect(source).toContain("'affected file'");
    expect(source).toContain("'other folder'");
    expect(source).toContain('name="folder"');
    expect(source).toContain('<form\n            data-sveltekit-reload');
    expect(source).toContain("folder: folderContext.path, mode: 'folder'");
    expect(folderPage).toContain('Check this folder');
    expect(folderPage).toContain("mode: 'folder'");
    expect(source.match(/data-sveltekit-reload/g)?.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain('other flagged photo');
    expect(source).toContain('Technical details');
    expect(variants).toContain("status: 'hold_ambiguous'");
    expect(variants).toContain('originalCaptureExtensions');
    expect(source).toContain('Backup status');
    expect(backupProof).toContain('Retirement safety gate');
    expect(backupProof).toContain('Independent backup proof');
    expect(backupProof).toContain('0 verified independent destinations');
    expect(backupProof).toContain('distinct failure domain');
    expect(backupProof).toContain('Future retirement also requires the owner-approved sidecar set');
    expect(backupProof).toContain('Not proven');
    expect(backupProof).not.toContain("method: 'POST'");
    expect(source).not.toContain('Next integrity layers');
    expect(source).not.toContain('Sidecar export');
    expect(source).not.toContain("method: 'POST'");
    expect(maintenance).toContain('Route.cimmichArchiveIntegrity()');
    expect(maintenance).toContain('Exact duplicate discovery');
  });
});
