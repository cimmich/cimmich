<script lang="ts">
  import { Route } from '$lib/route';
  import type { CimmichPersonAsset } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiDeleteClockOutline } from '@mdi/js';
  import CimmichDuplicateIndicator from './CimmichDuplicateIndicator.svelte';
  import { handleCimmichMediaCardClick } from './media-card-selection';
  import { personFaceCropStyle, personPhotoDateLabel, type PersonPhotoView } from './person-photo-gallery';

  interface Props {
    asset: CimmichPersonAsset;
    ontoggle: () => void;
    personId: string;
    personName: string;
    selected: boolean;
    selectionMode: boolean;
    view: PersonPhotoView;
  }

  let { asset, ontoggle, personId, personName, selected, selectionMode, view }: Props = $props();
</script>

{#if asset.sourceAssetId}
  <article
    class="group relative aspect-square overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-800"
    class:ring-4={selected}
    class:ring-primary={selected}
  >
    <a
      href={Route.viewCimmichPersonAsset({ id: asset.sourceAssetId, personId, personName })}
      class="block size-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      title={asset.filename}
      onclick={(event) => handleCimmichMediaCardClick(event, selectionMode, ontoggle)}
    >
      {#if view === 'face' && asset.face_crop}
        <img
          src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
          alt={`${personName} face in ${asset.filename}`}
          class="max-w-none transition-transform group-hover:scale-[1.02]"
          style={personFaceCropStyle(asset)}
          loading="lazy"
        />
      {:else}
        <img
          src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
          alt={asset.filename}
          class="size-full object-cover transition-transform group-hover:scale-[1.02]"
          class:opacity-55={view === 'face'}
          loading="lazy"
        />
      {/if}
      {#if view === 'face' && !asset.face_crop}
        <span
          class="pointer-events-none absolute top-10 left-2 rounded-full bg-black/70 px-2 py-1 text-[11px] font-semibold text-white shadow-sm"
          >No face crop</span
        >
      {/if}
      <span
        class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 to-transparent px-3 pt-10 pb-2 text-xs font-medium text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <span class="line-clamp-1">{asset.filename}</span>
        {#if personPhotoDateLabel(asset)}
          <span class="mt-0.5 block font-normal text-white/80">{personPhotoDateLabel(asset)}</span>
        {/if}
      </span>
    </a>
    <CimmichDuplicateIndicator sourceAssetId={asset.sourceAssetId} />
    {#if asset.sourceState && asset.sourceState !== 'active'}
      <span
        class="pointer-events-none absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-red-700/95 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
        title={asset.sourceState === 'trashed'
          ? 'This photo is in Immich trash and can be removed from Cimmich in Archive Health.'
          : 'This photo is no longer in the Immich library and can be removed from Cimmich in Archive Health.'}
      >
        <Icon icon={asset.sourceState === 'trashed' ? mdiDeleteClockOutline : mdiAlertCircleOutline} size="14" />
        {asset.sourceState === 'trashed' ? 'In Immich trash' : 'Missing from Immich'}
      </span>
    {/if}
    {#if selectionMode}
      <button
        class="absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-full border-2 border-white bg-black/55 text-white shadow-lg"
        class:bg-primary={selected}
        type="button"
        aria-label={`${selected ? 'Deselect' : 'Select'} ${asset.filename}`}
        aria-pressed={selected}
        onclick={ontoggle}
      >
        {#if selected}<Icon icon={mdiCheckCircleOutline} size="20" />{/if}
      </button>
    {/if}
  </article>
{:else}
  <div
    class="flex aspect-square items-end rounded-sm bg-gray-200 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
  >
    <span class="line-clamp-3">{asset.filename || asset.asset_id}</span>
  </div>
{/if}
