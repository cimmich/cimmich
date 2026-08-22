<script lang="ts">
  import type { CimmichPersonConnectionView } from './person-page-types';
  import { mdiFormatListBulleted, mdiGraphOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { cimmichDiscoverExperiment } from '$lib/stores/cimmich-experience.store';

  interface Props {
    onchange: (view: CimmichPersonConnectionView) => void;
    view: CimmichPersonConnectionView;
  }

  let { onchange, view }: Props = $props();
</script>

<div class="ml-auto flex min-w-max items-stretch">
  <div class="flex items-stretch" role="group" aria-label="Connection view options">
    <button
      class={[
        'inline-flex h-12 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition sm:px-4',
        view === 'list'
          ? 'border-primary text-primary'
          : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
      ]}
      type="button"
      aria-label="List view"
      aria-pressed={view === 'list'}
      onclick={() => onchange('list')}
    >
      <Icon icon={mdiFormatListBulleted} size="19" />
      <span>List</span>
    </button>
    {#if $cimmichDiscoverExperiment}
      <button
        class={[
          'inline-flex h-12 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition sm:px-4',
          view === 'web'
            ? 'border-primary text-primary'
            : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg',
        ]}
        type="button"
        aria-label="Web view"
        aria-pressed={view === 'web'}
        onclick={() => onchange('web')}
      >
        <Icon icon={mdiGraphOutline} size="19" />
        <span>Web</span>
      </button>
    {/if}
  </div>
</div>
