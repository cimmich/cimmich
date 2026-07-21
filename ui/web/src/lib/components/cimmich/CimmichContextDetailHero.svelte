<script lang="ts">
  import type { CimmichContextDetail, CimmichContextEntity, CimmichContextFamily } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCalendarBlankOutline, mdiCameraOutline, mdiMapMarkerOutline, mdiPackageVariantClosed } from '@mdi/js';
  import {
    contextAssetViewerHref,
    contextFamilyEyebrows,
    contextPlaceHierarchy,
    contextPlaceMapProjection,
    contextTypeDescription,
    formatContextDatePrecision,
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
  const familyIcon = $derived(
    family === 'places'
      ? mdiMapMarkerOutline
      : family === 'objects'
        ? mdiPackageVariantClosed
        : mdiCalendarBlankOutline,
  );
</script>

<article class="context-detail-hero" data-family={family} aria-labelledby="context-detail-title">
  <div class="context-detail-visual">
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
    {:else if family === 'places' && hasMappedPlace}
      {#await import('$lib/components/shared-components/map/Map.svelte')}
        <div class="context-detail-placeholder">Loading this place…</div>
      {:then { default: Map }}
        <Map
          mapMarkers={[]}
          placeAreas={placeProjection.areas}
          placeMarkers={placeProjection.markers}
          rounded
          showSatelliteControl
          showSettings={false}
        />
      {/await}
    {:else}
      <div class="context-detail-placeholder">
        <span><Icon icon={familyIcon} size="38" /></span>
        <p>{contextTypeDescription(detail.entity.typeKind)}</p>
      </div>
    {/if}
    <span class="context-detail-kind"
      ><Icon icon={familyIcon} size="15" /> {humanizeContextKind(detail.entity.typeKind)}</span
    >
  </div>

  <div class="context-detail-copy">
    <p class="context-detail-eyebrow">{contextFamilyEyebrows[family]}</p>
    {#if family === 'places' && placeHierarchy.length > 1}
      <p class="context-detail-hierarchy">{placeHierarchy.join(' / ')}</p>
    {/if}
    <h1 id="context-detail-title">{detail.entity.displayName}</h1>
    {#if detail.entity.description}
      <p class="context-detail-description">{detail.entity.description}</p>
    {:else}
      <p class="context-detail-description context-detail-description--quiet">
        {contextTypeDescription(detail.entity.typeKind)}
      </p>
    {/if}

    {#if detail.entity.aliases.length > 0}
      <div class="context-detail-aliases" aria-label="Other names">
        {#each detail.entity.aliases as alias (alias)}<span>{alias}</span>{/each}
      </div>
    {/if}

    <dl class="context-detail-facts">
      {#if family === 'events'}
        <div class="context-detail-fact context-detail-fact--wide">
          <dt>When</dt>
          <dd>{formatContextDatePrecision(detail.entity) || 'Not dated yet'}</dd>
        </div>
      {/if}
      <div class="context-detail-fact">
        <dt><Icon icon={mdiCameraOutline} size="15" /> Media</dt>
        <dd>{detail.entity.assetCount}</dd>
      </div>
      <div class="context-detail-fact">
        <dt>Connections</dt>
        <dd>{detail.relations.length}</dd>
      </div>
    </dl>
  </div>
</article>

<style>
  .context-detail-hero {
    display: grid;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 32px;
    background: white;
    box-shadow: 0 18px 50px rgb(15 23 42 / 0.06);
  }

  :global(.dark) .context-detail-hero {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
    box-shadow: 0 18px 50px rgb(0 0 0 / 0.2);
  }

  .context-detail-visual {
    position: relative;
    min-height: 290px;
    overflow: hidden;
    background: rgb(243 244 246);
  }

  :global(.dark) .context-detail-visual {
    background: rgb(15 23 42);
  }

  .context-detail-asset-link {
    display: block;
    width: 100%;
    height: 100%;
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
    min-height: 290px;
    place-content: center;
    justify-items: center;
    gap: 14px;
    padding: 32px;
    color: rgb(107 114 128);
    text-align: center;
  }

  .context-detail-placeholder span {
    display: grid;
    width: 72px;
    height: 72px;
    place-items: center;
    border-radius: 24px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-detail-kind {
    position: absolute;
    bottom: 18px;
    left: 18px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 34px;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    background: rgb(17 24 39 / 0.76);
    padding: 0 12px;
    color: white;
    font-size: 0.75rem;
    font-weight: 700;
    backdrop-filter: blur(12px);
  }

  .context-detail-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    padding: 28px;
  }

  .context-detail-eyebrow {
    color: rgb(var(--immich-primary));
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .context-detail-hierarchy {
    margin-top: 12px;
    overflow: hidden;
    color: rgb(107 114 128);
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-detail-copy h1 {
    margin-top: 10px;
    font-size: clamp(2rem, 4vw, 3.7rem);
    font-weight: 680;
    letter-spacing: -0.04em;
    line-height: 1;
    hyphens: auto;
    overflow-wrap: break-word;
    word-break: normal;
  }

  .context-detail-description {
    margin-top: 18px;
    max-width: 56ch;
    color: rgb(75 85 99);
    font-size: 0.95rem;
    line-height: 1.65;
  }

  :global(.dark) .context-detail-description {
    color: rgb(209 213 219);
  }

  .context-detail-description--quiet {
    color: rgb(107 114 128);
  }

  .context-detail-aliases {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
  }

  .context-detail-aliases span {
    border-radius: 999px;
    background: rgb(243 244 246);
    padding: 6px 10px;
    color: rgb(75 85 99);
    font-size: 0.75rem;
    font-weight: 650;
  }

  :global(.dark) .context-detail-aliases span {
    background: rgb(31 41 55);
    color: rgb(209 213 219);
  }

  .context-detail-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 28px;
  }

  .context-detail-fact {
    border-radius: 18px;
    background: rgb(249 250 251);
    padding: 13px 15px;
  }

  :global(.dark) .context-detail-fact {
    background: rgb(31 41 55 / 0.78);
  }

  .context-detail-fact--wide {
    grid-column: 1 / -1;
  }

  .context-detail-fact dt {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgb(107 114 128);
    font-size: 0.7rem;
  }

  .context-detail-fact dd {
    margin-top: 4px;
    font-size: 1.05rem;
    font-weight: 700;
  }

  @media (min-width: 768px) {
    .context-detail-hero {
      grid-template-columns: minmax(0, 1.18fr) minmax(320px, 0.82fr);
    }

    .context-detail-visual,
    .context-detail-placeholder {
      min-height: 430px;
    }

    .context-detail-copy {
      padding: 42px;
    }
  }
</style>
