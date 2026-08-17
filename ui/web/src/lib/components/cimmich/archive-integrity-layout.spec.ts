import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Archive integrity layout', () => {
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
    expect(source).toContain('name="folder"');
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
