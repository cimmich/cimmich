<script lang="ts">
  import type { CimmichContextDetail, CimmichContextEntity, CimmichContextFamily } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getAssetInfo } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCalendarBlankOutline, mdiMapMarkerOutline, mdiPackageVariantClosed } from '@mdi/js';
  import {
    contextAssetViewerHref,
    contextFamilyEyebrows,
    contextPlaceHierarchy,
    contextPlaceLocationLabel,
    contextPlaceMapProjection,
    contextTypeDescription,
    formatContextDatePrecision,
    formatImmichPlaceLocation,
    humanizeContextKind,
  } from './context-entity-presentation';

  interface Props {
    detail: CimmichContextDetail;
    entities: CimmichContextEntity[];
    family: CimmichContextFamily;
  }

  let { detail, entities, family }: Props = $props();
  const heroAsset = $derived(
    detail.assets.find((asset) => asset.sourceAssetId === detail.entity.coverAssetId) ?? detail.assets[0] ?? null,
  );
  const placeHierarchy = $derived(contextPlaceHierarchy(detail.entity, entities));
  const placeProjection = $derived(contextPlaceMapProjection([detail.entity]));
  const hasMappedPlace = $derived(placeProjection.markers.length + placeProjection.areas.length > 0);
  const isPlace = $derived(family === 'places');

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

  const placeLocation = $derived(contextPlaceLocationLabel(detail.entity, placeHierarchy, geocodedLocation));
  // A place's identity is where it is, so the line above the name states the
  // location rather than a family tagline.
  const eyebrow = $derived(isPlace ? placeLocation : contextFamilyEyebrows[family]);
  const familyIcon = $derived(
    family === 'places'
      ? mdiMapMarkerOutline
      : family === 'objects'
        ? mdiPackageVariantClosed
        : mdiCalendarBlankOutline,
  );
  const subline = $derived(
    [
      detail.entity.description || contextTypeDescription(detail.entity.typeKind),
      family === 'events' ? formatContextDatePrecision(detail.entity) || 'Not dated yet' : '',
      detail.entity.aliases.length > 0 ? `Also ${detail.entity.aliases.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('  ·  '),
  );
  const showMap = $derived(isPlace && hasMappedPlace);
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
        <!-- The type chip belongs with the rest of the metadata, not floating in
             the corner; that corner is worth more as the edit affordance. -->
        <span class="context-detail-kind"
          ><Icon icon={familyIcon} size="13" /> {humanizeContextKind(detail.entity.typeKind)}</span
        >
        <!-- Icon and text in one flex item so a wrap never strands the marker on
             the line above its location. -->
        <span class="context-detail-eyebrow-text">
          {#if isPlace}<Icon icon={mdiMapMarkerOutline} size="14" />{/if}{eyebrow}
        </span>
      </p>
      <h1 id="context-detail-title">{detail.entity.displayName}</h1>
      <p class="context-detail-subline">{subline}</p>
    </div>
  </div>

  {#if showMap}
    <!-- Explicit height, not min-height: a percentage height inside an
         auto-height box is what rendered the Map tab's map at 0px. Immich's map
         with its own controls and attribution left intact. -->
    <div class="context-detail-map" aria-label={`Map showing ${detail.entity.displayName}`}>
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

  .context-detail-map,
  .context-detail-map-pending {
    position: relative;
    min-height: 260px;
    background: rgb(15 23 42);
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

  @media (min-width: 768px) {
    .context-detail-frame,
    .context-detail-map,
    .context-detail-map-pending {
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

    .context-detail-map,
    .context-detail-map-pending {
      min-height: 220px;
    }
  }
</style>
