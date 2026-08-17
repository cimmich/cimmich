<script lang="ts">
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiRefresh } from '@mdi/js';

  type ArchiveHealthMode = 'exact' | 'variants' | 'folder' | 'backup';

  interface Props {
    exactCount?: number;
    mode: ArchiveHealthMode;
    onRefresh: () => void;
    possibleCount?: number;
    refreshing: boolean;
  }

  let { exactCount, mode, onRefresh, possibleCount, refreshing }: Props = $props();
  const tabClass = (active: boolean) =>
    `min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${
      active
        ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-950'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
    }`;
</script>

<header class="rounded-3xl bg-[#111815] p-5 text-white shadow-sm sm:px-6">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="max-w-3xl">
      <h1 class="text-2xl font-semibold tracking-tight">Archive Health</h1>
      <p class="mt-1 text-sm text-slate-300">
        Check exact copies, possible duplicates, folders and independent backups. Nothing is changed here.
      </p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
      disabled={refreshing}
      onclick={onRefresh}
    >
      <Icon icon={mdiRefresh} size="18" class={refreshing ? 'animate-spin' : ''} />
      Refresh
    </button>
  </div>
</header>

<nav
  class="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-gray-200 bg-white p-1 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
  aria-label="Archive integrity evidence layer"
>
  <a
    data-sveltekit-reload
    href={Route.cimmichArchiveIntegrity({ mode: 'exact' })}
    class={tabClass(mode === 'exact')}
    aria-current={mode === 'exact' ? 'page' : undefined}
  >
    Exact copies {exactCount === undefined ? '' : `(${exactCount.toLocaleString()})`}
  </a>
  <a
    data-sveltekit-reload
    href={Route.cimmichArchiveIntegrity({ mode: 'variants' })}
    class={tabClass(mode === 'variants')}
    aria-current={mode === 'variants' ? 'page' : undefined}
  >
    Possible duplicates {possibleCount === undefined ? '' : `(${possibleCount.toLocaleString()})`}
  </a>
  <a
    data-sveltekit-reload
    href={Route.cimmichArchiveIntegrity({ mode: 'folder' })}
    class={tabClass(mode === 'folder')}
    aria-current={mode === 'folder' ? 'page' : undefined}
  >
    Folder check
  </a>
  <a
    data-sveltekit-reload
    href={Route.cimmichArchiveIntegrity({ mode: 'backup' })}
    class={tabClass(mode === 'backup')}
    aria-current={mode === 'backup' ? 'page' : undefined}
  >
    Backup status
  </a>
</nav>
