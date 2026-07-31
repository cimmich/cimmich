<script lang="ts">
  import type { CimmichContextEntity, CimmichContextGeometry } from '$lib/services/cimmich.service';
  import { Icon, toastManager } from '@immich/ui';
  import { mdiArrowRight, mdiClose, mdiMapOutline, mdiUndoVariant, mdiVectorPolygon } from '@mdi/js';
  import { contextPlaceMapProjection } from './context-entity-presentation';

  interface Props {
    children: CimmichContextEntity[];
    onOpenPlace: (child: CimmichContextEntity) => void;
    onSaveZone: (child: CimmichContextEntity, geometry: CimmichContextGeometry) => Promise<void>;
    parent: CimmichContextEntity;
  }

  let { children, onOpenPlace, onSaveZone, parent }: Props = $props();
  let selectedChildId = $state('');
  let painting = $state(false);
  let paintPoints = $state<Array<{ lat: number; lng: number }>>([]);
  let saving = $state(false);
  let saveError = $state('');

  const colors = ['#f97316', '#0ea5e9', '#8b5cf6', '#16a34a', '#e11d48', '#d97706'];
  const selectedChild = $derived(children.find((child) => child.entityId === selectedChildId) ?? children[0]);
  const projection = $derived(contextPlaceMapProjection(children));
  const parentProjection = $derived(contextPlaceMapProjection([parent]));
  const paintedChildIds = $derived(
    new Set(children.filter((child) => child.typeKind === 'area' && child.geometry).map((child) => child.entityId)),
  );
  const selectedExistingPoints = $derived.by(() => {
    const area = projection.areas.find((candidate) => candidate.id === selectedChild?.entityId);
    if (!area || area.geometryKind !== 'area') {
      return [];
    }
    const points = area.points.map((point) => ({ lat: point.lat, lng: point.lon }));
    const first = points[0];
    const last = points.at(-1);
    return first && last && first.lat === last.lat && first.lng === last.lng ? points.slice(0, -1) : points;
  });
  const canvasAreas = $derived.by(() => {
    const saved = projection.areas
      .filter((area) => !painting || area.id !== selectedChild?.entityId)
      .map((area) => ({
        ...area,
        color:
          colors[
            Math.max(
              0,
              children.findIndex((child) => child.entityId === area.id),
            ) % colors.length
          ],
      }));
    if (!painting || paintPoints.length < 3 || !selectedChild) {
      return saved;
    }
    return [
      ...saved,
      {
        color:
          colors[
            Math.max(
              0,
              children.findIndex((child) => child.entityId === selectedChild.entityId),
            ) % colors.length
          ],
        geometryKind: 'area' as const,
        geometrySource: 'manual' as const,
        id: selectedChild.entityId,
        name: selectedChild.displayName,
        parentName: parent.displayName,
        points: paintPoints.map((point) => ({ lat: point.lat, lon: point.lng })),
      },
    ];
  });
  const brushPoints = $derived(
    painting ? paintPoints.map((point, index) => ({ id: `zone-${index}`, lat: point.lat, lon: point.lng })) : [],
  );
  const canvasCenter = $derived.by(() => {
    const marker = parentProjection.markers[0] ?? projection.markers[0];
    if (marker) {
      return { lat: marker.lat, lng: marker.lon };
    }
    const points = parentProjection.areas[0]?.points ?? projection.areas[0]?.points ?? [];
    if (points.length === 0) {
      return undefined;
    }
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    };
  });

  $effect(() => {
    if (!selectedChildId && children[0]) {
      selectedChildId = children[0].entityId;
    }
  });

  const chooseChild = (child: CimmichContextEntity) => {
    selectedChildId = child.entityId;
    painting = false;
    paintPoints = [];
    saveError = '';
  };

  const startPainting = () => {
    paintPoints = [...selectedExistingPoints];
    painting = true;
    saveError = '';
  };

  const addPaintPoint = ({ lat, lng }: { lat: number; lng: number }) => {
    if (paintPoints.length >= 500) {
      toastManager.warning('Maximum 500 boundary points. Undo a point before drawing more.');
      return;
    }
    const last = paintPoints.at(-1);
    if (last && Math.hypot(last.lat - lat, last.lng - lng) < 0.000_005) {
      return;
    }
    paintPoints = [...paintPoints, { lat, lng }];
  };

  const cancelPainting = () => {
    painting = false;
    paintPoints = [];
    saveError = '';
  };

  const saveZone = async () => {
    if (!selectedChild || paintPoints.length < 3 || saving) {
      return;
    }
    saving = true;
    saveError = '';
    try {
      await onSaveZone(selectedChild, {
        points: paintPoints.map((point) => ({ latitude: point.lat, longitude: point.lng })),
      });
      painting = false;
      paintPoints = [];
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'The zone could not be saved.';
    } finally {
      saving = false;
    }
  };
</script>

<section class="place-canvas" aria-labelledby="place-canvas-title">
  <header>
    <span class="place-canvas__icon"><Icon icon={mdiMapOutline} size="21" /></span>
    <div>
      <h2 id="place-canvas-title">Place canvas</h2>
      <p>Outline the real subsections of {parent.displayName} over a focused satellite view.</p>
    </div>
  </header>

  <div class="place-canvas__children" aria-label="Subplaces on canvas">
    {#each children as child, index (child.entityId)}
      <button
        class:place-canvas__child--active={selectedChild?.entityId === child.entityId}
        class="place-canvas__child"
        type="button"
        aria-pressed={selectedChild?.entityId === child.entityId}
        onclick={() => chooseChild(child)}
      >
        <span style={`--zone-color: ${colors[index % colors.length]}`}></span>
        <strong>{child.displayName}</strong>
        <small>{paintedChildIds.has(child.entityId) ? 'Outlined' : 'Not outlined'}</small>
      </button>
    {/each}
  </div>

  {#if selectedChild}
    <div class="place-canvas__toolbar">
      <div>
        <strong>{selectedChild.displayName}</strong>
        <span>{painting ? `${paintPoints.length} boundary points` : 'Select this zone or open the subplace.'}</span>
      </div>
      <div class="place-canvas__actions">
        {#if painting}
          <button
            type="button"
            disabled={paintPoints.length === 0 || saving}
            onclick={() => (paintPoints = paintPoints.slice(0, -1))}
          >
            <Icon icon={mdiUndoVariant} size="17" /> Undo point
          </button>
          <button type="button" disabled={saving} onclick={cancelPainting}
            ><Icon icon={mdiClose} size="17" /> Cancel</button
          >
          <button
            class="place-canvas__primary"
            type="button"
            disabled={paintPoints.length < 3 || saving}
            onclick={() => void saveZone()}
          >
            <Icon icon={mdiVectorPolygon} size="17" />
            {saving ? 'Saving…' : 'Save zone'}
          </button>
        {:else}
          <button type="button" onclick={startPainting}>
            <Icon icon={mdiVectorPolygon} size="17" />
            {paintedChildIds.has(selectedChild.entityId) ? 'Edit outline' : 'Paint outline'}
          </button>
          <button type="button" onclick={() => onOpenPlace(selectedChild)}
            >Open subplace <Icon icon={mdiArrowRight} size="17" /></button
          >
        {/if}
      </div>
    </div>
    {#if saveError}<p class="place-canvas__error" role="alert">{saveError}</p>{/if}
  {/if}

  <div class="place-canvas__map" aria-label={`Satellite canvas for ${parent.displayName}`}>
    {#await import('$lib/components/shared-components/map/Map.svelte')}
      <div class="place-canvas__placeholder">Loading satellite canvas…</div>
    {:then { default: Map }}
      <Map
        autoFitBounds={!canvasCenter}
        brushable={painting}
        center={canvasCenter}
        mapMarkers={[]}
        onBrushPoint={addPaintPoint}
        onPlaceAreaSelect={(placeId) => {
          const child = children.find((candidate) => candidate.entityId === placeId);
          if (child) {
            chooseChild(child);
          }
        }}
        placeAreas={canvasAreas}
        placeBrushPoints={brushPoints}
        placeMarkers={projection.markers}
        rounded
        satelliteInitiallyEnabled
        showPlaceMarkerLabels
        showSatelliteControl
        showSettings={false}
        zoom={canvasCenter ? 18 : undefined}
      />
    {/await}
  </div>
  <p class="place-canvas__footnote">
    Satellite tiles stay with the map provider; Cimmich saves only the boundary you draw. GPS can suggest a zone later,
    but never assigns one automatically.
  </p>
</section>

<style>
  .place-canvas {
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 1.5rem;
    background: white;
  }
  :global(.dark) .place-canvas {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 1rem 1rem 0.8rem;
  }
  header h2 {
    font-size: 1rem;
    font-weight: 750;
  }
  header p {
    margin-top: 0.1rem;
    color: rgb(107 114 128);
    font-size: 0.8rem;
  }
  .place-canvas__icon {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    place-items: center;
    border-radius: 1rem;
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }
  .place-canvas__children {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding: 0 1rem 0.8rem;
  }
  .place-canvas__child {
    display: grid;
    grid-template-columns: auto auto;
    min-width: max-content;
    gap: 0.05rem 0.5rem;
    border: 1px solid rgb(229 231 235);
    border-radius: 999px;
    padding: 0.55rem 0.8rem;
    text-align: left;
  }
  :global(.dark) .place-canvas__child {
    border-color: rgb(55 65 81);
  }
  .place-canvas__child > span {
    grid-row: 1 / 3;
    width: 0.6rem;
    height: 0.6rem;
    align-self: center;
    border-radius: 999px;
    background: var(--zone-color);
  }
  .place-canvas__child strong {
    font-size: 0.78rem;
    line-height: 1rem;
  }
  .place-canvas__child small {
    color: rgb(107 114 128);
    font-size: 0.65rem;
    line-height: 0.85rem;
  }
  .place-canvas__child--active {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }
  .place-canvas__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-top: 1px solid rgb(229 231 235);
    padding: 0.8rem 1rem;
  }
  :global(.dark) .place-canvas__toolbar {
    border-color: rgb(31 41 55);
  }
  .place-canvas__toolbar > div:first-child {
    display: grid;
  }
  .place-canvas__toolbar strong {
    font-size: 0.85rem;
  }
  .place-canvas__toolbar span {
    color: rgb(107 114 128);
    font-size: 0.72rem;
  }
  .place-canvas__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.45rem;
  }
  .place-canvas__actions button {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 999px;
    padding: 0 0.8rem;
    font-size: 0.75rem;
    font-weight: 700;
  }
  :global(.dark) .place-canvas__actions button {
    border-color: rgb(75 85 99);
  }
  .place-canvas__actions button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .place-canvas__actions .place-canvas__primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: white;
  }
  .place-canvas__error {
    margin: 0 1rem 0.8rem;
    border-radius: 0.75rem;
    background: rgb(254 242 242);
    padding: 0.65rem 0.8rem;
    color: rgb(153 27 27);
    font-size: 0.78rem;
  }
  .place-canvas__map,
  .place-canvas__placeholder {
    height: min(62vh, 40rem);
    min-height: 30rem;
  }
  .place-canvas__placeholder {
    display: grid;
    place-items: center;
    color: rgb(107 114 128);
  }
  .place-canvas__footnote {
    padding: 0.7rem 1rem 0.85rem;
    color: rgb(107 114 128);
    font-size: 0.68rem;
    line-height: 1rem;
  }
  @media (max-width: 639px) {
    .place-canvas__toolbar {
      align-items: stretch;
      flex-direction: column;
    }
    .place-canvas__actions {
      justify-content: stretch;
    }
    .place-canvas__actions button {
      flex: 1;
    }
    .place-canvas__map,
    .place-canvas__placeholder {
      height: 28rem;
      min-height: 28rem;
    }
  }
</style>
