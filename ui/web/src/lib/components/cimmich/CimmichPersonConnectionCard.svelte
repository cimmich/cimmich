<script lang="ts">
  import type { CimmichPersonConnection } from '$lib/components/cimmich/person-page-types';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { mdiShapeOutline, mdiTagMultipleOutline, mdiTrashCanOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';

  let {
    connection,
    href,
    ondescribe,
    onremove,
    saving,
  }: {
    connection: CimmichPersonConnection;
    href: string;
    ondescribe: () => void;
    onremove: () => void;
    saving: boolean;
  } = $props();

  const describable = $derived(connection.entityKind === 'person' || connection.entityKind === 'place');
</script>

<div
  class="relative grid overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
>
  <a
    class="group grid min-h-28 grid-cols-[7rem_1fr] overflow-hidden transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:bg-white/5"
    {href}
  >
    {#if connection.sourceAssetId}
      <span class="relative block size-28 self-center overflow-hidden bg-gray-200 dark:bg-gray-700">
        <img
          class={connection.portraitStyle
            ? 'max-w-none transition duration-200 group-hover:scale-[1.03]'
            : 'size-full object-cover transition duration-200 group-hover:scale-[1.03]'}
          src={getAssetMediaUrl({ id: connection.sourceAssetId, size: AssetMediaSize.Thumbnail })}
          style={connection.portraitStyle}
          alt=""
        />
      </span>
    {:else}
      <span class="flex size-full items-center justify-center bg-primary/10 text-primary" aria-hidden="true">
        <Icon icon={mdiShapeOutline} size="30" />
      </span>
    {/if}
    <span class="flex min-w-0 flex-col justify-center p-4 pr-12">
      <span class="text-xs font-semibold tracking-wide text-gray-400 uppercase">
        {connection.entityKind === 'person' ? connection.metaLabel : connection.typeKind.replaceAll('_', ' ')}
      </span>
      <span class="mt-1 truncate font-semibold">{connection.displayName}</span>
      <span class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {#if connection.entityKind === 'person'}
          {#if connection.photoCount > 0}
            {connection.photoCount.toLocaleString()} shared {connection.photoCount === 1 ? 'photo' : 'photos'}
          {/if}
          {#if connection.photoCount > 0 && (connection.contextCount ?? 0) > 0}
            ·
          {/if}
          {#if (connection.contextCount ?? 0) > 0}
            {(connection.contextCount ?? 0).toLocaleString()} shared
            {connection.contextCount === 1 ? 'context' : 'contexts'}
          {/if}
        {:else if connection.photoCount > 0}
          {connection.photoCount.toLocaleString()} {connection.photoCount === 1 ? 'photo' : 'photos'}
        {:else}
          {connection.metaLabel || 'Connected'}
        {/if}
      </span>
    </span>
  </a>
  {#if describable}
    <div class="flex min-h-11 items-center justify-between gap-2 border-t border-gray-100 px-3 dark:border-gray-800">
      <button
        class="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/10"
        type="button"
        aria-label={`Describe connection to ${connection.displayName}`}
        onclick={ondescribe}
      >
        <Icon icon={mdiTagMultipleOutline} size="17" />
        {connection.recordedFacts?.length ? 'Edit relationship' : 'Describe connection'}
      </button>
      {#if connection.recordedFacts?.length}
        <span class="text-xs font-medium text-gray-500">{connection.recordedFacts.length} recorded</span>
      {/if}
    </div>
  {/if}
  {#if connection.directRelations?.length}
    <button
      class="absolute top-2 right-2 flex size-11 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-sm hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 dark:bg-immich-dark-gray/90 dark:text-gray-300 dark:hover:bg-red-950 dark:hover:text-red-200"
      type="button"
      aria-label={`Remove linked roles from ${connection.displayName}`}
      title={`Remove linked roles from ${connection.displayName}`}
      disabled={saving}
      onclick={onremove}><Icon icon={mdiTrashCanOutline} size="18" /></button
    >
  {/if}
</div>
