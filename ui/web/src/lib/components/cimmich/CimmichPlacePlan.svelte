<script lang="ts">
  import {
    type CimmichContextEntity,
    type CimmichPlacePlan,
    type CimmichPlacePlanGeometry,
    type CimmichPlacePlanViewport,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiBrushVariant,
    mdiCheck,
    mdiClose,
    mdiFloorPlan,
    mdiImageOutline,
    mdiMapMarkerPlusOutline,
    mdiPencilOutline,
    mdiPlus,
    mdiRestore,
    mdiSatelliteVariant,
    mdiVectorPolygon,
  } from '@mdi/js';
  import CimmichPlanSatellite from './CimmichPlanSatellite.svelte';
  import { contextPlaceMapProjection } from './context-entity-presentation';

  type DraftItem = {
    childEntityId: string;
    childName: string;
    geometry: CimmichPlacePlanGeometry;
    zIndex: number;
  };

  interface Props {
    children: CimmichContextEntity[];
    coverSourceAssetId?: string | null;
    onCreateLocation: () => void;
    onOpenPlace: (child: CimmichContextEntity) => void;
    onSave: (input: {
      backgroundKind: CimmichPlacePlan['backgroundKind'];
      backgroundSourceAssetId: string | null;
      backgroundViewport: CimmichPlacePlanViewport | null;
      displayName: string;
      expectedRevision: number;
      isDefault: boolean;
      items: Array<{ childEntityId: string; geometry: CimmichPlacePlanGeometry; zIndex: number }>;
      planId: string | null;
      planKind: CimmichPlacePlan['planKind'];
    }) => Promise<void>;
    parent: CimmichContextEntity;
    plans: CimmichPlacePlan[];
  }

  let { children, coverSourceAssetId = null, onCreateLocation, onOpenPlace, onSave, parent, plans }: Props = $props();
  let activePlanId = $state('');
  let editing = $state(false);
  let draftName = $state('');
  let draftKind = $state<CimmichPlacePlan['planKind']>('property');
  let draftBackgroundKind = $state<CimmichPlacePlan['backgroundKind']>('blank');
  let draftBackgroundSourceAssetId = $state<string | null>(null);
  let draftBackgroundViewport = $state<CimmichPlacePlanViewport | null>(null);
  let draftItems = $state<DraftItem[]>([]);
  let draftPlanId = $state<string | null>(null);
  let draftRevision = $state(0);
  let draftDefault = $state(false);
  let selectedChildId = $state('');
  let paintingChildId = $state('');
  let paintingMode = $state<'outline' | 'paint'>('outline');
  let paint = $state<{
    pointerId: number;
    points: Array<{ x: number; y: number }>;
  } | null>(null);
  let saving = $state(false);
  let saveError = $state('');
  let drag = $state<{
    childEntityId: string;
    kind: 'move' | 'resize';
    pointerX: number;
    pointerY: number;
    rect: Extract<CimmichPlacePlanGeometry, { kind: 'rect' }>;
  } | null>(null);
  let canvas = $state<HTMLDivElement>();

  const activePlan = $derived(plans.find((plan) => plan.planId === activePlanId) ?? plans[0] ?? null);
  const visibleItems = $derived(editing ? draftItems : (activePlan?.items ?? []));
  const visibleBackground = $derived(
    editing ? draftBackgroundSourceAssetId : (activePlan?.backgroundSourceAssetId ?? null),
  );
  const visibleBackgroundKind = $derived(editing ? draftBackgroundKind : (activePlan?.backgroundKind ?? 'blank'));
  const visibleBackgroundViewport = $derived(
    editing ? draftBackgroundViewport : (activePlan?.backgroundViewport ?? null),
  );
  const satelliteAvailable = $derived.by(() => {
    const projection = contextPlaceMapProjection([parent]);
    return projection.markers.length + projection.areas.length > 0;
  });
  const placedIds = $derived(new Set(visibleItems.map((item) => item.childEntityId)));
  const unplacedChildren = $derived(children.filter((child) => !placedIds.has(child.entityId)));
  const paintingChild = $derived(children.find((child) => child.entityId === paintingChildId) ?? null);
  const outlinePreview = $derived.by(() => {
    if (paintingMode !== 'outline' || !paint) {
      return null;
    }
    return paint.points.length >= 3 ? { kind: 'polygon' as const, points: paint.points } : null;
  });
  const brushPreview = $derived.by(() => {
    if (paintingMode !== 'paint' || !paint) {
      return null;
    }
    return {
      kind: 'paint' as const,
      strokes: [{ points: paint.points, radius: 0.035 }],
    };
  });

  $effect(() => {
    if (plans.length > 0 && !plans.some((plan) => plan.planId === activePlanId)) {
      activePlanId = plans.find((plan) => plan.isDefault)?.planId ?? plans[0]?.planId ?? '';
    }
  });

  const defaultSatelliteViewport = (): CimmichPlacePlanViewport | null => {
    const projection = contextPlaceMapProjection([parent]);
    const marker = projection.markers[0];
    if (marker) {
      return { latitude: marker.lat, longitude: marker.lon, zoom: 18 };
    }
    const points = projection.areas[0]?.points ?? [];
    if (points.length === 0) {
      return null;
    }
    return {
      latitude: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      longitude: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
      zoom: 18,
    };
  };

  const updateSatelliteViewport = (viewport: CimmichPlacePlanViewport) => {
    const next = {
      latitude: Number(viewport.latitude.toFixed(7)),
      longitude: Number(viewport.longitude.toFixed(7)),
      zoom: Number(viewport.zoom.toFixed(2)),
    };
    if (
      draftBackgroundViewport?.latitude === next.latitude &&
      draftBackgroundViewport.longitude === next.longitude &&
      draftBackgroundViewport.zoom === next.zoom
    ) {
      return;
    }
    draftBackgroundViewport = next;
  };

  const startNew = (
    kind: CimmichPlacePlan['planKind'],
    backgroundKind: CimmichPlacePlan['backgroundKind'] = 'blank',
  ) => {
    draftPlanId = null;
    draftRevision = 0;
    draftName = kind === 'floor' ? 'Ground floor' : kind === 'outdoor' ? 'Yard' : 'Property';
    draftKind = kind;
    draftBackgroundKind = backgroundKind;
    draftBackgroundSourceAssetId = backgroundKind === 'asset' ? coverSourceAssetId : null;
    draftBackgroundViewport = backgroundKind === 'satellite' ? defaultSatelliteViewport() : null;
    draftItems = [];
    draftDefault = plans.length === 0;
    selectedChildId = '';
    paintingChildId = '';
    paint = null;
    saveError = '';
    editing = true;
  };

  const editPlan = () => {
    if (!activePlan) {
      return;
    }
    draftPlanId = activePlan.planId;
    draftRevision = activePlan.revision;
    draftName = activePlan.displayName;
    draftKind = activePlan.planKind;
    draftBackgroundKind = activePlan.backgroundKind;
    draftBackgroundSourceAssetId = activePlan.backgroundSourceAssetId;
    draftBackgroundViewport =
      activePlan.backgroundKind === 'satellite' ? (activePlan.backgroundViewport ?? defaultSatelliteViewport()) : null;
    draftItems = activePlan.items.map((item) => ({
      childEntityId: item.childEntityId,
      childName: item.childName,
      geometry: structuredClone(item.geometry),
      zIndex: item.zIndex,
    }));
    draftDefault = activePlan.isDefault;
    selectedChildId = '';
    paintingChildId = '';
    paint = null;
    saveError = '';
    editing = true;
  };

  const cancelEdit = () => {
    editing = false;
    selectedChildId = '';
    paintingChildId = '';
    paint = null;
    drag = null;
    saveError = '';
  };

  const startPainting = (child: CimmichContextEntity, mode: 'outline' | 'paint') => {
    selectedChildId = '';
    paintingChildId = child.entityId;
    paintingMode = mode;
    paint = null;
  };

  const canvasPoint = (event: PointerEvent) => {
    if (!canvas) {
      return null;
    }
    const bounds = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  };

  const beginPaint = (event: PointerEvent) => {
    const point = canvasPoint(event);
    if (!editing || !paintingChild || !point) {
      return;
    }
    event.preventDefault();
    saveError = '';
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    paint = { pointerId: event.pointerId, points: [point] };
  };

  const continuePaint = (event: PointerEvent) => {
    const point = canvasPoint(event);
    if (!paint || paint.pointerId !== event.pointerId || !point || paint.points.length >= 256) {
      return;
    }
    const previous = paint.points.at(-1);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.006) {
      return;
    }
    paint = { ...paint, points: [...paint.points, point] };
  };

  const finishPaint = (event: PointerEvent) => {
    if (!paint || paint.pointerId !== event.pointerId || !paintingChild) {
      return;
    }
    const finalPoint = canvasPoint(event);
    const previous = paint.points.at(-1);
    const points =
      finalPoint && (!previous || Math.hypot(finalPoint.x - previous.x, finalPoint.y - previous.y) >= 0.006)
        ? [...paint.points, finalPoint]
        : paint.points;
    paint = null;
    if (paintingMode === 'outline') {
      if (points.length < 3) {
        return;
      }
      const geometry = { kind: 'polygon' as const, points };
      const existing = draftItems.find((item) => item.childEntityId === paintingChild.entityId);
      draftItems = existing
        ? draftItems.map((item) => (item.childEntityId === paintingChild.entityId ? { ...item, geometry } : item))
        : [
            ...draftItems,
            {
              childEntityId: paintingChild.entityId,
              childName: paintingChild.displayName,
              geometry,
              zIndex: draftItems.length,
            },
          ];
      selectedChildId = paintingChild.entityId;
      paintingChildId = '';
      return;
    }
    if (points.length === 0) {
      return;
    }
    const stroke = { points, radius: 0.035 };
    const existing = draftItems.find((item) => item.childEntityId === paintingChild.entityId);
    const existingStrokes = existing?.geometry.kind === 'paint' ? existing.geometry.strokes : [];
    if (existingStrokes.length >= 64) {
      saveError = `${paintingChild.displayName} already has the maximum 64 painted areas.`;
      return;
    }
    const existingPointCount = existingStrokes.reduce((sum, existingStroke) => sum + existingStroke.points.length, 0);
    if (existingPointCount + points.length > 2048) {
      saveError = `${paintingChild.displayName} has reached the maximum painted detail.`;
      return;
    }
    draftItems = existing
      ? draftItems.map((item) => {
          if (item.childEntityId !== paintingChild.entityId) {
            return item;
          }
          const strokes = item.geometry.kind === 'paint' ? [...item.geometry.strokes, stroke] : [stroke];
          return { ...item, geometry: { kind: 'paint' as const, strokes } };
        })
      : [
          ...draftItems,
          {
            childEntityId: paintingChild.entityId,
            childName: paintingChild.displayName,
            geometry: { kind: 'paint' as const, strokes: [stroke] },
            zIndex: draftItems.length,
          },
        ];
  };

  const removeSelected = () => {
    if (!selectedChildId) {
      return;
    }
    draftItems = draftItems.filter((item) => item.childEntityId !== selectedChildId);
    selectedChildId = '';
    paint = null;
  };

  const clamp = (number: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, number));

  const beginDrag = (event: PointerEvent, item: DraftItem, kind: 'move' | 'resize') => {
    if (!editing || item.geometry.kind !== 'rect') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectedChildId = item.childEntityId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      childEntityId: item.childEntityId,
      kind,
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect: { ...item.geometry },
    };
  };

  const continueDrag = (event: PointerEvent) => {
    if (!drag || !canvas) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const dx = (event.clientX - drag.pointerX) / bounds.width;
    const dy = (event.clientY - drag.pointerY) / bounds.height;
    draftItems = draftItems.map((item) => {
      if (item.childEntityId !== drag?.childEntityId || item.geometry.kind !== 'rect') {
        return item;
      }
      const geometry =
        drag.kind === 'move'
          ? {
              ...drag.rect,
              x: clamp(drag.rect.x + dx, 0, 1 - drag.rect.w),
              y: clamp(drag.rect.y + dy, 0, 1 - drag.rect.h),
            }
          : {
              ...drag.rect,
              h: clamp(drag.rect.h + dy, 0.08, 1 - drag.rect.y),
              w: clamp(drag.rect.w + dx, 0.1, 1 - drag.rect.x),
            };
      return { ...item, geometry };
    });
  };

  const finishDrag = () => (drag = null);

  const itemStyle = (geometry: CimmichPlacePlanGeometry) => {
    if (geometry.kind === 'rect') {
      return `left:${geometry.x * 100}%;top:${geometry.y * 100}%;width:${geometry.w * 100}%;height:${geometry.h * 100}%`;
    }
    if (geometry.kind === 'point') {
      return `left:${geometry.x * 100}%;top:${geometry.y * 100}%;width:2.75rem;height:2.75rem;transform:translate(-50%,-50%)`;
    }
    if (geometry.kind === 'paint') {
      return '';
    }
    const xs = geometry.points.map((point) => point.x);
    const ys = geometry.points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left || 0.01;
    const height = Math.max(...ys) - top || 0.01;
    const polygon = geometry.points
      .map((point) => `${((point.x - left) / width) * 100}% ${((point.y - top) / height) * 100}%`)
      .join(',');
    return `left:${left * 100}%;top:${top * 100}%;width:${width * 100}%;height:${height * 100}%;clip-path:polygon(${polygon})`;
  };

  const paintPath = (points: Array<{ x: number; y: number }>) => {
    const [first, ...rest] = points;
    if (!first) {
      return '';
    }
    const tail = rest.length > 0 ? rest.map((point) => `L ${point.x} ${point.y}`).join(' ') : 'l 0.0001 0';
    return `M ${first.x} ${first.y} ${tail}`;
  };

  const paintLabelStyle = (geometry: Extract<CimmichPlacePlanGeometry, { kind: 'paint' }>) => {
    const point = geometry.strokes[0]?.points[0] ?? { x: 0.5, y: 0.5 };
    return `left:${point.x * 100}%;top:${point.y * 100}%`;
  };

  const save = async () => {
    if (!draftName.trim() || saving) {
      return;
    }
    saving = true;
    saveError = '';
    try {
      await onSave({
        backgroundKind: draftBackgroundKind,
        backgroundSourceAssetId: draftBackgroundSourceAssetId,
        backgroundViewport: draftBackgroundKind === 'satellite' ? draftBackgroundViewport : null,
        displayName: draftName.trim(),
        expectedRevision: draftRevision,
        isDefault: draftDefault,
        items: draftItems.map(({ childEntityId, geometry, zIndex }) => ({ childEntityId, geometry, zIndex })),
        planId: draftPlanId,
        planKind: draftKind,
      });
      editing = false;
      selectedChildId = '';
      paintingChildId = '';
      paint = null;
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'The Plan could not be saved.';
    } finally {
      saving = false;
    }
  };
</script>

<section class="place-plan" aria-labelledby="place-plan-title">
  <header class="place-plan__header">
    <div class="place-plan__identity">
      <span><Icon icon={mdiFloorPlan} size="22" /></span>
      <div>
        <h2 id="place-plan-title">Plans</h2>
        <p>{parent.displayName}</p>
      </div>
    </div>
    {#if !editing}
      <div class="place-plan__header-actions">
        {#if activePlan}<button type="button" onclick={editPlan}><Icon icon={mdiPencilOutline} size="17" /> Edit</button
          >{/if}
        <button
          class="place-plan__primary"
          type="button"
          onclick={() =>
            startNew(satelliteAvailable ? 'property' : 'floor', satelliteAvailable ? 'satellite' : 'blank')}
        >
          <Icon icon={mdiPlus} size="18" /> New plan
        </button>
      </div>
    {/if}
  </header>

  {#if !editing && plans.length > 0}
    <div class="place-plan__tabs" role="tablist" aria-label="Plans for this Location">
      {#each plans as plan (plan.planId)}
        <button
          type="button"
          role="tab"
          aria-selected={activePlan?.planId === plan.planId}
          class:place-plan__tab--active={activePlan?.planId === plan.planId}
          onclick={() => (activePlanId = plan.planId)}>{plan.displayName}</button
        >
      {/each}
    </div>
  {/if}

  {#if !editing && plans.length === 0}
    <div class="place-plan__empty">
      <span><Icon icon={mdiFloorPlan} size="34" /></span>
      <h3>Make the first plan</h3>
      <div class="place-plan__starts">
        {#if satelliteAvailable}
          <button class="place-plan__start--primary" type="button" onclick={() => startNew('property', 'satellite')}>
            <Icon icon={mdiSatelliteVariant} size="21" /><strong>Use satellite</strong><small
              >Start from this Location</small
            >
          </button>
        {/if}
        <button type="button" onclick={() => startNew('property')}>
          <Icon icon={mdiPlus} size="20" /><strong>Blank property</strong><small>House and yard</small>
        </button>
        <button type="button" onclick={() => startNew('floor')}>
          <Icon icon={mdiFloorPlan} size="20" /><strong>Blank floor</strong><small>Rooms and spaces</small>
        </button>
        {#if coverSourceAssetId}<button type="button" onclick={() => startNew('property', 'asset')}>
            <Icon icon={mdiImageOutline} size="20" /><strong>Use cover photo</strong><small
              >Arrange over the image</small
            >
          </button>{/if}
      </div>
    </div>
  {:else}
    {#if editing}
      <div class="place-plan__editor-bar">
        <label>
          <span>Plan name</span>
          <input bind:value={draftName} maxlength="120" placeholder="Ground floor" />
        </label>
        <label>
          <span>Kind</span>
          <select bind:value={draftKind}>
            <option value="property">Property</option>
            <option value="floor">Floor</option>
            <option value="outdoor">Outdoor</option>
            <option value="other">Other</option>
          </select>
        </label>
        {#if satelliteAvailable}
          <button
            class:place-plan__background-toggle--active={draftBackgroundKind === 'satellite'}
            type="button"
            aria-pressed={draftBackgroundKind === 'satellite'}
            onclick={() => {
              draftBackgroundKind = 'satellite';
              draftBackgroundSourceAssetId = null;
              draftBackgroundViewport ??= defaultSatelliteViewport();
            }}><Icon icon={mdiSatelliteVariant} size="17" /> Satellite</button
          >
        {/if}
        {#if coverSourceAssetId}
          <button
            class:place-plan__background-toggle--active={draftBackgroundKind === 'asset'}
            type="button"
            aria-pressed={draftBackgroundKind === 'asset'}
            onclick={() => {
              draftBackgroundKind = 'asset';
              draftBackgroundSourceAssetId = coverSourceAssetId;
              draftBackgroundViewport = null;
            }}><Icon icon={mdiImageOutline} size="17" /> Cover photo</button
          >
        {/if}
        <button
          class:place-plan__background-toggle--active={draftBackgroundKind === 'blank'}
          type="button"
          aria-pressed={draftBackgroundKind === 'blank'}
          onclick={() => {
            draftBackgroundKind = 'blank';
            draftBackgroundSourceAssetId = null;
            draftBackgroundViewport = null;
          }}><Icon icon={mdiPlus} size="17" /> Blank</button
        >
        <div class="place-plan__save-actions">
          <button type="button" disabled={saving} onclick={cancelEdit}><Icon icon={mdiClose} size="17" /> Cancel</button
          >
          <button
            class="place-plan__primary"
            type="button"
            disabled={!draftName.trim() || saving}
            onclick={() => void save()}
          >
            <Icon icon={mdiCheck} size="17" />
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      </div>
    {/if}

    <div class="place-plan__workspace" class:place-plan__workspace--editing={editing}>
      <div
        class="place-plan__canvas"
        class:place-plan__canvas--photo={Boolean(visibleBackground)}
        bind:this={canvas}
        aria-label={`${editing ? 'Editing' : 'Viewing'} ${editing ? draftName : activePlan?.displayName}`}
      >
        {#if visibleBackgroundKind === 'satellite'}
          <CimmichPlanSatellite
            interactive={editing}
            location={parent}
            onViewportChange={editing ? updateSatelliteViewport : undefined}
            viewport={visibleBackgroundViewport}
          />
          {#if editing}
            <button
              class="place-plan__reset-view"
              type="button"
              aria-label="Reset satellite position and zoom"
              title="Reset satellite position and zoom"
              onclick={() => (draftBackgroundViewport = defaultSatelliteViewport())}
              ><Icon icon={mdiRestore} size="19" /></button
            >
          {/if}
        {/if}
        {#if visibleBackground}
          <img src={getAssetMediaUrl({ id: visibleBackground, size: AssetMediaSize.Preview })} alt="" />
        {/if}
        <div class="place-plan__grid"></div>
        {#if editing && paintingChild}
          <div
            class="place-plan__paint-layer"
            role="application"
            aria-label={`${paintingMode === 'outline' ? 'Outline' : 'Paint'} ${paintingChild.displayName} on this plan`}
            onpointerdown={beginPaint}
            onpointermove={continuePaint}
            onpointerup={finishPaint}
            onpointercancel={() => (paint = null)}
          >
            <span class="place-plan__paint-hint"
              ><Icon icon={paintingMode === 'outline' ? mdiVectorPolygon : mdiBrushVariant} size="17" />
              {paintingMode === 'outline'
                ? `Drag around ${paintingChild.displayName}`
                : `Hold to paint ${paintingChild.displayName} · repeat anywhere`}</span
            >
            {#if outlinePreview}
              <div class="place-plan__paint-preview" style={itemStyle(outlinePreview)}>
                <span>{paintingChild.displayName}</span>
              </div>
            {/if}
            {#if brushPreview}
              <svg class="place-plan__brush-preview" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                {#each brushPreview.strokes as stroke, strokeIndex (strokeIndex)}
                  <path
                    d={paintPath(stroke.points)}
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width={stroke.radius * 2}
                  />
                {/each}
              </svg>
            {/if}
          </div>
        {/if}
        {#each visibleItems as item (item.childEntityId)}
          {@const child = children.find((candidate) => candidate.entityId === item.childEntityId)}
          {#if item.geometry.kind === 'paint'}
            <svg
              class="place-plan__paint-zone"
              class:place-plan__paint-zone--selected={editing && selectedChildId === item.childEntityId}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {#each item.geometry.strokes as stroke, strokeIndex (strokeIndex)}
                <path
                  d={paintPath(stroke.points)}
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={stroke.radius * 2}
                />
              {/each}
            </svg>
            <button
              class="place-plan__paint-label"
              class:place-plan__zone--selected={editing && selectedChildId === item.childEntityId}
              type="button"
              style={paintLabelStyle(item.geometry)}
              aria-label={`${item.childName}${editing ? ', select painted Location' : ', open Location'}`}
              onclick={() => {
                if (editing) {
                  selectedChildId = item.childEntityId;
                } else if (child) {
                  onOpenPlace(child);
                }
              }}
            >
              <span>{item.childName}</span>
              {#if !editing}<Icon icon={mdiArrowRight} size="15" />{/if}
            </button>
          {:else}
            <button
              class="place-plan__zone"
              class:place-plan__zone--selected={editing && selectedChildId === item.childEntityId}
              type="button"
              style={itemStyle(item.geometry)}
              aria-label={`${item.childName}${editing ? ', drag to move' : ', open Location'}`}
              onpointerdown={(event) => beginDrag(event, item, 'move')}
              onpointermove={continueDrag}
              onpointerup={finishDrag}
              onpointercancel={finishDrag}
              onclick={() => {
                if (editing) {
                  selectedChildId = item.childEntityId;
                } else if (child) {
                  onOpenPlace(child);
                }
              }}
            >
              <span>{item.childName}</span>
              {#if !editing}<Icon icon={mdiArrowRight} size="15" />{/if}
              {#if editing && item.geometry.kind === 'rect'}
                <i
                  role="button"
                  tabindex="-1"
                  aria-label={`Resize ${item.childName}`}
                  onpointerdown={(event) => beginDrag(event, item, 'resize')}
                  onpointermove={continueDrag}
                  onpointerup={finishDrag}
                  onpointercancel={finishDrag}
                ></i>
              {/if}
            </button>
          {/if}
        {/each}
        {#if visibleItems.length === 0 && !paintingChild}
          <div class="place-plan__canvas-empty">Choose a Location to place</div>
        {/if}
      </div>

      {#if editing}
        <aside class="place-plan__tray" aria-label="Locations on this plan">
          <div>
            <strong>Locations</strong>
            <span>{draftItems.length} placed</span>
          </div>
          <button class="place-plan__new-location" type="button" onclick={onCreateLocation}>
            <Icon icon={mdiMapMarkerPlusOutline} size="18" /> New location
          </button>
          <ul>
            {#each children as child (child.entityId)}
              <li
                class:place-plan__tray-item--selected={selectedChildId === child.entityId ||
                  paintingChildId === child.entityId}
              >
                <div class="place-plan__tray-name">
                  <span>{child.displayName}</span>
                  {#if placedIds.has(child.entityId)}<Icon icon={mdiCheck} size="15" />{/if}
                </div>
                <div class="place-plan__tray-actions" role="group" aria-label={`Place ${child.displayName}`}>
                  <button
                    type="button"
                    class:place-plan__tray-action--active={paintingChildId === child.entityId &&
                      paintingMode === 'outline'}
                    aria-label={`Outline ${child.displayName}`}
                    title={`Outline ${child.displayName}`}
                    onclick={() => startPainting(child, 'outline')}
                  >
                    <Icon icon={mdiVectorPolygon} size="15" /> Outline
                  </button>
                  <button
                    type="button"
                    class:place-plan__tray-action--active={paintingChildId === child.entityId &&
                      paintingMode === 'paint'}
                    aria-label={`Paint ${child.displayName}`}
                    title={`Paint ${child.displayName}`}
                    onclick={() => startPainting(child, 'paint')}
                  >
                    <Icon icon={mdiBrushVariant} size="15" /> Paint
                  </button>
                </div>
              </li>
            {/each}
          </ul>
          {#if paintingChildId}
            <button
              class="place-plan__cancel-paint"
              type="button"
              onclick={() => {
                paintingChildId = '';
                paint = null;
              }}>{paintingMode === 'paint' ? 'Done painting' : 'Cancel outline'}</button
            >
          {:else if selectedChildId}
            <button class="place-plan__remove" type="button" onclick={removeSelected}>Remove from this plan</button>
          {/if}
          {#if unplacedChildren.length > 0 && draftItems.length > 0}
            <small class="place-plan__tray-count">{unplacedChildren.length} not placed</small>
          {/if}
        </aside>
      {/if}
    </div>
    {#if saveError}<p class="place-plan__error" role="alert">{saveError}</p>{/if}
  {/if}
</section>

<style>
  .place-plan {
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 1.5rem;
    background: white;
  }
  :global(.dark) .place-plan {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }
  .place-plan__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.1rem;
    border-bottom: 1px solid rgb(229 231 235);
  }
  :global(.dark) .place-plan__header {
    border-color: rgb(31 41 55);
  }
  .place-plan__identity,
  .place-plan__header-actions,
  .place-plan__save-actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }
  .place-plan__identity > span {
    display: grid;
    width: 2.65rem;
    height: 2.65rem;
    place-items: center;
    border-radius: 0.9rem;
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.1);
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 750;
  }
  h3 {
    font-weight: 750;
  }
  .place-plan__identity p {
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }
  button {
    min-height: 2.5rem;
    border-radius: 0.8rem;
    padding: 0 0.85rem;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .place-plan__header-actions button,
  .place-plan__save-actions button,
  .place-plan__editor-bar > button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .place-plan__primary {
    color: white;
    background: rgb(var(--immich-primary-color));
  }
  .place-plan__primary:disabled {
    opacity: 0.55;
  }
  .place-plan__tabs {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0.7rem 1rem 0;
  }
  .place-plan__tabs button {
    border: 1px solid transparent;
    border-radius: 999px;
  }
  .place-plan__tabs .place-plan__tab--active {
    border-color: rgb(var(--immich-primary-color) / 0.25);
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.08);
  }
  .place-plan__empty {
    display: grid;
    justify-items: center;
    gap: 0.75rem;
    padding: 3.5rem 1.25rem;
    text-align: center;
    background-image:
      linear-gradient(rgb(148 163 184/0.12) 1px, transparent 1px),
      linear-gradient(90deg, rgb(148 163 184/0.12) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .place-plan__empty > span {
    display: grid;
    width: 4rem;
    height: 4rem;
    place-items: center;
    border: 1px solid rgb(209 213 219);
    border-radius: 1.25rem;
    background: white;
  }
  :global(.dark) .place-plan__empty > span {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }
  .place-plan__starts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.65rem;
  }
  .place-plan__starts button {
    display: grid;
    min-width: 9.5rem;
    min-height: 6rem;
    place-items: center;
    gap: 0.15rem;
    border: 1px solid rgb(209 213 219);
    padding: 0.8rem;
    background: white;
  }
  :global(.dark) .place-plan__starts button {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }
  .place-plan__starts button:hover {
    border-color: rgb(var(--immich-primary-color));
  }
  .place-plan__starts .place-plan__start--primary {
    border-color: rgb(var(--immich-primary-color) / 0.45);
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.08);
  }
  .place-plan__starts small {
    color: rgb(107 114 128);
    font-weight: 500;
  }
  .place-plan__editor-bar {
    display: flex;
    align-items: end;
    gap: 0.7rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid rgb(229 231 235);
    background: rgb(249 250 251);
  }
  :global(.dark) .place-plan__editor-bar {
    border-color: rgb(31 41 55);
    background: rgb(15 23 42);
  }
  .place-plan__editor-bar label {
    display: grid;
    gap: 0.25rem;
  }
  .place-plan__editor-bar label span {
    color: rgb(107 114 128);
    font-size: 0.68rem;
    font-weight: 750;
    text-transform: uppercase;
  }
  input,
  select {
    min-height: 2.5rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.7rem;
    padding: 0 0.7rem;
    background: white;
    font-size: 0.83rem;
  }
  :global(.dark) input,
  :global(.dark) select {
    border-color: rgb(55 65 81);
    background: rgb(31 41 55);
  }
  .place-plan__background-toggle--active {
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.1);
  }
  .place-plan__save-actions {
    margin-left: auto;
  }
  .place-plan__workspace {
    display: grid;
    min-height: 34rem;
    padding: 1rem;
  }
  .place-plan__workspace--editing {
    grid-template-columns: minmax(0, 1fr) 15rem;
    gap: 1rem;
  }
  .place-plan__canvas {
    position: relative;
    overflow: hidden;
    min-height: 32rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 1.1rem;
    background: rgb(248 250 252);
    touch-action: none;
  }
  :global(.dark) .place-plan__canvas {
    border-color: rgb(55 65 81);
    background: rgb(15 23 42);
  }
  .place-plan__canvas > img,
  .place-plan__grid {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .place-plan__canvas > img {
    object-fit: cover;
    opacity: 0.62;
  }
  .place-plan__grid {
    z-index: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgb(100 116 139/0.12) 1px, transparent 1px),
      linear-gradient(90deg, rgb(100 116 139/0.12) 1px, transparent 1px);
    background-size: 28px 28px;
  }
  .place-plan__canvas--photo .place-plan__grid {
    background-color: rgb(15 23 42/0.12);
  }
  .place-plan__paint-layer {
    position: absolute;
    z-index: 4;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
  }
  .place-plan__paint-hint {
    position: absolute;
    top: 0.7rem;
    left: 50%;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    transform: translateX(-50%);
    border-radius: 999px;
    padding: 0.5rem 0.75rem;
    color: white;
    background: rgb(15 23 42 / 0.84);
    box-shadow: 0 4px 16px rgb(15 23 42 / 0.25);
    font-size: 0.75rem;
    font-weight: 750;
    pointer-events: none;
  }
  .place-plan__paint-preview {
    position: absolute;
    display: grid;
    place-items: center;
    border: 2px dashed rgb(var(--immich-primary-color));
    border-radius: 0.75rem;
    color: rgb(30 41 59);
    background: rgb(255 255 255 / 0.72);
    font-size: 0.78rem;
    font-weight: 750;
    pointer-events: none;
  }
  .place-plan__brush-preview,
  .place-plan__paint-zone {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .place-plan__brush-preview {
    color: rgb(var(--immich-primary-color) / 0.62);
  }
  .place-plan__paint-zone {
    z-index: 1;
    color: rgb(var(--immich-primary-color) / 0.45);
    filter: drop-shadow(0 4px 8px rgb(15 23 42 / 0.12));
  }
  .place-plan__paint-zone--selected {
    color: rgb(var(--immich-primary-color) / 0.7);
    filter: drop-shadow(0 0 5px rgb(var(--immich-primary-color) / 0.7));
  }
  .place-plan__paint-label {
    position: absolute;
    z-index: 3;
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    gap: 0.3rem;
    transform: translate(-50%, -50%);
    border: 2px solid rgb(var(--immich-primary-color) / 0.8);
    border-radius: 999px;
    padding: 0 0.65rem;
    color: rgb(30 41 59);
    background: rgb(255 255 255 / 0.88);
    box-shadow: 0 5px 16px rgb(15 23 42 / 0.14);
    backdrop-filter: blur(6px);
  }
  :global(.dark) .place-plan__paint-label {
    color: white;
    background: rgb(15 23 42 / 0.86);
  }
  .place-plan__zone {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    overflow: visible;
    border: 2px solid rgb(var(--immich-primary-color) / 0.8);
    border-radius: 0.75rem;
    padding: 0.4rem;
    color: rgb(30 41 59);
    background: rgb(255 255 255/0.84);
    box-shadow: 0 8px 24px rgb(15 23 42/0.12);
    backdrop-filter: blur(6px);
    user-select: none;
  }
  :global(.dark) .place-plan__zone {
    color: white;
    background: rgb(15 23 42/0.82);
  }
  .place-plan__zone:hover,
  .place-plan__zone--selected {
    border-color: rgb(var(--immich-primary-color));
    box-shadow:
      0 0 0 3px rgb(var(--immich-primary-color) / 0.18),
      0 10px 28px rgb(15 23 42/0.18);
  }
  .place-plan__zone span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
  .place-plan__zone i {
    position: absolute;
    right: -0.4rem;
    bottom: -0.4rem;
    width: 1rem;
    height: 1rem;
    border: 2px solid white;
    border-radius: 999px;
    background: rgb(var(--immich-primary-color));
    cursor: nwse-resize;
  }
  .place-plan__canvas-empty {
    position: absolute;
    z-index: 1;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgb(107 114 128);
    font-size: 0.85rem;
    font-weight: 650;
    pointer-events: none;
  }
  .place-plan__reset-view {
    position: absolute;
    top: 0.65rem;
    right: 0.65rem;
    z-index: 3;
    display: grid;
    width: 2.5rem;
    min-height: 2.5rem;
    place-items: center;
    border: 1px solid rgb(255 255 255 / 0.55);
    border-radius: 0.65rem;
    padding: 0;
    color: rgb(15 23 42);
    background: rgb(255 255 255 / 0.9);
    box-shadow: 0 2px 8px rgb(15 23 42 / 0.2);
    backdrop-filter: blur(6px);
  }
  .place-plan__tray {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
  }
  .place-plan__tray > div {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .place-plan__tray > div span {
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }
  .place-plan__tray ul {
    display: grid;
    max-height: 26rem;
    gap: 0.35rem;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .place-plan__tray li {
    display: grid;
    gap: 0.45rem;
    border: 1px solid rgb(229 231 235);
    border-radius: 0.85rem;
    padding: 0.55rem;
  }
  :global(.dark) .place-plan__tray li {
    border-color: rgb(55 65 81);
  }
  .place-plan__tray-item--selected {
    border-color: rgb(var(--immich-primary-color)) !important;
    background: rgb(var(--immich-primary-color) / 0.045);
  }
  .place-plan__tray-name,
  .place-plan__tray-actions,
  .place-plan__tray-actions button {
    display: flex;
    align-items: center;
  }
  .place-plan__tray-name {
    min-width: 0;
    justify-content: space-between;
    gap: 0.45rem;
    padding: 0 0.15rem;
    font-size: 0.8rem;
    font-weight: 750;
  }
  .place-plan__tray-name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .place-plan__tray-name :global(svg) {
    flex: none;
    color: rgb(var(--immich-primary-color));
  }
  .place-plan__tray-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem;
  }
  .place-plan__tray-actions button {
    min-height: 2rem;
    justify-content: center;
    gap: 0.3rem;
    border: 1px solid rgb(226 232 240);
    border-radius: 0.6rem;
    padding: 0 0.35rem;
    color: rgb(71 85 105);
    background: rgb(248 250 252);
    font-size: 0.69rem;
  }
  :global(.dark) .place-plan__tray-actions button {
    border-color: rgb(51 65 85);
    color: rgb(203 213 225);
    background: rgb(30 41 59);
  }
  .place-plan__tray-actions button:hover,
  .place-plan__tray-actions .place-plan__tray-action--active {
    border-color: rgb(var(--immich-primary-color));
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.1);
  }
  .place-plan__new-location {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .place-plan__new-location {
    width: 100%;
    justify-content: center;
    border: 1px dashed rgb(var(--immich-primary-color) / 0.55);
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.06);
  }
  .place-plan__cancel-paint {
    color: rgb(71 85 105);
    background: rgb(241 245 249);
  }
  .place-plan__remove {
    color: rgb(185 28 28);
    background: rgb(254 242 242);
  }
  .place-plan__tray-count {
    color: rgb(107 114 128);
    text-align: center;
  }
  .place-plan__error {
    margin: 0 1rem 1rem;
    border-radius: 0.8rem;
    padding: 0.75rem;
    color: rgb(153 27 27);
    background: rgb(254 242 242);
    font-size: 0.8rem;
  }
  @media (max-width: 800px) {
    .place-plan__workspace--editing {
      grid-template-columns: 1fr;
    }
    .place-plan__tray {
      order: -1;
    }
    .place-plan__tray ul {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      max-height: 10rem;
    }
    .place-plan__editor-bar {
      align-items: stretch;
      flex-wrap: wrap;
    }
    .place-plan__save-actions {
      width: 100%;
      margin-left: 0;
      justify-content: flex-end;
    }
    .place-plan__canvas {
      min-height: 25rem;
    }
    .place-plan__workspace {
      min-height: 27rem;
    }
  }
</style>
