<script lang="ts">
  import type {
    CimmichArchiveBackupProofItem,
    CimmichArchiveBackupProofPage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import ArchiveBackupProof from './ArchiveBackupProof.svelte';
  import DatabaseBackupHealth from './DatabaseBackupHealth.svelte';
  import type { ArchiveVariantGroup } from './archive-variant-groups';

  interface Props {
    error: string;
    exactGroupCount: number;
    groups: ArchiveVariantGroup[];
    items: Map<string, CimmichArchiveBackupProofItem>;
    loaded: boolean;
    loading: boolean;
    summary: CimmichArchiveBackupProofPage['summary'];
  }

  let props: Props = $props();
  let backupKind = $state<'database' | 'photos'>('photos');
</script>

<section class="space-y-4" aria-label="Backup check">
  <div class="flex justify-center">
    <nav
      class="flex rounded-full bg-gray-100 p-1 dark:bg-gray-900"
      aria-label="Backup type"
      title="Choose whether to check photo files or protect the Cimmich database"
    >
      <button
        type="button"
        class="min-h-10 rounded-full px-5 text-sm font-semibold {backupKind === 'photos'
          ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
          : 'text-gray-600 dark:text-gray-300'}"
        aria-pressed={backupKind === 'photos'}
        onclick={() => (backupKind = 'photos')}>Photos</button
      >
      <button
        type="button"
        class="min-h-10 rounded-full px-5 text-sm font-semibold {backupKind === 'database'
          ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
          : 'text-gray-600 dark:text-gray-300'}"
        aria-pressed={backupKind === 'database'}
        onclick={() => (backupKind = 'database')}>Database</button
      >
    </nav>
  </div>

  {#if backupKind === 'photos'}
    <ArchiveBackupProof {...props} />
  {:else}
    <DatabaseBackupHealth />
  {/if}
</section>
