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
    const folderComparison = await readFile('src/lib/components/cimmich/ArchiveFolderComparison.svelte', 'utf8');
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
    expect(source).toContain("mode === 'folder' ? 'Folder Check' : 'Archive Health'");
    expect(source).toContain('Back to Archive Health');
    expect(source).toContain('Most impacted folders');
    expect(source).toContain('rankArchiveFoldersByImpact(nativeVariantGroups)');
    expect(source).toContain('affectedAssetCount');
    expect(source).toContain('counterpartFolderCount');
    expect(source).toContain("'affected file'");
    expect(source).toContain("'other folder'");
    expect(source).toContain('name="folder"');
    expect(source).toContain('onsubmit={submitFolder}');
    expect(source).toContain("replaceState(Route.cimmichArchiveIntegrity({ folder: folderPath, mode: 'folder' })");
    expect(source).toContain('archiveVariantGroupsInFolder(allNativeGroups, folderPath)');
    expect(source).toContain('readArchiveEvidence(sourceAssetIds)');
    expect(source).toContain('uniqueSourceAssetIds.slice(index * 20, index * 20 + 20)');
    expect(source).toContain('nativeGroups.slice(0, 12)');
    expect(source).toContain('loadMoreVariants');
    expect(source).toContain('Comparisons load in small batches');
    expect(source).toContain('This comparison took too long');
    expect(source).toContain("case 'exact':");
    expect(source).toContain("case 'folder':");
    expect(source).not.toContain('void loadFolderAssets();');
    expect(source).toContain("folder: folderContext.path, mode: 'folder'");
    expect(folderPage).toContain('Check this folder');
    expect(folderPage).toContain("mode: 'folder'");
    expect(source.match(/data-sveltekit-reload/g)?.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain('other flagged photo');
    expect(source).toContain('Technical details');
    expect(variants).toContain("status: 'hold_ambiguous'");
    expect(variants).toContain('originalCaptureExtensions');
    expect(source).toContain('Backup check');
    expect(folderComparison).toContain('Biggest overlaps');
    expect(folderComparison).toContain('Show top 6 only');
    expect(folderComparison).toContain('Also found elsewhere');
    expect(folderComparison).toContain('No match elsewhere');
    expect(folderComparison).toContain('Repeated only inside');
    expect(folderComparison).toContain('Check byte details');
    expect(folderComparison).toContain('Every copy is on one line. Highlighted rows contain different values.');
    expect(folderComparison).toContain('alignAssets(group.here, outsideAssets)');
    expect(folderComparison).toContain('repeat(${comparisonAssets.length}, 13rem)');
    expect(folderComparison).toContain('group block aspect-4/3 w-full');
    expect(folderComparison).toContain('Recommended to keep');
    expect(folderComparison).toContain('Review only');
    expect(folderComparison).toContain('This is a review recommendation, not deletion proof.');
    expect(folderComparison).toContain("plan.status === 'hold_exact' || plan.status === 'hold_ambiguous'");
    expect(folderComparison).toContain('visibleRecommendation(group.canonicalPlan, comparisonAssets)');
    expect(folderComparison).toContain('The archive-wide winner is outside this folder pair.');
    expect(folderComparison).toContain('No safe recommendation');
    expect(folderComparison).toContain('recommendedAssetId === asset.id');
    expect(folderComparison).toContain("label: 'File location'");
    expect(folderComparison).toContain("label: 'File size'");
    expect(folderComparison).toContain("label: 'Resolution'");
    expect(folderComparison).toContain("label: 'Captured'");
    expect(folderComparison).toContain("label: 'File modified'");
    expect(folderComparison).toContain("label: 'Photo location'");
    expect(folderComparison).toContain("label: 'Camera'");
    expect(folderComparison).toContain('More Immich metadata, same columns');
    expect(folderComparison).toContain("label: 'Rotation'");
    expect(folderComparison).toContain("label: 'Description'");
    expect(folderComparison).toContain("label: 'Rating'");
    expect(folderComparison).toContain("label: 'Immich People'");
    expect(folderComparison).toContain("label: 'Immich Tags'");
    expect(folderComparison).toContain("label: 'Favourite'");
    expect(folderComparison).toContain("label: 'Archive status'");
    expect(folderComparison).toContain("label: 'Visibility'");
    expect(backupProof).toContain('Retirement safety gate');
    expect(backupProof).toContain('No independent backup connected');
    expect(backupProof).toContain('targetsLoaded && targets.length > 0');
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
