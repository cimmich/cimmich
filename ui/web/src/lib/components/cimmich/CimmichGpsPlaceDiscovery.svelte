<script lang="ts">
  import {
    attachCimmichContextAssets,
    createCimmichContextCommandId,
    createCimmichGpsPlaceEntity,
    getCimmichVisibleMapAssetBindings,
    getCimmichVisibleMapAssetIds,
    type CimmichContextEntity,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getMapMarkers, type MapMarkerResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiCheckCircleOutline,
    mdiChevronDown,
    mdiImageMultipleOutline,
    mdiMapMarkerMultipleOutline,
    mdiMapMarkerPlusOutline,
    mdiRefresh,
  } from '@mdi/js';
  import {
    gpsDiscoveryRadii,
    gpsGroupGeometry,
    gpsGroupPackAssetIds,
    gpsGroupPackCount,
    groupGpsMarkers,
    GPS_REVIEW_PACK_SIZE,
    type GpsDiscoveryRadius,
    type GpsPlaceGroup,
  } from './gps-place-discovery';

  interface Props {
    entities: CimmichContextEntity[];
    onPlacesChanged?: () => Promise<void> | void;
  }

  let { entities, onPlacesChanged = () => {} }: Props = $props();
  let markers = $state<MapMarkerResponseDto[]>([]);
  let loaded = $state(false);
  let loading = $state(false);
  let loadError = $state('');
  let radius = $state<GpsDiscoveryRadius>(250);
  let includeSingles = $state(false);
  let draftNames = $state<Record<string, string>>({});
  let targetPlaceIds = $state<Record<string, string>>({});
  let busyGroupId = $state('');
  let groupNotices = $state<Record<string, { kind: 'error' | 'success'; message: string }>>({});
  let completedGroupIds = $state<string[]>([]);
  let groupPackIndexes = $state<Record<string, number>>({});
  let promotedPlaces = $state<Record<string, CimmichContextEntity>>({});
  let loadGeneration = 0;

  const groups = $derived(groupGpsMarkers(markers, entities, radius));
  const largeGroups = $derived(groups.filter((group) => group.assetIds.length > GPS_REVIEW_PACK_SIZE));
  const availablePlaces = $derived([
    ...entities,
    ...Object.values(promotedPlaces).filter(
      (promoted) => !entities.some((entity) => entity.entityId === promoted.entityId),
    ),
  ]);
  const singleCount = $derived(groups.filter((group) => group.assetIds.length === 1).length);
  const visibleGroups = $derived(
    groups
      .filter((group) => (includeSingles ? true : group.assetIds.length > 1))
      .filter((group) => !completedGroupIds.includes(group.groupId))
      .slice(0, 80),
  );
  const hiddenGroupCount = $derived(
    Math.max(
      0,
      groups.filter((group) => (includeSingles ? true : group.assetIds.length > 1)).length - visibleGroups.length,
    ),
  );

  const previewUrl = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });

  const formatDistance = (meters: number) =>
    meters < 1000 ? `${Math.max(1, Math.round(meters))} m` : `${(meters / 1000).toFixed(1)} km`;

  const setNotice = (groupId: string, kind: 'error' | 'success', message: string) => {
    groupNotices = { ...groupNotices, [groupId]: { kind, message } };
  };

  const loadGroups = async () => {
    const generation = ++loadGeneration;
    loading = true;
    loadError = '';
    try {
      const candidates = await getMapMarkers({});
      const visibleIds = await getCimmichVisibleMapAssetIds(candidates.map((marker) => marker.id));
      if (generation === loadGeneration) {
        markers = candidates.filter((marker) => visibleIds.has(marker.id));
        loaded = true;
      }
    } catch {
      if (generation === loadGeneration) {
        loadError = 'GPS groups could not be loaded. Nothing has changed.';
      }
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  };

  $effect(() => {
    if (!loaded && !loading) {
      void loadGroups();
    }
  });

  const resolveAssetIds = async (sourceAssetIds: string[]) => {
    const bindings = await getCimmichVisibleMapAssetBindings(sourceAssetIds);
    const assetIds = sourceAssetIds.flatMap((sourceAssetId) => {
      const assetId = bindings.get(sourceAssetId);
      return assetId ? [assetId] : [];
    });
    if (assetIds.length !== sourceAssetIds.length) {
      throw new Error(
        `${sourceAssetIds.length - assetIds.length} ${
          sourceAssetIds.length - assetIds.length === 1 ? 'photo is' : 'photos are'
        } no longer available in this viewing mode.`,
      );
    }
    return assetIds;
  };

  const groupPackIndex = (group: GpsPlaceGroup) =>
    Math.min(groupPackIndexes[group.groupId] ?? 0, gpsGroupPackCount(group.assetIds) - 1);

  const activePackAssetIds = (group: GpsPlaceGroup) => gpsGroupPackAssetIds(group.assetIds, groupPackIndex(group));

  const advanceGroupPack = (group: GpsPlaceGroup) => {
    const currentIndex = groupPackIndex(group);
    if (currentIndex + 1 >= gpsGroupPackCount(group.assetIds)) {
      completedGroupIds = [...completedGroupIds, group.groupId];
      return;
    }
    groupPackIndexes = { ...groupPackIndexes, [group.groupId]: currentIndex + 1 };
  };

  const attachGroup = async (assetIds: string[], entityId: string) => {
    let attachedCount = 0;
    for (let offset = 0; offset < assetIds.length; offset += 100) {
      const batch = assetIds.slice(offset, offset + 100);
      const result = await attachCimmichContextAssets(
        'places',
        entityId,
        createCimmichContextCommandId(`gps-attach-${offset / 100 + 1}`),
        batch.map((assetId) => ({ assetId, associationKind: 'captured_at' })),
      );
      attachedCount +=
        result.changedAssetIds || result.unchangedAssetIds ? (result.changedAssetIds?.length ?? 0) : batch.length;
    }
    return attachedCount;
  };

  const createPlace = async (group: GpsPlaceGroup) => {
    const displayName = (draftNames[group.groupId] ?? group.suggestedName).trim();
    if (!displayName) {
      setNotice(group.groupId, 'error', 'Give this Place a name first.');
      return;
    }
    busyGroupId = group.groupId;
    setNotice(group.groupId, 'success', 'Creating the Place…');
    let createdEntityId = '';
    const packIndex = groupPackIndex(group);
    const packCount = gpsGroupPackCount(group.assetIds);
    const packAssetIds = activePackAssetIds(group);
    try {
      setNotice(group.groupId, 'success', 'Checking the photos…');
      const assetIds = await resolveAssetIds(packAssetIds);
      setNotice(group.groupId, 'success', 'Creating the Place…');
      const geometry = gpsGroupGeometry(group);
      const result = await createCimmichGpsPlaceEntity({
        commandId: createCimmichContextCommandId('gps-create'),
        displayName,
        geometry,
        placeRole: 'geography',
        typeKind: geometry && 'north' in geometry ? 'area' : 'point',
      });
      createdEntityId = result.detail?.entity.entityId ?? '';
      if (!createdEntityId) {
        throw new Error('The Place was not returned after creation.');
      }
      promotedPlaces = { ...promotedPlaces, [group.groupId]: result.detail!.entity };
      targetPlaceIds = { ...targetPlaceIds, [group.groupId]: createdEntityId };
      const attachedCount = await attachGroup(assetIds, createdEntityId);
      advanceGroupPack(group);
      setNotice(
        group.groupId,
        'success',
        packCount > 1
          ? `${displayName} was created with pack ${packIndex + 1} of ${packCount} (${attachedCount.toLocaleString()} photos). Continue with pack ${packIndex + 2}.`
          : `${displayName} was created with ${attachedCount.toLocaleString()} ${
              attachedCount === 1 ? 'photo' : 'photos'
            }.`,
      );
      await onPlacesChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The GPS group could not be promoted.';
      setNotice(
        group.groupId,
        'error',
        createdEntityId
          ? `The Place was created, but its photos were not all added. Open the Place to retry. ${message}`
          : `${message} Nothing has changed.`,
      );
      if (createdEntityId) {
        await onPlacesChanged();
      }
    } finally {
      busyGroupId = '';
    }
  };

  const addToPlace = async (group: GpsPlaceGroup) => {
    const entityId = targetPlaceIds[group.groupId] ?? group.nearestPlace?.entity.entityId ?? '';
    const target = availablePlaces.find((entity) => entity.entityId === entityId);
    if (!target) {
      setNotice(group.groupId, 'error', 'Choose an existing Place first.');
      return;
    }
    busyGroupId = group.groupId;
    setNotice(group.groupId, 'success', `Adding photos to ${target.displayName}…`);
    const packIndex = groupPackIndex(group);
    const packCount = gpsGroupPackCount(group.assetIds);
    const packAssetIds = activePackAssetIds(group);
    try {
      const assetIds = await resolveAssetIds(packAssetIds);
      const attachedCount = await attachGroup(assetIds, target.entityId);
      advanceGroupPack(group);
      setNotice(
        group.groupId,
        'success',
        packCount > 1
          ? `Pack ${packIndex + 1} of ${packCount} (${attachedCount.toLocaleString()} photos) was added to ${target.displayName}.${
              packIndex + 1 < packCount ? ` Continue with pack ${packIndex + 2}.` : ''
            }`
          : `${attachedCount.toLocaleString()} ${attachedCount === 1 ? 'photo was' : 'photos were'} added to ${
              target.displayName
            }.`,
      );
      await onPlacesChanged();
    } catch (error) {
      setNotice(
        group.groupId,
        'error',
        error instanceof Error ? error.message : `The photos could not be added to ${target.displayName}.`,
      );
    } finally {
      busyGroupId = '';
    }
  };
</script>

<section class="gps-workspace" aria-labelledby="gps-discovery-title" data-testid="cimmich-gps-place-discovery">
  <div class="gps-intro">
    <span class="gps-intro-icon"><Icon icon={mdiMapMarkerMultipleOutline} size="24" /></span>
    <div class="min-w-0 flex-1">
      <h2 id="gps-discovery-title">Turn photo locations into Geography</h2>
      <p>
        Cimmich groups visible GPS-tagged photos nearby. Creating one records Geography automatically; you can change
        its role later in Edit.
      </p>
    </div>
    <button class="gps-refresh" type="button" disabled={loading} onclick={() => void loadGroups()}>
      <Icon icon={mdiRefresh} size="18" /> Refresh
    </button>
  </div>

  <div class="gps-controls" aria-label="GPS grouping distance">
    <span>Grouping distance</span>
    <div class="gps-radius-options">
      {#each gpsDiscoveryRadii as option (option.value)}
        <button
          class:gps-radius-active={radius === option.value}
          type="button"
          aria-pressed={radius === option.value}
          onclick={() => (radius = option.value)}
        >
          {option.label}
          <small>{option.value < 1000 ? `${option.value} m` : '1 km'}</small>
        </button>
      {/each}
    </div>
    {#if singleCount > 0}
      <label class="gps-singles">
        <input type="checkbox" bind:checked={includeSingles} />
        Include {singleCount.toLocaleString()} single {singleCount === 1 ? 'location' : 'locations'}
      </label>
    {/if}
  </div>

  {#if largeGroups.length > 0}
    <aside class="gps-pack-info" role="status">
      <Icon icon={mdiMapMarkerMultipleOutline} size="20" />
      <div>
        <h3>Large locations are split into review packs</h3>
        <p>
          Each location stays together. Cimmich handles at most {GPS_REVIEW_PACK_SIZE.toLocaleString()} photos per confirmed
          action, then advances to the next pack in the same Place.
        </p>
        <ul>
          {#each largeGroups.slice(0, 3) as group (group.groupId)}
            <li>
              <strong>{group.suggestedName}</strong>
              <span>
                {group.assetIds.length.toLocaleString()} photos · {gpsGroupPackCount(group.assetIds).toLocaleString()} packs
              </span>
            </li>
          {/each}
        </ul>
      </div>
    </aside>
  {/if}

  {#if loading && !loaded}
    <div class="gps-state">
      <span class="gps-spinner" aria-hidden="true"></span>
      <p>Grouping your visible GPS photos…</p>
    </div>
  {:else if loadError}
    <div class="gps-state gps-state--error" role="alert">
      <p>{loadError}</p>
      <button type="button" onclick={() => void loadGroups()}>Try again</button>
    </div>
  {:else if visibleGroups.length === 0}
    <div class="gps-state">
      <Icon icon={mdiMapMarkerMultipleOutline} size="34" />
      <h3>{markers.length === 0 ? 'No visible GPS photos yet' : 'No grouped locations at this distance'}</h3>
      <p>
        {markers.length === 0
          ? 'Photos with location data will appear here when they are visible in Cimmich.'
          : 'Try a broader grouping distance or include single locations.'}
      </p>
    </div>
  {:else}
    <div class="gps-summary">
      <p>
        <strong>{visibleGroups.length.toLocaleString()}</strong>
        {visibleGroups.length === 1 ? 'group ready to review' : 'groups ready to review'}
      </p>
      <p>Largest groups first. Up to 80 are shown at once.</p>
    </div>

    <div class="gps-group-grid">
      {#each visibleGroups as group (group.groupId)}
        {@const notice = groupNotices[group.groupId]}
        {@const packIndex = groupPackIndex(group)}
        {@const packCount = gpsGroupPackCount(group.assetIds)}
        {@const packAssetIds = activePackAssetIds(group)}
        {@const promotedPlace = promotedPlaces[group.groupId]}
        {@const selectedPlaceId = targetPlaceIds[group.groupId] ?? group.nearestPlace?.entity.entityId ?? ''}
        {@const continuingPlace =
          promotedPlace ?? (group.matchKind === 'name' ? group.nearestPlace?.entity : undefined)}
        <article class="gps-group-card">
          <div class="gps-preview" data-testid={`gps-group-preview-${group.groupId}`}>
            {#each packAssetIds.slice(0, 4) as sourceAssetId (sourceAssetId)}
              <img src={previewUrl(sourceAssetId)} alt="" loading="lazy" draggable="false" />
            {/each}
            <span class="gps-count"
              ><Icon icon={mdiImageMultipleOutline} size="15" />
              {packCount > 1
                ? `${packAssetIds.length.toLocaleString()} / ${group.assetIds.length.toLocaleString()}`
                : group.assetIds.length.toLocaleString()}</span
            >
          </div>

          <div class="gps-group-body">
            <div>
              <p class="gps-eyebrow">
                {packCount > 1
                  ? `Review pack ${packIndex + 1} of ${packCount} · ${packAssetIds.length.toLocaleString()} ${
                      packAssetIds.length === 1 ? 'photo' : 'photos'
                    }`
                  : `GPS group · ${group.radiusMeters < 10 ? 'same spot' : `${formatDistance(group.radiusMeters)} spread`}`}
              </p>
              <h3>{group.suggestedName}</h3>
              {#if group.nearestPlace}
                <p class="gps-match">
                  {group.matchKind === 'name' ? 'Matches' : 'Near'}
                  <strong>{group.nearestPlace.entity.displayName}</strong>
                  {#if group.matchKind !== 'name'}<span>{formatDistance(group.nearestPlace.distanceMeters)}</span>{/if}
                </p>
              {:else}
                <p class="gps-match">No nearby saved Place</p>
              {/if}
            </div>

            {#if continuingPlace}
              <div class="gps-pack-continuation">
                <Icon icon={mdiCheckCircleOutline} size="18" />
                <p>
                  Continuing in <strong>{continuingPlace.displayName}</strong>
                  {#if packCount > 1}<span>Next action adds only this review pack.</span>{/if}
                </p>
              </div>
            {:else}
              <div class="gps-create">
                <label for={`gps-name-${group.groupId}`}>New Geography name</label>
                <div>
                  <input
                    id={`gps-name-${group.groupId}`}
                    value={draftNames[group.groupId] ?? group.suggestedName}
                    oninput={(event) =>
                      (draftNames = {
                        ...draftNames,
                        [group.groupId]: event.currentTarget.value,
                      })}
                  />
                  <button type="button" disabled={Boolean(busyGroupId)} onclick={() => void createPlace(group)}>
                    <Icon icon={mdiMapMarkerPlusOutline} size="18" /> Create Geography
                  </button>
                </div>
              </div>
            {/if}

            {#if continuingPlace}
              <button
                class="gps-continue-button"
                type="button"
                disabled={Boolean(busyGroupId)}
                onclick={() => void addToPlace(group)}
              >
                Add photos to {continuingPlace.displayName}
              </button>
            {:else if availablePlaces.length > 0}
              <div class="gps-existing">
                <div class="gps-select">
                  <select
                    aria-label={`Existing Place for ${group.suggestedName}`}
                    value={selectedPlaceId}
                    onchange={(event) =>
                      (targetPlaceIds = {
                        ...targetPlaceIds,
                        [group.groupId]: event.currentTarget.value,
                      })}
                  >
                    <option value="">Choose an existing Place</option>
                    {#each availablePlaces as entity (entity.entityId)}
                      <option value={entity.entityId}>{entity.displayName}</option>
                    {/each}
                  </select>
                  <Icon icon={mdiChevronDown} size="18" />
                </div>
                <button
                  type="button"
                  disabled={Boolean(busyGroupId) || !selectedPlaceId}
                  onclick={() => void addToPlace(group)}
                >
                  Add photos
                </button>
              </div>
            {/if}

            {#if notice}
              <p class:gps-notice-error={notice.kind === 'error'} class="gps-notice" role="status">
                {#if notice.kind === 'success'}<Icon icon={mdiCheckCircleOutline} size="17" />{/if}
                {notice.message}
              </p>
            {/if}
          </div>
        </article>
      {/each}
    </div>

    {#if hiddenGroupCount > 0}
      <p class="gps-overflow-note">
        {hiddenGroupCount.toLocaleString()} more {hiddenGroupCount === 1 ? 'group is' : 'groups are'} available. Use a tighter
        distance or promote these first.
      </p>
    {/if}
  {/if}
</section>

<style>
  .gps-workspace {
    display: grid;
    gap: 1.25rem;
  }

  .gps-intro {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    border: 1px solid rgb(var(--immich-primary) / 0.2);
    border-radius: 1.25rem;
    background:
      radial-gradient(circle at top right, rgb(var(--immich-primary) / 0.12), transparent 42%),
      rgb(var(--immich-primary) / 0.04);
    padding: 1rem 1.1rem;
  }

  .gps-intro-icon {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    place-items: center;
    border-radius: 0.9rem;
    background: rgb(var(--immich-primary));
    color: white;
  }

  .gps-intro h2 {
    font-size: 1rem;
    font-weight: 700;
  }

  .gps-intro p {
    max-width: 48rem;
    margin-top: 0.15rem;
    color: rgb(75 85 99);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  :global(.dark) .gps-intro p {
    color: rgb(156 163 175);
  }

  .gps-refresh {
    display: inline-flex;
    min-height: 2.5rem;
    flex: none;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid rgb(var(--immich-primary) / 0.25);
    border-radius: 999px;
    background: white;
    padding: 0 0.9rem;
    color: rgb(var(--immich-primary));
    font-size: 0.8rem;
    font-weight: 700;
  }

  :global(.dark) .gps-refresh {
    background: rgb(17 24 39);
  }

  .gps-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    color: rgb(75 85 99);
    font-size: 0.78rem;
    font-weight: 650;
  }

  :global(.dark) .gps-controls {
    color: rgb(156 163 175);
  }

  .gps-radius-options {
    display: flex;
    border-radius: 999px;
    background: rgb(243 244 246);
    padding: 0.2rem;
  }

  :global(.dark) .gps-radius-options {
    background: rgb(31 41 55);
  }

  .gps-radius-options button {
    display: flex;
    min-height: 2.25rem;
    align-items: baseline;
    gap: 0.3rem;
    border-radius: 999px;
    padding: 0 0.75rem;
    color: inherit;
  }

  .gps-radius-options small {
    font-size: 0.65rem;
    font-weight: 500;
    opacity: 0.72;
  }

  .gps-radius-options .gps-radius-active {
    background: white;
    color: rgb(var(--immich-primary));
    box-shadow: 0 1px 3px rgb(15 23 42 / 0.12);
  }

  :global(.dark) .gps-radius-options .gps-radius-active {
    background: rgb(55 65 81);
  }

  .gps-singles {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
  }

  .gps-singles input {
    accent-color: rgb(var(--immich-primary));
  }

  .gps-summary {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: rgb(107 114 128);
    font-size: 0.78rem;
  }

  .gps-pack-info {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    border: 1px solid rgb(var(--immich-primary) / 0.2);
    border-radius: 1rem;
    background: rgb(var(--immich-primary) / 0.05);
    padding: 0.9rem 1rem;
    color: rgb(55 65 81);
  }

  :global(.dark) .gps-pack-info {
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(209 213 219);
  }

  .gps-pack-info > :global(svg) {
    flex: none;
    margin-top: 0.1rem;
    color: rgb(var(--immich-primary));
  }

  .gps-pack-info h3 {
    font-size: 0.82rem;
    font-weight: 750;
  }

  .gps-pack-info p {
    max-width: 58rem;
    margin-top: 0.2rem;
    font-size: 0.75rem;
    line-height: 1.45;
  }

  .gps-pack-info ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    margin-top: 0.55rem;
    font-size: 0.7rem;
  }

  .gps-pack-info li {
    display: inline-flex;
    gap: 0.35rem;
  }

  .gps-pack-info li span {
    opacity: 0.75;
  }

  .gps-summary strong {
    color: rgb(31 41 55);
  }

  :global(.dark) .gps-summary strong {
    color: rgb(229 231 235);
  }

  .gps-group-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
    gap: 1rem;
  }

  .gps-group-card {
    min-width: 0;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 1.25rem;
    background: white;
    box-shadow: 0 1px 3px rgb(15 23 42 / 0.05);
  }

  :global(.dark) .gps-group-card {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  .gps-preview {
    position: relative;
    display: grid;
    height: 10.5rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 2px;
    overflow: hidden;
    background: rgb(229 231 235);
  }

  .gps-preview img {
    width: 100%;
    height: 100%;
    min-height: 0;
    object-fit: cover;
  }

  .gps-preview img:only-of-type {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
  }

  .gps-preview img:nth-last-of-type(2):first-of-type,
  .gps-preview img:nth-last-of-type(2):first-of-type ~ img {
    grid-row: 1 / -1;
  }

  .gps-count {
    position: absolute;
    right: 0.7rem;
    bottom: 0.7rem;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: 999px;
    background: rgb(15 23 42 / 0.82);
    padding: 0.35rem 0.55rem;
    color: white;
    font-size: 0.72rem;
    font-weight: 700;
    backdrop-filter: blur(8px);
  }

  .gps-group-body {
    display: grid;
    gap: 1rem;
    padding: 1rem;
  }

  .gps-eyebrow {
    color: rgb(var(--immich-primary));
    font-size: 0.67rem;
    font-weight: 750;
    letter-spacing: 0.045em;
    text-transform: uppercase;
  }

  .gps-group-body h3 {
    margin-top: 0.25rem;
    font-size: 1rem;
    font-weight: 700;
  }

  .gps-match {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.35rem;
    color: rgb(107 114 128);
    font-size: 0.76rem;
  }

  .gps-match strong {
    overflow: hidden;
    color: rgb(55 65 81);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dark) .gps-match strong {
    color: rgb(209 213 219);
  }

  .gps-match span {
    margin-left: auto;
  }

  .gps-pack-continuation {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    border-radius: 0.8rem;
    background: rgb(var(--immich-primary) / 0.07);
    padding: 0.7rem 0.75rem;
    color: rgb(var(--immich-primary));
    font-size: 0.76rem;
  }

  .gps-pack-continuation > :global(svg) {
    flex: none;
  }

  .gps-pack-continuation span {
    display: block;
    margin-top: 0.1rem;
    color: rgb(107 114 128);
    font-size: 0.7rem;
  }

  .gps-create {
    display: grid;
    gap: 0.35rem;
  }

  .gps-create label {
    color: rgb(75 85 99);
    font-size: 0.72rem;
    font-weight: 650;
  }

  :global(.dark) .gps-create label {
    color: rgb(156 163 175);
  }

  .gps-create > div,
  .gps-existing {
    display: flex;
    min-width: 0;
    gap: 0.5rem;
  }

  .gps-create input,
  .gps-select {
    min-width: 0;
    flex: 1;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.8rem;
    background: transparent;
  }

  .gps-create input {
    height: 2.75rem;
    padding: 0 0.75rem;
    font-size: 0.82rem;
  }

  .gps-create input:focus,
  .gps-select:focus-within {
    border-color: rgb(var(--immich-primary));
    outline: 2px solid rgb(var(--immich-primary) / 0.18);
    outline-offset: 1px;
  }

  :global(.dark) .gps-create input,
  :global(.dark) .gps-select {
    border-color: rgb(55 65 81);
  }

  .gps-create button,
  .gps-existing > button,
  .gps-continue-button {
    display: inline-flex;
    min-height: 2.75rem;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border-radius: 0.8rem;
    padding: 0 0.8rem;
    font-size: 0.76rem;
    font-weight: 700;
  }

  .gps-create button {
    background: rgb(var(--immich-primary));
    color: white;
  }

  .gps-existing > button {
    border: 1px solid rgb(var(--immich-primary) / 0.35);
    color: rgb(var(--immich-primary));
  }

  .gps-continue-button {
    width: 100%;
    border: 1px solid rgb(var(--immich-primary) / 0.35);
    color: rgb(var(--immich-primary));
  }

  .gps-create button:disabled,
  .gps-existing > button:disabled,
  .gps-continue-button:disabled,
  .gps-refresh:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .gps-select {
    position: relative;
  }

  .gps-select select {
    width: 100%;
    height: 2.75rem;
    appearance: none;
    background: transparent;
    padding: 0 2rem 0 0.75rem;
    font-size: 0.78rem;
  }

  .gps-select :global(svg) {
    position: absolute;
    top: 50%;
    right: 0.6rem;
    pointer-events: none;
    transform: translateY(-50%);
  }

  .gps-notice {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    border-radius: 0.75rem;
    background: rgb(240 253 244);
    padding: 0.65rem 0.75rem;
    color: rgb(21 128 61);
    font-size: 0.74rem;
    line-height: 1.4;
  }

  .gps-notice-error {
    background: rgb(254 242 242);
    color: rgb(185 28 28);
  }

  :global(.dark) .gps-notice {
    background: rgb(20 83 45 / 0.25);
    color: rgb(134 239 172);
  }

  :global(.dark) .gps-notice-error {
    background: rgb(127 29 29 / 0.25);
    color: rgb(252 165 165);
  }

  .gps-state {
    display: grid;
    min-height: 18rem;
    place-items: center;
    align-content: center;
    gap: 0.6rem;
    border: 1px dashed rgb(209 213 219);
    border-radius: 1.25rem;
    color: rgb(107 114 128);
    text-align: center;
  }

  .gps-state h3 {
    color: rgb(31 41 55);
    font-weight: 700;
  }

  :global(.dark) .gps-state {
    border-color: rgb(55 65 81);
  }

  :global(.dark) .gps-state h3 {
    color: rgb(229 231 235);
  }

  .gps-state button {
    color: rgb(var(--immich-primary));
    font-weight: 700;
  }

  .gps-state--error {
    color: rgb(185 28 28);
  }

  .gps-spinner {
    width: 1.7rem;
    height: 1.7rem;
    animation: gps-spin 0.9s linear infinite;
    border: 3px solid rgb(var(--immich-primary) / 0.2);
    border-top-color: rgb(var(--immich-primary));
    border-radius: 999px;
  }

  .gps-overflow-note {
    color: rgb(107 114 128);
    font-size: 0.76rem;
    text-align: center;
  }

  @keyframes gps-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 639px) {
    .gps-intro {
      align-items: flex-start;
    }

    .gps-intro-icon {
      display: none;
    }

    .gps-refresh {
      min-width: 2.75rem;
      padding: 0 0.7rem;
      font-size: 0;
    }

    .gps-controls {
      align-items: flex-start;
      flex-direction: column;
    }

    .gps-singles {
      margin-left: 0;
    }

    .gps-summary p:last-child {
      display: none;
    }

    .gps-create > div,
    .gps-existing {
      align-items: stretch;
      flex-direction: column;
    }

    .gps-create button,
    .gps-existing > button,
    .gps-continue-button {
      width: 100%;
    }
  }
</style>
