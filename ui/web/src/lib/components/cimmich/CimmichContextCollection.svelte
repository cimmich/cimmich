<script lang="ts">
  import type {
    CimmichContextEntity,
    CimmichContextFamily,
    CimmichContextTypeKind,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiCalendarBlankOutline,
    mdiCameraOutline,
    mdiCellphone,
    mdiDiamondStone,
    mdiHomeOutline,
    mdiMapMarkerOutline,
    mdiMapOutline,
    mdiPackageVariantClosed,
    mdiRepeat,
    mdiRoadVariant,
    mdiToolboxOutline,
    mdiViewGridOutline,
    mdiWalk,
  } from '@mdi/js';
  import {
    contextEventYear,
    contextFamilyLabels,
    contextPlaceHierarchy,
    contextPlaceMapProjection,
    contextTypeDescription,
    formatContextDatePrecision,
    humanizeContextKind,
    sortContextEntities,
    type ContextTypeFilter,
  } from './context-entity-presentation';

  interface Props {
    controlledTypeFilter?: ContextTypeFilter;
    entities: CimmichContextEntity[];
    family: CimmichContextFamily;
    onAdd: () => void;
    onOpen: (entity: CimmichContextEntity) => void;
  }

  let { controlledTypeFilter, entities, family, onAdd, onOpen }: Props = $props();
  let activeTypeFilter = $state<ContextTypeFilter>('all');
  let placeView = $state<'atlas' | 'list'>('list');

  const effectiveTypeFilter = $derived(controlledTypeFilter ?? activeTypeFilter);
  const filteredEntities = $derived(
    sortContextEntities(
      effectiveTypeFilter === 'all' ? entities : entities.filter((entity) => entity.typeKind === effectiveTypeFilter),
      family,
    ),
  );
  const placeProjection = $derived(contextPlaceMapProjection(entities));
  const mappedPlaceCount = $derived(placeProjection.markers.length + placeProjection.areas.length);

  $effect(() => {
    const nextFamily = family;
    activeTypeFilter = 'all';
    placeView = nextFamily === 'places' ? 'list' : 'atlas';
  });

  const coverUrl = (entity: CimmichContextEntity, size = AssetMediaSize.Preview) =>
    entity.coverAssetId ? getAssetMediaUrl({ id: entity.coverAssetId, size }) : '';

  const eventPreviewIds = (entity: CimmichContextEntity) =>
    entity.previewAssetIds?.length ? entity.previewAssetIds : entity.coverAssetId ? [entity.coverAssetId] : [];

  const iconForType = (type: CimmichContextTypeKind) => {
    const icons: Partial<Record<CimmichContextTypeKind, string>> = {
      activity: mdiRepeat,
      area: mdiMapOutline,
      collectible: mdiDiamondStone,
      device: mdiCellphone,
      equipment: mdiToolboxOutline,
      event: mdiCalendarBlankOutline,
      life_period: mdiWalk,
      point: mdiMapMarkerOutline,
      property: mdiHomeOutline,
      route: mdiRoadVariant,
      trip: mdiRoadVariant,
    };
    return icons[type] ?? mdiPackageVariantClosed;
  };

  const eventCardClass = (entity: CimmichContextEntity) =>
    entity.typeKind === 'trip'
      ? 'context-event-card context-event-card--trip'
      : entity.typeKind === 'life_period'
        ? 'context-event-card context-event-card--period'
        : 'context-event-card';

  const openPlaceMarker = (marker: { id: string }) => {
    const entity = entities.find((candidate) => candidate.entityId === marker.id);
    if (entity) {
      onOpen(entity);
    }
  };
</script>

<section class="pt-7" aria-label={contextFamilyLabels[family]} data-testid={`cimmich-${family}-collection`}>
  {#if family === 'places'}
    <header class="mb-5 flex justify-end">
      <div class="flex rounded-full bg-gray-100 p-1 dark:bg-gray-800" aria-label="Places view">
        <button
          class:context-view-active={placeView === 'atlas'}
          class="context-view-button"
          type="button"
          aria-pressed={placeView === 'atlas'}
          onclick={() => (placeView = 'atlas')}><Icon icon={mdiMapOutline} size="17" /> Map</button
        >
        <button
          class:context-view-active={placeView === 'list'}
          class="context-view-button"
          type="button"
          aria-pressed={placeView === 'list'}
          onclick={() => (placeView = 'list')}><Icon icon={mdiViewGridOutline} size="17" /> Places</button
        >
      </div>
    </header>
  {/if}

  {#if family === 'places' && placeView === 'atlas'}
    <div class="context-atlas-grid">
      <div class="context-atlas-map" data-testid="cimmich-places-atlas-map">
        {#if mappedPlaceCount > 0}
          {#await import('$lib/components/shared-components/map/Map.svelte')}
            <div class="context-map-placeholder">Loading your atlas…</div>
          {:then { default: Map }}
            <Map
              mapMarkers={[]}
              placeAreas={placeProjection.areas}
              placeMarkers={placeProjection.markers}
              onPlaceSelect={openPlaceMarker}
              rounded
              showSatelliteControl
              showSettings={false}
            />
          {/await}
        {:else}
          <div class="context-map-placeholder">
            <span class="context-map-placeholder-icon"><Icon icon={mdiMapOutline} size="34" /></span>
            <p class="mt-4 font-semibold">Your atlas starts with a place</p>
            <p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
              Pins, areas and routes will appear here. Named places can still exist before you know exactly where they
              are.
            </p>
          </div>
        {/if}
      </div>

      <aside class="context-place-rail" aria-label="Place hierarchy">
        <div class="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <p class="font-semibold">Places</p>
          <span class="text-xs text-gray-500">{mappedPlaceCount} mapped</span>
        </div>
        <div class="min-h-0 overflow-y-auto p-2">
          {#each sortContextEntities(entities, 'places') as entity (entity.entityId)}
            {@const hierarchy = contextPlaceHierarchy(entity, entities)}
            <button class="context-place-row" type="button" onclick={() => onOpen(entity)}>
              <span class="context-place-row-icon"><Icon icon={iconForType(entity.typeKind)} size="18" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">{entity.displayName}</span>
                <span class="mt-0.5 block truncate text-xs text-gray-500">
                  {hierarchy.length > 1 ? hierarchy.slice(0, -1).join(' / ') : contextTypeDescription(entity.typeKind)}
                </span>
              </span>
              <span class="text-xs text-gray-500">{entity.assetCount}</span>
            </button>
          {/each}
        </div>
      </aside>
    </div>
  {:else if family === 'places'}
    {#if filteredEntities.length === 0}
      <div class="context-first-state">
        <span><Icon icon={mdiMapMarkerOutline} size="34" /></span>
        <h2>No places yet</h2>
        <p>Name a point, property, route or meaningful place you cannot locate yet.</p>
        <button type="button" onclick={onAdd}>Add a place</button>
      </div>
    {:else}
      <div class="context-place-card-grid">
        {#each filteredEntities as entity (entity.entityId)}
          {@const hierarchy = contextPlaceHierarchy(entity, entities)}
          <button class="context-place-card" type="button" onclick={() => onOpen(entity)}>
            <div class="context-cover context-cover--place">
              {#if coverUrl(entity)}
                <img
                  src={coverUrl(entity)}
                  alt=""
                  loading="lazy"
                  data-testid={`cimmich-place-cover-${entity.entityId}`}
                />
              {:else}
                <Icon icon={iconForType(entity.typeKind)} size="34" />
              {/if}
            </div>
            <div class="p-4 text-left">
              <p class="line-clamp-2 min-h-12 text-lg/6 font-semibold">{entity.displayName}</p>
              <p class="mt-1 line-clamp-2 min-h-8 text-xs/4 text-gray-500">
                {hierarchy.length > 1
                  ? hierarchy.slice(0, -1).join(' / ')
                  : entity.description || contextTypeDescription(entity.typeKind)}
              </p>
              <p class="mt-3 text-xs font-medium text-gray-600 dark:text-gray-300">
                {humanizeContextKind(entity.typeKind)} · {entity.assetCount} media
              </p>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  {:else if family === 'objects'}
    {#if filteredEntities.length === 0}
      <div class="context-first-state">
        <span><Icon icon={mdiPackageVariantClosed} size="34" /></span>
        <h2>
          {effectiveTypeFilter === 'all' ? 'Name the first thing worth finding again' : 'Nothing in this type yet'}
        </h2>
        <p>
          {effectiveTypeFilter === 'all'
            ? 'Vehicles, homes, devices, keepsakes and equipment become useful when they have their own name and history.'
            : 'Choose another type or add the particular thing you have in mind.'}
        </p>
        {#if effectiveTypeFilter === 'all'}<button type="button" onclick={onAdd}>Add a thing</button>{/if}
      </div>
    {:else}
      <div class="context-thing-grid">
        {#each filteredEntities as entity (entity.entityId)}
          <button class="context-thing-card" type="button" onclick={() => onOpen(entity)}>
            <div class="context-cover context-cover--thing">
              {#if coverUrl(entity)}
                <img
                  class:context-cover-image--vehicle={entity.typeKind === 'vehicle'}
                  src={coverUrl(entity)}
                  alt=""
                  loading="lazy"
                />
              {:else}
                <Icon icon={iconForType(entity.typeKind)} size="38" />
              {/if}
              <span class="context-cover-chip"
                ><Icon icon={iconForType(entity.typeKind)} size="14" /> {humanizeContextKind(entity.typeKind)}</span
              >
            </div>
            <div class="grid gap-2 p-4 text-left">
              <h2 class="truncate text-base font-semibold">{entity.displayName}</h2>
              {#if entity.description}<p class="line-clamp-2 text-sm/5 text-gray-600 dark:text-gray-300">
                  {entity.description}
                </p>{/if}
              <div class="mt-1 flex items-center gap-2 text-xs text-gray-500">
                <span class="whitespace-nowrap"
                  ><Icon class="inline" icon={mdiCameraOutline} size="14" />
                  {entity.assetCount}
                  {entity.assetCount === 1 ? 'photo' : 'photos'}</span
                >
                {#if formatContextDatePrecision(entity)}<span aria-hidden="true">·</span><span class="truncate"
                    >{formatContextDatePrecision(entity)}</span
                  >{/if}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    {#if filteredEntities.length === 0}
      <div class="context-first-state">
        <span><Icon icon={mdiCalendarBlankOutline} size="34" /></span>
        <h2>
          {effectiveTypeFilter === 'all'
            ? 'Bring the first memory together'
            : 'Nothing in this part of your timeline yet'}
        </h2>
        <p>
          {effectiveTypeFilter === 'all'
            ? 'Start with a trip, one occasion, a recurring activity or a longer chapter of life.'
            : 'Choose another type or add the memory you want to organise.'}
        </p>
        {#if effectiveTypeFilter === 'all'}<button type="button" onclick={onAdd}>Add to your timeline</button>{/if}
      </div>
    {:else}
      <div class="context-event-grid">
        {#each filteredEntities as entity (entity.entityId)}
          {@const previewIds = eventPreviewIds(entity)}
          {@const visiblePreviewIds = entity.typeKind === 'trip' ? previewIds : previewIds.slice(0, 1)}
          <button class={eventCardClass(entity)} type="button" onclick={() => onOpen(entity)}>
            <div
              class:context-event-cover--contact={entity.typeKind === 'trip' && visiblePreviewIds.length > 1}
              class="context-event-cover"
              data-preview-count={visiblePreviewIds.length}
              data-testid={entity.typeKind === 'trip' && visiblePreviewIds.length > 1
                ? 'cimmich-event-contact-sheet'
                : undefined}
            >
              {#if visiblePreviewIds.length > 0}
                {#each visiblePreviewIds as previewAssetId (previewAssetId)}
                  <img
                    src={getAssetMediaUrl({ id: previewAssetId, size: AssetMediaSize.Preview })}
                    alt=""
                    loading="lazy"
                  />
                {/each}
              {:else}
                <span><Icon icon={iconForType(entity.typeKind)} size="36" /></span>
              {/if}
              <span class="context-event-kind"
                ><Icon icon={iconForType(entity.typeKind)} size="14" />
                {humanizeContextKind(entity.typeKind)}</span
              >
            </div>
            <div class="context-event-copy">
              <p class="truncate text-lg font-semibold">{entity.displayName}</p>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {formatContextDatePrecision(entity) ||
                  (contextEventYear(entity) === 'Undated' ? 'Date not set' : contextEventYear(entity))}
              </p>
              {#if entity.description}<p class="mt-3 line-clamp-2 text-sm/5 text-gray-600 dark:text-gray-300">
                  {entity.description}
                </p>{/if}
              <p class="mt-4 text-xs font-medium text-gray-500">
                {entity.assetCount}
                {entity.assetCount === 1 ? 'photo or video' : 'photos & videos'}
              </p>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .context-filter-pill,
  .context-view-button {
    display: inline-flex;
    min-height: 40px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 999px;
    padding: 0 14px;
    color: rgb(75 85 99);
    font-size: 0.8125rem;
    font-weight: 650;
    transition: 140ms ease;
  }

  :global(.dark) .context-filter-pill,
  :global(.dark) .context-view-button {
    color: rgb(209 213 219);
  }

  .context-filter-pill {
    border: 1px solid rgb(209 213 219);
  }

  :global(.dark) .context-filter-pill {
    border-color: rgb(55 65 81);
  }

  .context-filter-pill:hover,
  .context-filter-pill--active,
  .context-view-button:hover,
  .context-view-active {
    border-color: rgb(var(--immich-primary));
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-view-active {
    background: white;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
  }

  :global(.dark) .context-view-active {
    background: rgb(55 65 81);
  }

  .context-atlas-grid {
    display: grid;
    min-height: 560px;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 28px;
    background: white;
    box-shadow: 0 18px 50px rgb(15 23 42 / 0.08);
  }

  :global(.dark) .context-atlas-grid {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  :global(.dark) .context-atlas-map,
  :global(.dark) .context-map-placeholder {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
  }

  .context-atlas-map {
    min-height: 440px;
    overflow: hidden;
    background: rgb(243 244 246);
  }

  .context-map-placeholder {
    display: flex;
    height: 100%;
    min-height: 440px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    text-align: center;
  }

  .context-map-placeholder-icon {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    border-radius: 22px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-place-rail {
    display: flex;
    min-height: 0;
    flex-direction: column;
  }

  .context-place-row {
    display: flex;
    width: 100%;
    min-height: 58px;
    align-items: center;
    gap: 12px;
    border-radius: 14px;
    padding: 8px 10px;
    text-align: left;
  }

  .context-place-row:hover,
  .context-place-row:focus-visible {
    background: rgb(var(--immich-primary) / 0.08);
    outline: none;
  }

  .context-place-row-icon {
    display: grid;
    width: 36px;
    height: 36px;
    flex: none;
    place-items: center;
    border-radius: 12px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-place-card-grid,
  .context-thing-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .context-first-state {
    display: flex;
    min-height: 52vh;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 44px 20px;
    text-align: center;
  }

  .context-first-state > span {
    display: grid;
    width: 68px;
    height: 68px;
    place-items: center;
    border-radius: 24px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-first-state h2 {
    margin-top: 20px;
    font-size: 1.35rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .context-first-state p {
    max-width: 480px;
    margin-top: 8px;
    color: rgb(107 114 128);
    font-size: 0.875rem;
    line-height: 1.55;
  }

  .context-first-state button {
    min-height: 44px;
    margin-top: 22px;
    border-radius: 999px;
    background: rgb(var(--immich-primary));
    padding: 0 18px;
    color: white;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .context-place-card,
  .context-thing-card {
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 22px;
    background: white;
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
    transition: 160ms ease;
  }

  :global(.dark) .context-place-card,
  :global(.dark) .context-thing-card {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  .context-place-card:hover,
  .context-place-card:focus-visible,
  .context-thing-card:hover,
  .context-thing-card:focus-visible,
  .context-event-card:hover,
  .context-event-card:focus-visible {
    transform: translateY(-2px);
    border-color: rgb(var(--immich-primary) / 0.45);
    box-shadow: 0 14px 34px rgb(15 23 42 / 0.12);
    outline: none;
  }

  .context-cover {
    position: relative;
    display: grid;
    overflow: hidden;
    place-items: center;
    background: linear-gradient(145deg, rgb(var(--immich-primary) / 0.14), rgb(148 163 184 / 0.18));
    color: rgb(var(--immich-primary));
  }

  .context-cover img,
  .context-event-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .context-cover--place {
    aspect-ratio: 16 / 10;
  }

  .context-cover--thing {
    aspect-ratio: 4 / 3;
  }

  .context-cover-image--vehicle {
    object-position: center 68%;
  }

  .context-cover-chip,
  .context-event-kind {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 5px;
    border: 1px solid rgb(255 255 255 / 0.24);
    border-radius: 999px;
    background: rgb(15 23 42 / 0.76);
    padding: 0 9px;
    color: white;
    font-size: 0.6875rem;
    font-weight: 700;
    backdrop-filter: blur(8px);
  }

  .context-event-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }

  .context-event-card {
    display: flex;
    overflow: hidden;
    min-width: 0;
    flex-direction: column;
    border: 1px solid rgb(229 231 235);
    border-radius: 12px;
    background: white;
    text-align: left;
    transition: 160ms ease;
  }

  :global(.dark) .context-event-card {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  .context-event-cover {
    position: relative;
    display: grid;
    min-height: 0;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    place-items: center;
    background: linear-gradient(145deg, rgb(var(--immich-primary) / 0.12), rgb(124 58 237 / 0.12));
    color: rgb(var(--immich-primary));
  }

  .context-event-cover--contact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    gap: 2px;
    background: rgb(17 24 39);
  }

  .context-event-cover--contact img {
    min-width: 0;
    min-height: 0;
  }

  .context-event-cover--contact[data-preview-count='2'] {
    grid-template-rows: minmax(0, 1fr);
  }

  .context-event-cover--contact[data-preview-count='3'] {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.6fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  .context-event-cover--contact[data-preview-count='3'] img:first-child {
    grid-row: 1 / 3;
  }

  .context-event-copy {
    min-width: 0;
    padding: 16px;
  }

  .context-event-card--period {
    border-color: rgb(var(--immich-primary) / 0.3);
  }

  @media (min-width: 700px) {
    .context-atlas-grid {
      grid-template-columns: minmax(0, 1.55fr) minmax(270px, 0.58fr);
    }

    .context-place-card-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .context-thing-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .context-event-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (min-width: 1180px) {
    .context-place-card-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .context-thing-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .context-event-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (max-width: 520px) {
    .context-place-card-grid,
    .context-thing-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .context-atlas-grid {
      min-height: 0;
    }

    .context-atlas-map,
    .context-map-placeholder {
      min-height: 360px;
    }

    .context-place-rail {
      max-height: 320px;
    }

    .context-event-cover {
      aspect-ratio: 4 / 3;
    }
  }
</style>
