<script lang="ts">
  import type { CimmichContextEntity, CimmichPlacePlanViewport } from '$lib/services/cimmich.service';
  import { contextPlaceMapProjection } from './context-entity-presentation';

  interface Props {
    interactive?: boolean;
    location: CimmichContextEntity;
    onViewportChange?: (viewport: CimmichPlacePlanViewport) => void;
    viewport?: CimmichPlacePlanViewport | null;
  }

  let { interactive = false, location, onViewportChange, viewport = null }: Props = $props();
  const projection = $derived(contextPlaceMapProjection([location]));
  const center = $derived.by(() => {
    if (viewport) {
      return { lat: viewport.latitude, lng: viewport.longitude };
    }
    const marker = projection.markers[0];
    if (marker) {
      return { lat: marker.lat, lng: marker.lon };
    }
    const points = projection.areas[0]?.points ?? [];
    if (points.length === 0) {
      return undefined;
    }
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    };
  });
</script>

<div class="plan-satellite" class:plan-satellite--interactive={interactive} aria-hidden={!interactive}>
  {#if center}
    {#await import('$lib/components/shared-components/map/Map.svelte')}
      <div class="plan-satellite__loading">Loading satellite…</div>
    {:then { default: Map }}
      <Map
        autoFitBounds={false}
        {center}
        mapMarkers={[]}
        maxZoom={22}
        placeAreas={[]}
        placeMarkers={[]}
        rounded
        satelliteOnly
        satelliteInitiallyEnabled
        simplified
        showSatelliteControl={false}
        showSettings={false}
        showSimpleControls={interactive}
        {onViewportChange}
        zoom={viewport?.zoom ?? 18}
      />
    {/await}
  {:else}
    <div class="plan-satellite__loading">Satellite needs a mapped Location</div>
  {/if}
  {#if center}<span class="plan-satellite__credit">Satellite © Esri</span>{/if}
</div>

<style>
  .plan-satellite,
  .plan-satellite__loading {
    position: absolute;
    inset: 0;
  }
  .plan-satellite__credit {
    position: absolute;
    right: 0.35rem;
    bottom: 0.3rem;
    z-index: 1;
    border-radius: 0.25rem;
    padding: 0.12rem 0.3rem;
    color: rgb(15 23 42);
    background: rgb(255 255 255 / 0.78);
    font-size: 0.58rem;
    line-height: 1;
  }
  .plan-satellite {
    pointer-events: none;
  }
  .plan-satellite--interactive {
    pointer-events: auto;
  }
  .plan-satellite--interactive :global(.maplibregl-canvas) {
    cursor: grab;
  }
  .plan-satellite--interactive :global(.maplibregl-canvas:active) {
    cursor: grabbing;
  }
  .plan-satellite__loading {
    display: grid;
    place-items: center;
    color: rgb(107 114 128);
    background: rgb(226 232 240);
    font-size: 0.78rem;
    font-weight: 700;
  }
  .plan-satellite :global(.maplibregl-map) {
    width: 100%;
    height: 100%;
  }
</style>
