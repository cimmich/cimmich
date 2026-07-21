<script lang="ts">
  import { goto } from '$app/navigation';
  import type { CimmichContextDetail } from '$lib/services/cimmich.service';
  import { getMapMarkers, type MapMarkerResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowExpand, mdiMapMarkerOutline } from '@mdi/js';
  import { contextPlaceMapProjection } from './context-entity-presentation';

  interface Props {
    detail: CimmichContextDetail;
  }

  let { detail }: Props = $props();
  let linkedMapMarkers = $state<MapMarkerResponseDto[]>([]);
  let linkedMapGeneration = 0;

  const placeProjection = $derived(contextPlaceMapProjection([detail.entity]));
  const locatorCenter = $derived(
    placeProjection.markers[0]
      ? { lng: placeProjection.markers[0].lon, lat: placeProjection.markers[0].lat }
      : undefined,
  );

  $effect(() => {
    const generation = ++linkedMapGeneration;
    const sourceAssetIds = detail.assets.map((asset) => asset.sourceAssetId);
    if (sourceAssetIds.length === 0) {
      linkedMapMarkers = [];
      return;
    }
    void getMapMarkers({})
      .then((markers) => {
        if (generation !== linkedMapGeneration) {
          return;
        }
        linkedMapMarkers = markers
          .filter((marker) => sourceAssetIds.includes(marker.id))
          .sort((left, right) => sourceAssetIds.indexOf(left.id) - sourceAssetIds.indexOf(right.id))
          .filter(
            (marker, index, candidates) =>
              candidates.findIndex((candidate) => candidate.lat === marker.lat && candidate.lon === marker.lon) ===
              index,
          );
      })
      .catch(() => {
        if (generation === linkedMapGeneration) {
          linkedMapMarkers = [];
        }
      });
  });
</script>

<section class="context-place-map-panel" aria-labelledby="context-place-map-title">
  <div class="context-place-map-copy">
    <span><Icon icon={mdiMapMarkerOutline} size="20" /></span>
    <div>
      <h2 id="context-place-map-title">Map</h2>
      <p>The place itself and visible photos that carry location data.</p>
    </div>
    <button
      type="button"
      onclick={() => void goto(`/map?cimmichPlaceId=${encodeURIComponent(detail.entity.entityId)}`)}
    >
      <Icon icon={mdiArrowExpand} size="18" /> Open full map
    </button>
  </div>

  <div class="context-place-map-canvas" aria-label={`Map for ${detail.entity.displayName}`}>
    {#await import('$lib/components/shared-components/map/Map.svelte')}
      <div class="context-place-map-placeholder">Loading map…</div>
    {:then { default: Map }}
      <Map
        center={locatorCenter}
        mapMarkers={linkedMapMarkers}
        onOpenInMapView={() => void goto(`/map?cimmichPlaceId=${encodeURIComponent(detail.entity.entityId)}`)}
        placeAreas={placeProjection.areas}
        placeMarkers={placeProjection.markers}
        rounded
        showPlaceMarkerLabels={false}
        showSatelliteControl
        showSettings={false}
        zoom={locatorCenter ? 15 : undefined}
      />
    {/await}
  </div>
</section>

<style>
  .context-place-map-panel {
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 1.5rem;
    background: white;
  }
  :global(.dark) .context-place-map-panel {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }
  .context-place-map-copy {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 1rem;
  }
  .context-place-map-copy > span {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    place-items: center;
    border-radius: 1rem;
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }
  .context-place-map-copy h2 {
    font-size: 1rem;
    font-weight: 700;
  }
  .context-place-map-copy p {
    margin-top: 0.15rem;
    color: rgb(107 114 128);
    font-size: 0.8rem;
  }
  .context-place-map-copy button {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 999px;
    padding: 0 0.95rem;
    font-size: 0.8rem;
    font-weight: 700;
  }
  :global(.dark) .context-place-map-copy button {
    border-color: rgb(75 85 99);
  }
  .context-place-map-copy button:hover {
    background: rgb(243 244 246);
  }
  :global(.dark) .context-place-map-copy button:hover {
    background: rgb(31 41 55);
  }
  .context-place-map-copy button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .context-place-map-canvas,
  .context-place-map-placeholder {
    min-height: min(58vh, 36rem);
  }
  .context-place-map-placeholder {
    display: grid;
    place-items: center;
    color: rgb(107 114 128);
  }
  @media (max-width: 639px) {
    .context-place-map-copy {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .context-place-map-copy button {
      grid-column: 1 / -1;
      justify-self: stretch;
      justify-content: center;
    }
    .context-place-map-canvas,
    .context-place-map-placeholder {
      min-height: 26rem;
    }
  }
</style>
