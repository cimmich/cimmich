<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { contextPlaceMapProjection } from '$lib/components/cimmich/context-entity-presentation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import MapTimelinePanel from './MapTimelinePanel.svelte';
  import type { SelectionBBox } from '$lib/components/shared-components/map/types';
  import { timeToLoadTheMap } from '$lib/constants';
  import Portal from '$lib/elements/Portal.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { getCimmichContextEntities, type CimmichContextEntity } from '$lib/services/cimmich.service';
  import { handlePromiseError } from '$lib/utils';
  import { delay } from '$lib/utils/asset-utils';
  import { navigate } from '$lib/utils/navigation';
  import { LoadingSpinner } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let selectedClusterIds = $state.raw(new Set<string>());
  let selectedClusterBBox = $state.raw<SelectionBBox>();
  let isTimelinePanelVisible = $state(false);
  let cimmichPlaces = $state<CimmichContextEntity[]>([]);
  let cimmichPlacesLoaded = $state(false);

  const cimmichPlaceProjection = $derived(contextPlaceMapProjection(cimmichPlaces));
  const requestedCimmichPlaceId = $derived(page.url.searchParams.get('cimmichPlaceId'));
  const requestedCimmichPlaceCenter = $derived.by(() => {
    const marker = cimmichPlaceProjection.markers.find((candidate) => candidate.id === requestedCimmichPlaceId);
    if (marker) {
      return { lat: marker.lat, lng: marker.lon };
    }
    const area = cimmichPlaceProjection.areas.find((candidate) => candidate.id === requestedCimmichPlaceId);
    if (!area || area.points.length === 0) {
      return undefined;
    }
    return {
      lat: area.points.reduce((total, point) => total + point.lat, 0) / area.points.length,
      lng: area.points.reduce((total, point) => total + point.lon, 0) / area.points.length,
    };
  });

  const loadCimmichPlaces = async () => {
    try {
      cimmichPlaces = await getCimmichContextEntities('places', { limit: 500 });
    } catch {
      cimmichPlaces = [];
    } finally {
      cimmichPlacesLoaded = true;
    }
  };

  function closeTimelinePanel() {
    isTimelinePanelVisible = false;
    selectedClusterBBox = undefined;
    selectedClusterIds = new Set();
  }

  onDestroy(() => {
    assetViewerManager.showAssetViewer(false);
  });

  onMount(() => {
    void loadCimmichPlaces();
    const reloadPlaces = () => void loadCimmichPlaces();
    globalThis.addEventListener('cimmich:visibility-changed', reloadPlaces);
    return () => globalThis.removeEventListener('cimmich:visibility-changed', reloadPlaces);
  });

  if (!featureFlagsManager.value.map) {
    handlePromiseError(goto(Route.photos()));
  }

  async function onViewAssets(assetIds: string[]) {
    await assetViewerManager.setAssetId(assetIds[0]);
    closeTimelinePanel();
  }

  function onClusterSelect(assetIds: string[], bbox: SelectionBBox) {
    selectedClusterIds = new Set(assetIds);
    selectedClusterBBox = bbox;
    isTimelinePanelVisible = true;
    assetViewerManager.showAssetViewer(false);
    handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
  }
</script>

{#if featureFlagsManager.value.map}
  <UserPageLayout title={data.meta.title}>
    <div class="isolate flex size-full flex-col sm:flex-row">
      <div
        class={[
          'min-h-0',
          isTimelinePanelVisible ? 'h-1/2 w-full pb-2 sm:h-full sm:w-2/3 sm:pe-2 sm:pb-0' : 'size-full',
        ]}
      >
        {#if !cimmichPlacesLoaded}
          {#await delay(timeToLoadTheMap) then}
            <div class="flex size-full items-center justify-center">
              <LoadingSpinner />
            </div>
          {/await}
        {:else}
          {#await import('$lib/components/shared-components/map/Map.svelte')}
            {#await delay(timeToLoadTheMap) then}
              <!-- show the loading spinner only if loading the map takes too much time -->
              <div class="flex size-full items-center justify-center">
                <LoadingSpinner />
              </div>
            {/await}
          {:then { default: Map }}
            <Map
              center={requestedCimmichPlaceCenter}
              hash={!requestedCimmichPlaceCenter}
              {onClusterSelect}
              onPlaceSelect={(place) => void goto(`/cimmich/places?entityId=${encodeURIComponent(place.id)}`)}
              onSelect={onViewAssets}
              placeAreas={cimmichPlaceProjection.areas}
              placeMarkers={cimmichPlaceProjection.markers}
              showSatelliteControl
              visibilityFiltered
              zoom={requestedCimmichPlaceCenter ? 15 : undefined}
            />
          {/await}
        {/if}
      </div>

      {#if isTimelinePanelVisible && selectedClusterBBox}
        <div class="h-1/2 min-h-0 w-full pt-2 sm:h-full sm:w-1/3 sm:ps-2 sm:pt-0">
          <MapTimelinePanel
            bbox={selectedClusterBBox}
            {selectedClusterIds}
            assetCount={selectedClusterIds.size}
            onClose={closeTimelinePanel}
          />
        </div>
      {/if}
    </div>
  </UserPageLayout>
  <Portal target="body">
    {#if assetViewerManager.isViewing && !isTimelinePanelVisible}
      {#await import('$lib/components/asset-viewer/AssetViewer.svelte') then { default: AssetViewer }}
        <AssetViewer
          cursor={{ current: assetViewerManager.asset! }}
          showNavigation={false}
          onClose={() => {
            assetViewerManager.showAssetViewer(false);
            handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
          }}
          isShared={false}
        />
      {/await}
    {/if}
  </Portal>
{/if}
