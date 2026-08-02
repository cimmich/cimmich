<script lang="ts">
  import type { CimmichContextEntity } from '$lib/services/cimmich.service';
  import { contextPlaceMapProjection } from './context-entity-presentation';

  interface Props {
    location: CimmichContextEntity;
  }

  let { location }: Props = $props();
  const projection = $derived(contextPlaceMapProjection([location]));
  const center = $derived.by(() => {
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

<div class="plan-satellite" aria-hidden="true">
  {#if center}
    {#await import('$lib/components/shared-components/map/Map.svelte')}
      <div class="plan-satellite__loading">Loading satellite…</div>
    {:then { default: Map }}
      <Map
        autoFitBounds={false}
        {center}
        mapMarkers={[]}
        placeAreas={[]}
        placeMarkers={[]}
        rounded
        satelliteInitiallyEnabled
        showSatelliteControl={false}
        showSettings={false}
        showSimpleControls={false}
        zoom={18}
      />
    {/await}
  {:else}
    <div class="plan-satellite__loading">Satellite needs a mapped Location</div>
  {/if}
</div>

<style>
  .plan-satellite,
  .plan-satellite__loading {
    position: absolute;
    inset: 0;
  }
  .plan-satellite {
    pointer-events: none;
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
