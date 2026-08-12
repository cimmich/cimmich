<script lang="ts">
  import { Route } from '$lib/route';
  import type { CimmichPersonAsset } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import CimmichStatePanel from './CimmichStatePanel.svelte';
  import type { CimmichIdentityFilter } from './person-workspace-navigation';

  interface Props {
    assets: CimmichPersonAsset[];
    filter: Extract<CimmichIdentityFilter, 'appearance' | 'body' | 'head' | 'presence'>;
    limit: number;
    onshowmore: () => void;
    personId: string;
    personName: string;
  }

  let { assets, filter, limit, onshowmore, personId, personName }: Props = $props();

  const emptyTitle = $derived(
    filter === 'appearance'
      ? 'No Appearance photos'
      : filter === 'head'
        ? 'No Head photos'
        : filter === 'body'
          ? 'No Body photos'
          : 'No Presence photos',
  );
  const emptyDescription = $derived(
    filter === 'appearance'
      ? 'Photos with a Head or Body placement, but no usable Face, will appear here.'
      : filter === 'head'
        ? 'Head placements without a usable Face will appear here.'
        : filter === 'body'
          ? 'Body placements without a usable Face will appear here.'
          : 'Photos attributed to this person without visible person geometry will appear here.',
  );
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
  {#each assets.slice(0, limit) as asset (asset.asset_id)}
    {@const hasBody = asset.association_types.includes('body')}
    {@const hasHead = asset.association_types.includes('head')}
    {@const hasPresence =
      asset.association_types.includes('presence') || asset.association_types.includes('body_candidate')}
    <article
      class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <a
        href={Route.viewCimmichPersonAsset({
          id: asset.sourceAssetId,
          overlay: 'people',
          personId,
          personName,
        })}
        class="group relative block aspect-4/5 overflow-hidden bg-gray-200 dark:bg-gray-800"
        title={asset.filename}
      >
        <img
          class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
          src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
          alt={asset.filename}
        />
        <div class="pointer-events-none absolute right-2 bottom-2 flex flex-wrap justify-end gap-1">
          {#if hasHead}
            <span class="rounded-sm bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">Head</span>
          {/if}
          {#if hasBody}
            <span class="rounded-sm bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">Body</span>
          {/if}
          {#if hasPresence}
            <span class="rounded-sm bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">Presence</span>
          {/if}
        </div>
      </a>
      <div class="grid gap-1 p-2.5">
        <p class="text-xs font-semibold">
          {[hasHead ? 'Head' : '', hasBody ? 'Body' : '', hasPresence ? 'Presence' : ''].filter(Boolean).join(' · ')}
        </p>
        <p class="truncate text-[11px] text-gray-500 dark:text-gray-400" title={asset.filename}>{asset.filename}</p>
      </div>
    </article>
  {/each}
</div>

{#if assets.length === 0}
  <CimmichStatePanel title={emptyTitle} description={emptyDescription} />
{/if}

{#if assets.length > limit}
  <button
    class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium dark:bg-immich-dark-gray"
    type="button"
    onclick={onshowmore}>Show 20 more</button
  >
{/if}
