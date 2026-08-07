import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Archive integrity layout', () => {
  it('keeps exact duplicate discovery explicit, inspectable and read-only', async () => {
    const source = await readFile('src/routes/(user)/cimmich/archive-integrity/+page.svelte', 'utf8');
    const backupProof = await readFile('src/lib/components/cimmich/ArchiveBackupProof.svelte', 'utf8');
    const variants = await readFile('src/lib/components/cimmich/archive-variant-groups.ts', 'utf8');
    const maintenance = await readFile('src/routes/(user)/cimmich/maintenance/+page.svelte', 'utf8');
    const normalizedSource = source.replaceAll(/\s+/g, ' ');

    expect(source).toContain('Know what is genuinely duplicated');
    expect(source).toContain('Exact means byte-for-byte');
    expect(source).toContain('Sidecars are');
    expect(source).toContain('not compared yet');
    expect(source).toContain('Route.viewAsset({ id: copy.sourceAssetId })');
    expect(source).toContain('Similar variants');
    expect(normalizedSource).toContain('Similarity is a lead, not deletion proof');
    expect(variants).toContain('Immich People differ');
    expect(normalizedSource).toContain('Cimmich intelligence follows verified content');
    expect(normalizedSource).toContain('Suggested keep/bin decisions are deliberately');
    expect(source).not.toContain('resolveDuplicates');
    expect(source).not.toContain('suggestedKeepAssetIds');
    expect(source).toContain('Canonical plan');
    expect(normalizedSource).toContain('A preservation lead, never a deletion instruction');
    expect(normalizedSource).toContain('No recommendation is saved or grants authority to retire a file');
    expect(variants).toContain("status: 'hold_ambiguous'");
    expect(variants).toContain('originalCaptureExtensions');
    expect(source).toContain('Backup proof');
    expect(source).toContain('Same disk is not a backup');
    expect(source).toContain('physical storage domain');
    expect(backupProof).toContain('Retirement safety gate');
    expect(backupProof).toContain('Independent backup proof');
    expect(backupProof).toContain('0 verified independent destinations');
    expect(backupProof).toContain('distinct failure domain');
    expect(backupProof).toContain('Future retirement also requires the owner-approved sidecar set');
    expect(backupProof).toContain('Not proven');
    expect(backupProof).not.toContain("method: 'POST'");
    expect(source).toContain('Sidecar export');
    expect(source).not.toContain("method: 'POST'");
    expect(maintenance).toContain('Route.cimmichArchiveIntegrity()');
    expect(maintenance).toContain('Exact duplicate discovery');
  });
});
