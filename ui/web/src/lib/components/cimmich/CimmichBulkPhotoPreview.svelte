<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheckCircleOutline } from '@mdi/js';

  interface Props {
    assets: AssetResponseDto[];
    current: boolean;
    hasMore: boolean;
    total: number;
  }

  let { assets, current, hasMore, total }: Props = $props();
  const previewUrl = (asset: AssetResponseDto) =>
    getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail, cacheKey: asset.thumbhash });
</script>

<section
  class="mt-6 rounded-3xl border border-black/10 bg-white p-5 shadow-sm sm:p-7 dark:border-white/10 dark:bg-immich-dark-gray"
>
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h2 class="text-xl font-semibold text-immich-primary dark:text-immich-dark-primary">2. Inspect the preview</h2>
      <p class="mt-2 text-sm text-immich-fg/65 dark:text-immich-dark-fg/65">
        Showing {assets.length.toLocaleString()} of
        <strong>{total.toLocaleString()}{hasMore ? '+' : ''}</strong> matching items. The exact total is calculated before
        final confirmation.
      </p>
    </div>
    {#if current}
      <span
        class="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
      >
        <Icon icon={mdiCheckCircleOutline} size="18" /> Preview current
      </span>
    {/if}
  </div>
  {#if assets.length > 0}
    <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
      {#each assets as asset (asset.id)}
        <article class="min-w-0 overflow-hidden rounded-2xl bg-black/5 dark:bg-white/5">
          <img
            class="aspect-square w-full object-cover"
            src={previewUrl(asset)}
            alt={asset.originalFileName}
            loading="lazy"
          />
          <div class="p-2">
            <p class="truncate text-xs font-semibold" title={asset.originalFileName}>{asset.originalFileName}</p>
            <p class="mt-1 truncate text-[11px] opacity-60">{asset.fileCreatedAt.slice(0, 10)}</p>
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <div class="mt-5 rounded-2xl bg-black/5 px-4 py-8 text-center text-sm opacity-70 dark:bg-white/5">
      No photos match these filters.
    </div>
  {/if}
</section>
