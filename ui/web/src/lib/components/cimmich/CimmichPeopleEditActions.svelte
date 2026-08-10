<script lang="ts">
  import { Icon, Tooltip } from '@immich/ui';
  import { mdiAccountMultipleOutline, mdiTargetAccount } from '@mdi/js';

  interface Props {
    bulkFaceCount: number;
    bulkOpen: boolean;
    detailed: boolean;
    onToggleBulk: () => void;
    onToggleDetailed: () => void;
  }

  let { bulkFaceCount, bulkOpen, detailed, onToggleBulk, onToggleDetailed }: Props = $props();
</script>

<Tooltip text={detailed ? 'Finish editing' : 'Edit people tags'}>
  {#snippet child({ props })}
    <button
      {...props}
      class={[
        'flex h-10 items-center justify-center gap-2 rounded-full border px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        detailed
          ? 'border-white bg-white text-black shadow-sm'
          : 'border-white/25 bg-black/25 text-white hover:border-white/45 hover:bg-white/10',
      ]}
      type="button"
      aria-label={detailed ? 'Finish editing people tags' : 'Edit people tags'}
      aria-pressed={detailed}
      onclick={onToggleDetailed}
      data-testid="cimmich-detailed-view"
    >
      <Icon icon={mdiTargetAccount} size="18" />
      <span class="hidden text-sm font-medium sm:inline">{detailed ? 'Done' : 'Edit'}</span>
    </button>
  {/snippet}
</Tooltip>

{#if bulkFaceCount > 1}
  <Tooltip text={bulkOpen ? 'Close all Face tags' : 'Edit all Face tags'}>
    {#snippet child({ props })}
      <button
        {...props}
        class={[
          'flex h-10 items-center justify-center gap-2 rounded-full border px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
          bulkOpen
            ? 'border-white bg-white text-black shadow-sm'
            : 'border-white/25 bg-black/25 text-white hover:border-white/45 hover:bg-white/10',
        ]}
        type="button"
        aria-label={bulkOpen ? 'Close all Face tags' : 'Edit all Face tags'}
        aria-pressed={bulkOpen}
        onclick={onToggleBulk}
      >
        <Icon icon={mdiAccountMultipleOutline} size="18" />
        <span class="hidden text-sm font-medium sm:inline">All Faces</span>
      </button>
    {/snippet}
  </Tooltip>
{/if}
