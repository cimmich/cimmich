<script lang="ts">
  import type {
    CimmichContextDetail,
    CimmichContextEntity,
    CimmichContextFamily,
    CimmichPlacePlan,
    CimmichPlacePlanGeometry,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getAssetInfo } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    mdiCalendarBlankOutline,
    mdiFloorPlan,
    mdiMapMarkerOutline,
    mdiMapOutline,
    mdiPackageVariantClosed,
  } from '@mdi/js';
  import {
    contextAssetViewerHref,
    contextFamilyEyebrows,
    contextPlaceHierarchy,
    contextPlaceLocationLabel,
    contextPlaceMapProjection,
    contextTypeDescription,
    contextTypeLabel,
    formatContextDatePrecision,
    formatImmichPlaceLocation,
  } from './context-entity-presentation';
  import CimmichPlanSatellite from './CimmichPlanSatellite.svelte';

  interface Props {
    detail: CimmichContextDetail;
    entities: CimmichContextEntity[];
    family: CimmichContextFamily;
    onOpenPlan?: () => void;
    plans?: CimmichPlacePlan[];
  }

  let { detail, entities, family, onOpenPlan, plans = [] }: Props = $props();
  const heroAsset = $derived(
    detail.assets.find((asset) => asset.sourceAssetId === detail.entity.coverAssetId) ?? detail.assets[0] ?? null,
  );
  const placeHierarchy = $derived(contextPlaceHierarchy(detail.entity, entities));
  const placeProjection = $derived(contextPlaceMapProjection([detail.entity]));
  const hasMappedPlace = $derived(placeProjection.markers.length + placeProjection.areas.length > 0);
  const isPlace = $derived(family === 'places');
  const placeChildren = $derived(
    entities
      .filter((entity) => entity.status === 'active' && entity.parentEntityId === detail.entity.entityId)
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
  );
  const defaultPlan = $derived(plans.find((plan) => plan.isDefault) ?? plans[0] ?? null);
  const planItemStyle = (geometry: CimmichPlacePlanGeometry) => {
    if (geometry.kind === 'rect') {
      return `left:${geometry.x * 100}%;top:${geometry.y * 100}%;width:${geometry.w * 100}%;height:${geometry.h * 100}%`;
    }
    if (geometry.kind === 'point') {
      return `left:${geometry.x * 100}%;top:${geometry.y * 100}%;width:2rem;height:2rem;transform:translate(-50%,-50%)`;
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
  const polygonPoints = (geometry: Extract<CimmichPlacePlanGeometry, { kind: 'polygon' }>) =>
    geometry.points.map((point) => `${point.x},${point.y}`).join(' ');
  const polygonLabelStyle = (geometry: Extract<CimmichPlacePlanGeometry, { kind: 'polygon' }>) => {
    const point = { x: 0, y: 0 };
    for (const current of geometry.points) {
      point.x += current.x;
      point.y += current.y;
    }
    const count = Math.max(geometry.points.length, 1);
    return `left:${(point.x / count) * 100}%;top:${(point.y / count) * 100}%`;
  };
  const geometryArea = (geometry: CimmichPlacePlanGeometry) => {
    if (geometry.kind === 'rect') {
      return geometry.w * geometry.h;
    }
    if (geometry.kind === 'point') {
      return 0;
    }
    if (geometry.kind === 'paint') {
      const points = geometry.strokes.flatMap((stroke) => stroke.points);
      if (points.length === 0) {
        return 0;
      }
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const radius = Math.max(...geometry.strokes.map((stroke) => stroke.radius), 0);
      return (Math.max(...xs) - Math.min(...xs) + radius * 2) * (Math.max(...ys) - Math.min(...ys) + radius * 2);
    }
    let area = 0;
    for (const [index, point] of geometry.points.entries()) {
      const next = geometry.points[(index + 1) % geometry.points.length] ?? point;
      area += point.x * next.y - next.x * point.y;
    }
    return Math.abs(area / 2);
  };
  const renderedPlanItems = $derived.by(() =>
    [...(defaultPlan?.items ?? [])].sort((left, right) => geometryArea(right.geometry) - geometryArea(left.geometry)),
  );
  const placeGeography = $derived.by(() => {
    if (!isPlace || detail.entity.placeRole === 'geography') {
      return null;
    }
    let current: CimmichContextEntity | undefined = detail.entity;
    const visited = new SvelteSet<string>();
    while (current && !visited.has(current.entityId)) {
      visited.add(current.entityId);
      if (current.geographyEntityId) {
        return entities.find((entity) => entity.entityId === current?.geographyEntityId) ?? null;
      }
      current = current.parentEntityId
        ? entities.find((entity) => entity.entityId === current?.parentEntityId)
        : undefined;
    }
    return null;
  });

  // The strip's map MUST be told where to look. Immich's Map only auto-fits to its
  // markers when no `zoom` is supplied, and it only honours `jumpTo` when a `center`
  // is supplied — so passing `zoom` alone (as this did) disables the auto-fit and
  // leaves the map at the style's default centre, i.e. open ocean. Same derivation
  // as the Map tab's locator centre in CimmichContextPlaceMap.
  const locatorCenter = $derived(
    placeProjection.markers[0]
      ? { lng: placeProjection.markers[0].lon, lat: placeProjection.markers[0].lat }
      : undefined,
  );

  // Immich has already reverse-geocoded this asset to city/state/country, so ask
  // it rather than deriving a place name from coordinates. Keyed by asset id so
  // switching places refetches, and failures stay silent — the label falls back
  // through the ladder in contextPlaceLocationLabel.
  let geocodedLocation = $state('');
  $effect(() => {
    const assetId = isPlace ? heroAsset?.sourceAssetId : undefined;
    if (!assetId) {
      geocodedLocation = '';
      return;
    }
    let current = true;
    void getAssetInfo({ id: assetId })
      .then((asset) => {
        if (current) {
          geocodedLocation = formatImmichPlaceLocation(asset.exifInfo);
        }
      })
      .catch(() => {
        if (current) {
          geocodedLocation = '';
        }
      });
    return () => {
      current = false;
    };
  });

  const placeLocation = $derived(
    placeGeography?.displayName || contextPlaceLocationLabel(detail.entity, placeHierarchy, geocodedLocation),
  );
  // A place's identity is where it is, so the line above the name states the
  // location rather than a family tagline.
  const eyebrow = $derived(isPlace ? placeLocation : contextFamilyEyebrows[family]);
  const familyIcon = $derived(
    family === 'places'
      ? detail.entity.placeRole === 'geography'
        ? mdiMapOutline
        : mdiMapMarkerOutline
      : family === 'objects'
        ? mdiPackageVariantClosed
        : mdiCalendarBlankOutline,
  );
  const subline = $derived(
    [
      detail.entity.description || (isPlace ? '' : contextTypeDescription(detail.entity.typeKind)),
      family === 'events' ? formatContextDatePrecision(detail.entity) || 'Not dated yet' : '',
      !isPlace && detail.entity.aliases.length > 0 ? `Also ${detail.entity.aliases.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('  ·  '),
  );
  const showMap = $derived(isPlace && (hasMappedPlace || detail.entity.placeRole === 'location'));
  let placeVisualView = $state<'map' | 'plan'>('map');
  let shownPlaceId = $state('');
  $effect(() => {
    if (detail.entity.entityId !== shownPlaceId) {
      shownPlaceId = detail.entity.entityId;
      placeVisualView = hasMappedPlace ? 'map' : 'plan';
    }
  });
</script>

<!--
  A hero STRIP, not a picture frame. Nobody studies the photo here — they click
  through to the viewer or the Photos tab for that — so the image earns a band,
  not a column beside a column of text. The name and location sit ON the strip,
  which is why there is no copy column and no whitespace to spend. For a place
  the map takes the other half of the band, edge to edge: it is a map, and a map
  boxed inside padding with a border is smaller and less useful for no gain.
-->
<article
  class="context-detail-hero"
  class:context-detail-hero--mapped={showMap}
  data-family={family}
  aria-labelledby="context-detail-title"
>
  <div class="context-detail-frame">
    {#if heroAsset}
      <a
        class="context-detail-asset-link"
        href={contextAssetViewerHref(heroAsset.sourceAssetId)}
        aria-label={`Open ${heroAsset.filename}`}
      >
        <img
          src={getAssetMediaUrl({ id: heroAsset.sourceAssetId, size: AssetMediaSize.Preview })}
          alt=""
          fetchpriority="high"
        />
      </a>
    {:else}
      <div class="context-detail-placeholder">
        <span><Icon icon={familyIcon} size="34" /></span>
      </div>
    {/if}

    <!-- Opaque enough at the text to hold contrast over any photo, including a
         bright one. The identity has to stay readable whatever the owner's
         cover image happens to be. -->
    <div class="context-detail-caption">
      <p class="context-detail-eyebrow">
        {#if !isPlace}
          <span class="context-detail-kind"
            ><Icon icon={familyIcon} size="13" /> {contextTypeLabel(detail.entity.typeKind)}</span
          >
        {/if}
        <!-- Icon and text in one flex item so a wrap never strands the marker on
             the line above its location. -->
        <span class="context-detail-eyebrow-text">
          {#if isPlace}<Icon icon={mdiMapMarkerOutline} size="14" />{/if}{eyebrow}
        </span>
      </p>
      <h1 id="context-detail-title">{detail.entity.displayName}</h1>
      {#if subline}<p class="context-detail-subline">{subline}</p>{/if}
    </div>
  </div>

  {#if showMap}
    <div class="context-detail-visual">
      {#if detail.entity.placeRole === 'location'}
        <div class="context-detail-visual-switch" role="group" aria-label="Location view">
          <button
            type="button"
            disabled={!hasMappedPlace}
            aria-pressed={placeVisualView === 'map'}
            class:context-detail-visual-switch--active={placeVisualView === 'map'}
            onclick={() => (placeVisualView = 'map')}>Map</button
          >
          <button
            type="button"
            aria-pressed={placeVisualView === 'plan'}
            class:context-detail-visual-switch--active={placeVisualView === 'plan'}
            onclick={() => (placeVisualView = 'plan')}>Plan</button
          >
        </div>
      {/if}

      {#if placeVisualView === 'plan' && detail.entity.placeRole === 'location'}
        <div
          class="context-detail-plan"
          id="context-detail-plan-view"
          aria-label={`Plan for ${detail.entity.displayName}`}
        >
          <div class="context-detail-plan-sheet">
            {#if defaultPlan}
              {#if defaultPlan.backgroundKind === 'satellite'}
                <CimmichPlanSatellite location={detail.entity} viewport={defaultPlan.backgroundViewport} />
              {/if}
              {#if defaultPlan.backgroundSourceAssetId}
                <img
                  class="context-detail-plan-background"
                  src={getAssetMediaUrl({ id: defaultPlan.backgroundSourceAssetId, size: AssetMediaSize.Preview })}
                  alt=""
                />
              {/if}
              <div class="context-detail-plan-grid"></div>
              {#each renderedPlanItems as item (item.planItemId)}
                {#if item.geometry.kind === 'paint'}
                  <svg
                    class="context-detail-plan-paint"
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
                  <span class="context-detail-plan-paint-label" style={paintLabelStyle(item.geometry)}
                    >{item.childName}</span
                  >
                {:else if item.geometry.kind === 'polygon'}
                  <svg
                    class="context-detail-plan-outline"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <polygon points={polygonPoints(item.geometry)} vector-effect="non-scaling-stroke" />
                  </svg>
                  <span class="context-detail-plan-paint-label" style={polygonLabelStyle(item.geometry)}
                    >{item.childName}</span
                  >
                {:else}
                  <span class="context-detail-plan-zone" style={planItemStyle(item.geometry)}>{item.childName}</span>
                {/if}
              {/each}
              <button class="context-detail-plan-open" type="button" onclick={() => onOpenPlan?.()}>
                {defaultPlan.displayName}
              </button>
            {:else}
              <span class="context-detail-plan-icon"><Icon icon={mdiFloorPlan} size="30" /></span>
              <strong>No plan yet</strong>
              {#if placeChildren.length > 0}
                <div class="context-detail-plan-places" aria-label="Internal locations ready to place">
                  {#each placeChildren as child (child.entityId)}<span>{child.displayName}</span>{/each}
                </div>
              {/if}
              <button class="context-detail-plan-create" type="button" onclick={() => onOpenPlan?.()}>Make plan</button>
            {/if}
          </div>
        </div>
      {:else}
        <!-- Explicit height, not min-height: a percentage height inside an
             auto-height box is what rendered the Map tab's map at 0px. Immich's map
             with its own controls and attribution left intact. -->
        <div
          class="context-detail-map"
          id="context-detail-map-view"
          aria-label={`Map showing ${detail.entity.displayName}`}
        >
          {#await import('$lib/components/shared-components/map/Map.svelte')}
            <div class="context-detail-map-pending">Loading the map…</div>
          {:then { default: Map }}
            <Map
              center={locatorCenter}
              mapMarkers={[]}
              placeAreas={placeProjection.areas}
              placeMarkers={placeProjection.markers}
              showPlaceMarkerLabels={false}
              showSettings={false}
              zoom={13}
            />
          {/await}
        </div>
      {/if}
    </div>
  {/if}
</article>

<style>
  .context-detail-hero {
    display: grid;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 24px;
    background: rgb(17 24 39);
  }

  :global(.dark) .context-detail-hero {
    border-color: rgb(31 41 55);
  }

  .context-detail-frame {
    position: relative;
    min-height: 260px;
    overflow: hidden;
    background: rgb(15 23 42);
  }

  /* The same indefinite-height chain as the collection covers: a percentage
     height against a parent sized only by `min-height` never resolves, so the
     image sized to its own aspect and a square photo forced a square hero.
     Pinning to the box edges hands height control back to the layout. */
  .context-detail-asset-link {
    position: absolute;
    inset: 0;
    display: block;
  }

  .context-detail-asset-link:focus-visible {
    outline: 3px solid white;
    outline-offset: -5px;
  }

  .context-detail-asset-link img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 220ms ease;
  }

  .context-detail-asset-link:hover img {
    transform: scale(1.012);
  }

  .context-detail-placeholder {
    display: grid;
    height: 100%;
    place-content: center;
    justify-items: center;
    color: rgb(148 163 184);
  }

  .context-detail-placeholder span {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    border-radius: 20px;
    background: rgb(255 255 255 / 0.08);
  }

  .context-detail-caption {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    padding: 44px 24px 20px;
    background: linear-gradient(to top, rgb(2 6 23 / 0.92) 0%, rgb(2 6 23 / 0.72) 42%, rgb(2 6 23 / 0) 100%);
    color: white;
  }

  .context-detail-eyebrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    color: rgb(226 232 240);
    font-size: 0.8rem;
    font-weight: 650;
    line-height: 1.35;
  }

  .context-detail-caption h1 {
    margin-top: 2px;
    font-size: clamp(1.6rem, 2.4vw, 2.25rem);
    font-weight: 680;
    letter-spacing: -0.02em;
    line-height: 1.1;
    overflow-wrap: break-word;
  }

  /* Clamped to two lines rather than a single ellipsised one: on a phone a
     single line cut "Also Home, Parents Home" down to "Parent…", which is worse
     than letting it use the line it needs. */
  .context-detail-subline {
    display: -webkit-box;
    overflow: hidden;
    margin-top: 4px;
    max-width: 70ch;
    color: rgb(203 213 225);
    font-size: 0.85rem;
    line-height: 1.4;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    -webkit-line-clamp: 2;
  }

  .context-detail-eyebrow-text {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .context-detail-kind {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid rgb(255 255 255 / 0.26);
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .context-detail-visual {
    position: relative;
    min-height: 260px;
    background: rgb(15 23 42);
  }

  .context-detail-map,
  .context-detail-map-pending,
  .context-detail-plan {
    position: absolute;
    inset: 0;
  }

  .context-detail-map-pending {
    display: grid;
    place-items: center;
    color: rgb(148 163 184);
    font-size: 0.8rem;
  }

  /* MapLibre wants a definite height from its container. */
  .context-detail-map :global(.maplibregl-map) {
    position: absolute;
    inset: 0;
  }

  .context-detail-visual-switch {
    position: absolute;
    z-index: 3;
    top: 12px;
    left: 50%;
    display: flex;
    gap: 2px;
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 999px;
    padding: 3px;
    background: rgb(2 6 23 / 0.78);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.22);
    transform: translateX(-50%);
    backdrop-filter: blur(12px);
  }

  .context-detail-visual-switch button {
    min-width: 64px;
    min-height: 32px;
    border-radius: 999px;
    padding: 0 12px;
    color: rgb(203 213 225);
    font-size: 0.75rem;
    font-weight: 750;
  }

  .context-detail-visual-switch button:hover,
  .context-detail-visual-switch button:focus-visible {
    color: white;
  }

  .context-detail-visual-switch button:focus-visible {
    outline: 2px solid white;
    outline-offset: 1px;
  }

  .context-detail-visual-switch button.context-detail-visual-switch--active {
    background: white;
    color: rgb(15 23 42);
  }

  .context-detail-plan {
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 64px 24px 24px;
    background-color: rgb(15 23 42);
    background-image:
      linear-gradient(rgb(148 163 184 / 0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgb(148 163 184 / 0.08) 1px, transparent 1px);
    background-size: 22px 22px;
  }

  .context-detail-plan-sheet {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    max-width: 32rem;
    min-height: 172px;
    place-content: center;
    justify-items: center;
    gap: 10px;
    color: rgb(226 232 240);
    text-align: center;
  }

  .context-detail-plan-background,
  .context-detail-plan-grid {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 16px;
  }

  .context-detail-plan-background {
    object-fit: cover;
    opacity: 0.52;
  }

  .context-detail-plan-grid {
    border: 1px solid rgb(148 163 184 / 0.2);
    background-image:
      linear-gradient(rgb(148 163 184 / 0.09) 1px, transparent 1px),
      linear-gradient(90deg, rgb(148 163 184 / 0.09) 1px, transparent 1px);
    background-size: 20px 20px;
  }

  .context-detail-plan-zone {
    position: absolute;
    z-index: 1;
    display: grid;
    min-width: 2rem;
    min-height: 2rem;
    place-items: center;
    overflow: hidden;
    border: 1px solid rgb(125 211 252 / 0.85);
    border-radius: 9px;
    padding: 4px;
    color: white;
    background: rgb(2 132 199 / 0.52);
    box-shadow: 0 5px 16px rgb(0 0 0 / 0.16);
    font-size: 0.64rem;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .context-detail-plan-paint {
    position: absolute;
    z-index: 1;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    color: rgb(var(--immich-primary-color) / 0.52);
    filter: drop-shadow(0 3px 7px rgb(15 23 42 / 0.16));
    pointer-events: none;
  }
  .context-detail-plan-outline {
    position: absolute;
    z-index: 1;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    filter: drop-shadow(0 3px 7px rgb(15 23 42 / 0.16));
    pointer-events: none;
  }
  .context-detail-plan-outline polygon {
    fill: rgb(var(--immich-primary-color) / 0.15);
    stroke: rgb(125 211 252 / 0.92);
    stroke-width: 1.5px;
    stroke-linejoin: round;
  }
  .context-detail-plan-paint-label {
    position: absolute;
    z-index: 2;
    transform: translate(-50%, -50%);
    border: 1px solid rgb(var(--immich-primary-color) / 0.75);
    border-radius: 999px;
    padding: 0.2rem 0.5rem;
    color: rgb(30 41 59);
    background: rgb(255 255 255 / 0.84);
    box-shadow: 0 4px 12px rgb(15 23 42 / 0.12);
    font-size: 0.68rem;
    font-weight: 750;
    pointer-events: none;
  }

  .context-detail-plan-open,
  .context-detail-plan-create {
    z-index: 2;
    min-height: 32px;
    border-radius: 999px;
    padding: 0 13px;
    color: white;
    background: rgb(2 6 23 / 0.76);
    box-shadow: 0 5px 18px rgb(0 0 0 / 0.2);
    font-size: 0.72rem;
    font-weight: 750;
  }

  .context-detail-plan-open {
    position: absolute;
    right: 10px;
    bottom: 10px;
  }

  .context-detail-plan-create {
    margin-top: 2px;
    border: 1px solid rgb(148 163 184 / 0.28);
  }

  .context-detail-plan-icon {
    display: grid;
    width: 58px;
    height: 58px;
    place-items: center;
    border: 1px solid rgb(148 163 184 / 0.22);
    border-radius: 18px;
    color: rgb(148 163 184);
    background: rgb(30 41 59 / 0.82);
  }

  .context-detail-plan-places {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 2px;
  }

  .context-detail-plan-places span {
    border: 1px solid rgb(148 163 184 / 0.2);
    border-radius: 999px;
    padding: 4px 9px;
    color: rgb(148 163 184);
    background: rgb(30 41 59 / 0.68);
    font-size: 0.7rem;
    font-weight: 650;
  }

  @media (min-width: 768px) {
    .context-detail-frame,
    .context-detail-visual {
      min-height: 300px;
    }

    /* Photo and map share one band with no gap and no inner padding, so the map
       runs to the hero's own edge. */
    .context-detail-hero--mapped {
      grid-template-columns: minmax(0, 1.35fr) minmax(280px, 1fr);
    }
  }

  @media (max-width: 767px) {
    .context-detail-caption {
      padding: 36px 18px 16px;
    }

    .context-detail-visual {
      min-height: 220px;
    }
  }
</style>
