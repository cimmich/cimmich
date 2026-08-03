<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import type {
    CimmichContextEntity,
    CimmichContextFamily,
    CimmichContextTypeKind,
    CimmichPlaceRole,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, getAssetInfo } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import CimmichGpsPlaceDiscovery from './CimmichGpsPlaceDiscovery.svelte';
  import { normalizeGpsPlaceName } from './gps-place-discovery';
  import {
    mdiCalendarBlankOutline,
    mdiCameraOutline,
    mdiCellphone,
    mdiDiamondStone,
    mdiHomeOutline,
    mdiMapMarkerOutline,
    mdiMapMarkerMultipleOutline,
    mdiMapOutline,
    mdiImageMultipleOutline,
    mdiPackageVariantClosed,
    mdiPlus,
    mdiRepeat,
    mdiRoadVariant,
    mdiToolboxOutline,
    mdiWalk,
  } from '@mdi/js';
  import {
    contextEventYear,
    contextFamilyLabels,
    contextPlaceCountryLabel,
    contextPlaceHierarchy,
    contextPlaceLocationLabel,
    contextPlaceMapProjection,
    contextPlaceRoleLabel,
    contextTypeLabel,
    formatContextDatePrecision,
    formatImmichPlaceLocation,
    groupContextEventsByYear,
    humanizeContextKind,
    sortContextEntities,
    type ContextTypeFilter,
  } from './context-entity-presentation';
  import { eventLineage } from './event-folder-graph';

  interface Props {
    controlledPlaceGroupMode?: 'country' | 'duplicates' | 'none';
    controlledPlaceSortMode?: 'name' | 'photos-asc' | 'photos-desc';
    controlledPlaceView?: 'atlas' | 'geography' | 'gps' | 'locations';
    controlledTypeFilter?: ContextTypeFilter;
    entities: CimmichContextEntity[];
    // Every card and row is a real link, matching People and Pets. The named
    // routes existed already but were only ever handed to goto(), so a place was
    // addressable and yet could not be opened in a new tab or have its link
    // copied. The owner supplies the href because it depends on the current URL.
    entityHref: (entity: CimmichContextEntity) => string;
    geographyGroupHref?: (groupName: string) => string;
    family: CimmichContextFamily;
    includeNestedPlaces?: boolean;
    onAdd: (
      placeRole?: Exclude<CimmichPlaceRole, 'unclassified'>,
      parentEntityId?: string,
      geographyGroup?: string,
    ) => void;
    onEventStartFromPhotos?: () => void;
    onPlacesChanged?: () => Promise<void> | void;
    // Still needed for the atlas view, where a map marker is not an anchor.
    onOpen: (entity: CimmichContextEntity) => void;
  }

  let {
    controlledPlaceGroupMode,
    controlledPlaceSortMode,
    controlledTypeFilter,
    controlledPlaceView,
    entities,
    entityHref,
    geographyGroupHref = () => '',
    family,
    includeNestedPlaces = false,
    onAdd,
    onEventStartFromPhotos,
    onOpen,
    onPlacesChanged = () => {},
  }: Props = $props();
  let activeTypeFilter = $state<ContextTypeFilter>('all');
  let internalPlaceView = $state<'atlas' | 'geography' | 'gps' | 'locations'>('locations');
  let gpsWasOpened = $state(false);
  let internalPlaceGroupMode = $state<'country' | 'duplicates' | 'none'>('country');
  let internalPlaceSortMode = $state<'name' | 'photos-asc' | 'photos-desc'>('name');

  const effectiveTypeFilter = $derived(controlledTypeFilter ?? activeTypeFilter);
  const placeView = $derived(controlledPlaceView ?? internalPlaceView);
  const placeGroupMode = $derived(controlledPlaceGroupMode ?? internalPlaceGroupMode);
  const placeSortMode = $derived(controlledPlaceSortMode ?? internalPlaceSortMode);
  const directoryEntities = $derived(
    family === 'places' && !includeNestedPlaces
      ? entities.filter((entity) => entity.directoryVisibility !== 'nested_only')
      : entities,
  );
  const roleDirectoryEntities = $derived(
    family !== 'places' || !['locations', 'geography'].includes(placeView)
      ? directoryEntities
      : placeView === 'geography'
        ? directoryEntities.filter((entity) => entity.placeRole === 'geography')
        : directoryEntities.filter(
            (entity) => entity.placeRole === 'location' || entity.placeRole === 'unclassified' || !entity.placeRole,
          ),
  );
  const filteredEntities = $derived(
    sortContextEntities(
      effectiveTypeFilter === 'all'
        ? roleDirectoryEntities
        : roleDirectoryEntities.filter((entity) => entity.typeKind === effectiveTypeFilter),
      family,
    ),
  );
  const eventTimelineSections = $derived(family === 'events' ? groupContextEventsByYear(filteredEntities) : []);
  const placeProjection = $derived(contextPlaceMapProjection(entities));
  const mappedPlaceCount = $derived(placeProjection.markers.length + placeProjection.areas.length);

  const sortPlaceDirectoryItems = (items: CimmichContextEntity[]) =>
    [...items].sort((left, right) => {
      const leftCount = left.subtreeAssetCount ?? left.assetCount;
      const rightCount = right.subtreeAssetCount ?? right.assetCount;
      if (placeSortMode === 'photos-desc') {
        return rightCount - leftCount || left.displayName.localeCompare(right.displayName);
      }
      if (placeSortMode === 'photos-asc') {
        return leftCount - rightCount || left.displayName.localeCompare(right.displayName);
      }
      return left.displayName.localeCompare(right.displayName) || rightCount - leftCount;
    });

  const effectiveLocationGeographyId = (location: CimmichContextEntity | undefined) => {
    let current: CimmichContextEntity | undefined = location;
    const visited = new SvelteSet<string>();
    while (current && !visited.has(current.entityId)) {
      visited.add(current.entityId);
      if (current.placeRole === 'geography') {
        return current.entityId;
      }
      if (current.geographyEntityId) {
        return current.geographyEntityId;
      }
      current = current.parentEntityId
        ? entities.find((candidate) => candidate.entityId === current?.parentEntityId)
        : undefined;
    }
    return null;
  };

  const placeDirectoryGroup = (entity: CimmichContextEntity) => {
    if (!entity.placeRole || entity.placeRole === 'unclassified') {
      return (
        entities.find((candidate) => candidate.entityId === effectiveLocationGeographyId(entity))?.displayName ||
        'No geography set'
      );
    }
    if (entity.placeRole === 'location') {
      return (
        entities.find((candidate) => candidate.entityId === effectiveLocationGeographyId(entity))?.displayName ||
        'No geography set'
      );
    }
    return contextPlaceCountryLabel(entity);
  };

  const buildPlaceDirectorySections = (items: CimmichContextEntity[]) => {
    if (placeGroupMode === 'none') {
      return [{ duplicate: false, entities: sortPlaceDirectoryItems(items), key: 'all', label: '' }];
    }
    const groups: Array<[string, CimmichContextEntity[]]> = [];
    for (const entity of items) {
      const key =
        placeGroupMode === 'duplicates' ? normalizeGpsPlaceName(entity.displayName) : placeDirectoryGroup(entity);
      const existing = groups.find(([candidate]) => candidate === key);
      if (existing) {
        existing[1].push(entity);
      } else {
        groups.push([key, [entity]]);
      }
    }
    return groups
      .filter(([, group]) => placeGroupMode !== 'duplicates' || group.length > 1)
      .map(([key, group]) => ({
        duplicate: placeGroupMode === 'duplicates',
        entities: sortPlaceDirectoryItems(group),
        key,
        label: placeGroupMode === 'duplicates' ? group[0]!.displayName : key,
      }))
      .sort((left, right) => {
        if (left.label === 'No geography set') {
          return -1;
        }
        if (right.label === 'No geography set') {
          return 1;
        }
        return left.label.localeCompare(right.label);
      });
  };

  const placeDirectorySections = $derived(buildPlaceDirectorySections(filteredEntities));
  $effect(() => {
    const nextFamily = family;
    activeTypeFilter = 'all';
    internalPlaceView = nextFamily === 'places' ? 'locations' : 'atlas';
  });

  $effect(() => {
    if (placeView === 'gps') {
      gpsWasOpened = true;
    }
  });

  // Immich already knows each place's city/state/country from its own reverse
  // geocoding, so the card asks Immich rather than formatting coordinates. Only
  // places need it, only ones with a cover asset can answer, and the batch is
  // bounded the same way the Pets index bounds its preview fetches — a large
  // collection must not turn one render into hundreds of requests.
  let geocodedByEntityId = $state<Record<string, string>>({});

  $effect(() => {
    if (family !== 'places') {
      return;
    }
    const pending = filteredEntities
      .filter((entity) => entity.coverAssetId && geocodedByEntityId[entity.entityId] === undefined)
      .slice(0, 24);
    if (pending.length === 0) {
      return;
    }
    let current = true;
    void Promise.allSettled(
      pending.map(async (entity) => {
        const asset = await getAssetInfo({ id: entity.coverAssetId! });
        return {
          entityId: entity.entityId,
          label: formatImmichPlaceLocation(asset.exifInfo),
        };
      }),
    ).then((results) => {
      if (!current) {
        return;
      }
      const next = { ...geocodedByEntityId };
      for (const [index, result] of results.entries()) {
        // Cache the empty string on failure too, so a missing geocode does not
        // requeue the same asset on every render.
        next[pending[index]!.entityId] = result.status === 'fulfilled' ? result.value.label : '';
      }
      geocodedByEntityId = next;
    });
    return () => {
      current = false;
    };
  });

  const coverUrl = (entity: CimmichContextEntity, size = AssetMediaSize.Preview) =>
    entity.coverAssetId ? getAssetMediaUrl({ id: entity.coverAssetId, size }) : '';

  const eventPreviewIds = (entity: CimmichContextEntity) =>
    entity.previewAssetIds?.length ? entity.previewAssetIds : entity.coverAssetId ? [entity.coverAssetId] : [];

  const iconForType = (type: CimmichContextTypeKind) => {
    const icons: Partial<Record<CimmichContextTypeKind, string>> = {
      activity: mdiRepeat,
      area: mdiMapOutline,
      collectible: mdiDiamondStone,
      device: mdiCellphone,
      equipment: mdiToolboxOutline,
      event: mdiCalendarBlankOutline,
      life_period: mdiWalk,
      point: mdiMapMarkerOutline,
      property: mdiHomeOutline,
      route: mdiRoadVariant,
      trip: mdiRoadVariant,
    };
    return icons[type] ?? mdiPackageVariantClosed;
  };

  const eventCardClass = (entity: CimmichContextEntity) =>
    entity.typeKind === 'trip'
      ? 'context-event-card context-event-card--trip'
      : entity.typeKind === 'life_period'
        ? 'context-event-card context-event-card--period'
        : 'context-event-card';

  const openPlaceMarker = (marker: { id: string }) => {
    const entity = entities.find((candidate) => candidate.entityId === marker.id);
    if (entity) {
      onOpen(entity);
    }
  };

  const startEventFromPhotos = () => {
    if (onEventStartFromPhotos) {
      onEventStartFromPhotos();
      return;
    }
    onAdd();
  };
</script>

<section class="pt-7" aria-label={contextFamilyLabels[family]} data-testid={`cimmich-${family}-collection`}>
  {#if family === 'places' && gpsWasOpened}
    <div class:hidden={placeView !== 'gps'} aria-hidden={placeView !== 'gps'}>
      <CimmichGpsPlaceDiscovery {entities} {onPlacesChanged} />
    </div>
  {/if}

  {#if family === 'places' && placeView === 'atlas'}
    <div class="context-atlas-grid">
      <div class="context-atlas-map" data-testid="cimmich-places-atlas-map">
        {#if mappedPlaceCount > 0}
          {#await import('$lib/components/shared-components/map/Map.svelte')}
            <div class="context-map-placeholder">Loading your atlas…</div>
          {:then { default: Map }}
            <Map
              mapMarkers={[]}
              placeAreas={placeProjection.areas}
              placeMarkers={placeProjection.markers}
              onPlaceSelect={openPlaceMarker}
              rounded
              showSatelliteControl
              showSettings={false}
              showPlaceMarkerLabels={false}
            />
          {/await}
        {:else}
          <div class="context-map-placeholder">
            <span class="context-map-placeholder-icon"><Icon icon={mdiMapOutline} size="34" /></span>
            <p class="mt-4 font-semibold">Your atlas starts with a place</p>
            <p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
              Mapped Places will appear here. A Place can still be named and organised before its map location is known.
            </p>
          </div>
        {/if}
      </div>
    </div>
  {:else if family === 'places' && (placeView === 'locations' || placeView === 'geography')}
    {#if filteredEntities.length === 0}
      <div class="context-first-state">
        <span><Icon icon={mdiMapMarkerOutline} size="34" /></span>
        <h2>No {placeView === 'geography' ? 'geography' : 'locations'} yet</h2>
        <p>
          {placeView === 'geography'
            ? 'Add a country, region, town or other geographic area.'
            : 'Add a home, venue, room or other place with human meaning.'}
        </p>
        <button type="button" onclick={() => onAdd(placeView === 'geography' ? 'geography' : 'location')}>
          Add {placeView === 'geography' ? 'geography' : 'a location'}
        </button>
      </div>
    {:else}
      {#if placeGroupMode === 'duplicates' && placeDirectorySections.length === 0}
        <div class="context-place-directory-empty">
          <Icon icon={mdiMapMarkerMultipleOutline} size="28" />
          <p>No repeated Place names</p>
          <span>GPS will now continue a matching locality instead of creating another record.</span>
        </div>
      {:else}
        <div class="context-place-directory">
          {#each placeDirectorySections as section (section.key)}
            {@const countryRoot = section.entities.find(
              (entity) => entity.displayName.trim().toLocaleLowerCase() === section.label.trim().toLocaleLowerCase(),
            )}
            <section class="context-place-directory-section">
              {#if section.label}
                <header>
                  <div>
                    <h2>
                      {#if placeView === 'geography' && placeGroupMode === 'country'}
                        <a href={geographyGroupHref(section.label)}>{section.label}</a>
                      {:else}
                        {section.label}
                      {/if}
                    </h2>
                    <span>
                      {section.duplicate
                        ? `${section.entities.length} saved records need consolidation`
                        : `${section.entities.length} ${section.entities.length === 1 ? 'place' : 'places'}`}
                    </span>
                  </div>
                  <div class="context-place-section-actions">
                    {#if placeView === 'geography' && placeGroupMode === 'country'}
                      <button
                        type="button"
                        aria-label={`Add subdivision in ${section.label}`}
                        title={`Add subdivision in ${section.label}`}
                        onclick={() => onAdd('geography', countryRoot?.entityId ?? '', section.label)}
                      >
                        <Icon icon={mdiPlus} size="16" /> Add subdivision
                      </button>
                    {/if}
                    {#if section.duplicate}<strong>Repeated name</strong>{/if}
                  </div>
                </header>
              {/if}
              <div class="context-place-card-grid">
                {#each section.entities as entity (entity.entityId)}
                  {@const hierarchy = contextPlaceHierarchy(entity, entities)}
                  <a class="context-place-card" href={entityHref(entity)}>
                    <div class="context-cover context-cover--place">
                      {#if coverUrl(entity)}
                        <img
                          src={coverUrl(entity)}
                          alt=""
                          loading="lazy"
                          data-testid={`cimmich-place-cover-${entity.entityId}`}
                        />
                      {:else}
                        <Icon icon={entity.placeRole === 'geography' ? mdiMapOutline : mdiMapMarkerOutline} size="34" />
                      {/if}
                      <span class="context-cover-chip"
                        ><Icon
                          icon={entity.placeRole === 'geography' ? mdiMapOutline : mdiMapMarkerOutline}
                          size="14"
                        />
                        {contextPlaceRoleLabel(entity.placeRole)}</span
                      >
                    </div>
                    <!-- Shares the Things card grammar: the two families sit behind one
                 segmented control, so differing type scales and meta patterns
                 read as two designs in one section. The place-specific part is
                 the location line, because a place card that cannot say where
                 it is has not identified its subject. -->
                    <!-- grid-cols-[minmax(0,1fr)]: a grid item's automatic minimum size is
                 its MIN-CONTENT width, so a nowrap child (the truncated location
                 line) widens the whole track past the card and every sibling with
                 it, and `truncate` never gets to engage. An explicit minmax(0,1fr)
                 track caps the column at the container. Same family of defect as
                 the indefinite-height bug: an implicit min-size doing the sizing. -->
                    <div class="grid grid-cols-[minmax(0,1fr)] gap-2 p-4 text-left">
                      <h2 class="line-clamp-2 min-h-10 text-base/5 font-semibold">{entity.displayName}</h2>
                      {#if entity.description}<p class="line-clamp-2 text-sm/5 text-gray-600 dark:text-gray-300">
                          {entity.description}
                        </p>{/if}
                      <p class="flex min-w-0 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                        <Icon class="shrink-0" icon={mdiMapMarkerOutline} size="14" />
                        <span class="truncate"
                          >{contextPlaceLocationLabel(
                            entity,
                            hierarchy,
                            geocodedByEntityId[entity.entityId] ?? '',
                          )}</span
                        >
                      </p>
                      <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-gray-500">
                        <span class="whitespace-nowrap"
                          ><Icon class="inline" icon={mdiCameraOutline} size="14" />
                          {entity.subtreeAssetCount ?? entity.assetCount}
                          {(entity.subtreeAssetCount ?? entity.assetCount) === 1 ? 'photo' : 'photos'}</span
                        >
                        {#if (entity.childCount ?? 0) > 0}<span aria-hidden="true">·</span><span class="truncate"
                            >{entity.childCount} {entity.childCount === 1 ? 'subplace' : 'subplaces'}</span
                          >{/if}
                        {#if formatContextDatePrecision(entity)}<span aria-hidden="true">·</span><span class="truncate"
                            >{formatContextDatePrecision(entity)}</span
                          >{/if}
                      </div>
                    </div>
                  </a>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {/if}
    {/if}
  {:else if family === 'objects'}
    {#if filteredEntities.length === 0}
      <div class="context-first-state">
        <span><Icon icon={mdiPackageVariantClosed} size="34" /></span>
        <h2>
          {effectiveTypeFilter === 'all' ? 'Name the first thing worth finding again' : 'Nothing in this type yet'}
        </h2>
        <p>
          {effectiveTypeFilter === 'all'
            ? 'Vehicles, homes, devices, keepsakes and equipment become useful when they have their own name and history.'
            : 'Choose another type or add the particular thing you have in mind.'}
        </p>
        {#if effectiveTypeFilter === 'all'}<button type="button" onclick={() => onAdd()}>Add a thing</button>{/if}
      </div>
    {:else}
      <div class="context-thing-grid">
        {#each filteredEntities as entity (entity.entityId)}
          <a class="context-thing-card" href={entityHref(entity)}>
            <div class="context-cover context-cover--thing">
              {#if coverUrl(entity)}
                <img
                  class:context-cover-image--vehicle={entity.typeKind === 'vehicle'}
                  src={coverUrl(entity)}
                  alt=""
                  loading="lazy"
                />
              {:else}
                <Icon icon={iconForType(entity.typeKind)} size="38" />
              {/if}
              <span class="context-cover-chip"
                ><Icon icon={iconForType(entity.typeKind)} size="14" /> {humanizeContextKind(entity.typeKind)}</span
              >
            </div>
            <!-- Same minmax(0,1fr) track cap as the place card. Things carries no
                 location line, so the blowout is latent here rather than visible,
                 but the nowrap meta row can trigger it the moment a date precision
                 string runs long — and the two cards must stay one grammar. -->
            <div class="grid grid-cols-[minmax(0,1fr)] gap-2 p-4 text-left">
              <!-- line-clamp-2 rather than truncate, matching the place card: a
                   name is the card's subject and is worth two lines before it
                   gets cut. min-h keeps the grid's baselines aligned. -->
              <h2 class="line-clamp-2 min-h-10 text-base/5 font-semibold">{entity.displayName}</h2>
              {#if entity.description}<p class="line-clamp-2 text-sm/5 text-gray-600 dark:text-gray-300">
                  {entity.description}
                </p>{/if}
              <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-gray-500">
                <span class="whitespace-nowrap"
                  ><Icon class="inline" icon={mdiCameraOutline} size="14" />
                  {entity.assetCount}
                  {entity.assetCount === 1 ? 'photo' : 'photos'}</span
                >
                {#if formatContextDatePrecision(entity)}<span aria-hidden="true">·</span><span class="truncate"
                    >{formatContextDatePrecision(entity)}</span
                  >{/if}
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {:else}
    {#if filteredEntities.length === 0}
      {#if effectiveTypeFilter === 'all'}
        <div class="context-event-first-state">
          <div class="context-event-first-mark"><Icon icon={mdiCalendarBlankOutline} size="30" /></div>
          <p class="context-event-first-kicker">Your story over time</p>
          <h2>Bring the first memory together</h2>
          <p class="context-event-first-copy">
            Begin with photos you already have. You choose whether they belong to a trip, one occasion, a recurring
            activity or a longer chapter of life.
          </p>
          <div class="context-event-first-actions">
            <button class="context-event-first-primary" type="button" onclick={startEventFromPhotos}>
              <Icon icon={mdiImageMultipleOutline} size="19" /> Choose folders or photos
            </button>
            <button class="context-event-first-secondary" type="button" onclick={() => onAdd()}>
              Start without photos
            </button>
          </div>
          <div class="context-event-shapes" aria-label="Ways to organise a memory">
            <span>Trip or route</span><span>One occasion</span><span>Recurring activity</span><span>Life period</span>
          </div>
        </div>
      {:else}
        <div class="context-first-state">
          <span><Icon icon={mdiCalendarBlankOutline} size="34" /></span>
          <h2>Nothing in this part of your timeline yet</h2>
          <p>Choose another type or add the memory you want to organise.</p>
        </div>
      {/if}
    {:else}
      <div class="context-event-timeline">
        {#each eventTimelineSections as [year, yearEntities] (year)}
          <section class="context-event-year" aria-labelledby={`context-event-year-${year}`}>
            <header class="context-event-year-header">
              <h2 id={`context-event-year-${year}`}>{year}</h2>
              <span>{yearEntities.length} {yearEntities.length === 1 ? 'memory' : 'memories'}</span>
            </header>
            <div class="context-event-grid">
              {#each yearEntities as entity (entity.entityId)}
                {@const previewIds = eventPreviewIds(entity)}
                {@const visiblePreviewIds = entity.typeKind === 'trip' ? previewIds : previewIds.slice(0, 1)}
                {@const lineage = eventLineage(entity, entities)}
                <a class={eventCardClass(entity)} href={entityHref(entity)}>
                  <div
                    class:context-event-cover--contact={entity.typeKind === 'trip' && visiblePreviewIds.length > 1}
                    class="context-event-cover"
                    data-preview-count={visiblePreviewIds.length}
                    data-testid={entity.typeKind === 'trip' && visiblePreviewIds.length > 1
                      ? 'cimmich-event-contact-sheet'
                      : undefined}
                  >
                    {#if visiblePreviewIds.length > 0}
                      {#each visiblePreviewIds as previewAssetId (previewAssetId)}
                        <img
                          src={getAssetMediaUrl({ id: previewAssetId, size: AssetMediaSize.Preview })}
                          alt=""
                          loading="lazy"
                        />
                      {/each}
                    {:else}
                      <span><Icon icon={iconForType(entity.typeKind)} size="36" /></span>
                    {/if}
                    <span class="context-event-kind"
                      ><Icon icon={iconForType(entity.typeKind)} size="14" />
                      {contextTypeLabel(entity.typeKind)}</span
                    >
                  </div>
                  <div class="context-event-copy">
                    <p class="truncate text-lg font-semibold">{entity.displayName}</p>
                    {#if lineage.length > 1}
                      <p class="mt-1 truncate text-xs font-semibold text-primary">
                        Part of {lineage
                          .slice(0, -1)
                          .map(({ displayName }) => displayName)
                          .join(' › ')}
                      </p>
                    {/if}
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {formatContextDatePrecision(entity) ||
                        (contextEventYear(entity) === 'Undated' ? 'Date not set' : contextEventYear(entity))}
                    </p>
                    {#if entity.description}<p class="mt-3 line-clamp-2 text-sm/5 text-gray-600 dark:text-gray-300">
                        {entity.description}
                      </p>{/if}
                    <p class="mt-4 text-xs font-medium text-gray-500">
                      {entity.assetCount}
                      {entity.assetCount === 1 ? 'photo or video' : 'photos & videos'}{#if (entity.childCount ?? 0) > 0}
                        · {entity.childCount} {entity.childCount === 1 ? 'chapter' : 'chapters'}{/if}
                    </p>
                  </div>
                </a>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .context-filter-pill {
    display: inline-flex;
    min-height: 40px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 999px;
    padding: 0 14px;
    color: rgb(75 85 99);
    font-size: 0.8125rem;
    font-weight: 650;
    transition: 140ms ease;
  }

  :global(.dark) .context-filter-pill {
    color: rgb(209 213 219);
  }

  .context-filter-pill {
    border: 1px solid rgb(209 213 219);
  }

  :global(.dark) .context-filter-pill {
    border-color: rgb(55 65 81);
  }

  .context-filter-pill:hover,
  .context-filter-pill--active {
    border-color: rgb(var(--immich-primary));
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-atlas-grid {
    display: grid;
    min-height: 560px;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 28px;
    background: white;
    box-shadow: 0 18px 50px rgb(15 23 42 / 0.08);
  }

  :global(.dark) .context-atlas-grid {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  :global(.dark) .context-atlas-map,
  :global(.dark) .context-map-placeholder {
    background: rgb(17 24 39);
    color: rgb(243 244 246);
  }

  .context-atlas-map {
    min-height: 440px;
    overflow: hidden;
    background: rgb(243 244 246);
  }

  .context-map-placeholder {
    display: flex;
    height: 100%;
    min-height: 440px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    text-align: center;
  }

  .context-map-placeholder-icon {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    border-radius: 22px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-place-card-grid,
  .context-thing-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .context-place-directory {
    display: grid;
    gap: 2.25rem;
  }

  .context-place-directory-section {
    display: grid;
    gap: 0.9rem;
  }

  .context-place-directory-section > header {
    display: flex;
    min-width: 0;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
  }

  .context-place-directory-section > header h2 {
    overflow: hidden;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.015em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-place-directory-section > header h2 a:hover,
  .context-place-directory-section > header h2 a:focus-visible {
    color: rgb(var(--immich-primary));
    outline: none;
    text-decoration: underline;
    text-underline-offset: 0.2rem;
  }

  .context-place-directory-section > header span {
    display: block;
    margin-top: 0.15rem;
    color: rgb(107 114 128);
    font-size: 0.72rem;
  }

  .context-place-section-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.55rem;
  }

  .context-place-section-actions button {
    display: inline-flex;
    min-height: 2.25rem;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.75rem;
    padding: 0 0.75rem;
    color: rgb(75 85 99);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .context-place-section-actions button:hover,
  .context-place-section-actions button:focus-visible {
    border-color: rgb(var(--immich-primary));
    color: rgb(var(--immich-primary));
    outline: none;
  }

  :global(.dark) .context-place-section-actions button {
    border-color: rgb(55 65 81);
    color: rgb(209 213 219);
  }

  .context-place-section-actions strong {
    flex: none;
    border-radius: 999px;
    background: rgb(254 243 199);
    padding: 0.35rem 0.65rem;
    color: rgb(146 64 14);
    font-size: 0.68rem;
  }

  :global(.dark) .context-place-section-actions strong {
    background: rgb(120 53 15 / 0.35);
    color: rgb(253 230 138);
  }

  .context-place-directory-empty {
    display: grid;
    min-height: 17rem;
    place-items: center;
    align-content: center;
    gap: 0.45rem;
    border: 1px dashed rgb(209 213 219);
    border-radius: 1.25rem;
    color: rgb(107 114 128);
    text-align: center;
  }

  .context-place-directory-empty p {
    color: inherit;
    font-size: 0.95rem;
    font-weight: 700;
  }

  .context-place-directory-empty span {
    max-width: 28rem;
    font-size: 0.78rem;
  }

  :global(.dark) .context-place-directory-empty {
    border-color: rgb(55 65 81);
  }

  .context-first-state {
    display: flex;
    min-height: 52vh;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 44px 20px;
    text-align: center;
  }

  .context-first-state > span {
    display: grid;
    width: 68px;
    height: 68px;
    place-items: center;
    border-radius: 24px;
    background: rgb(var(--immich-primary) / 0.1);
    color: rgb(var(--immich-primary));
  }

  .context-first-state h2 {
    margin-top: 20px;
    font-size: 1.35rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .context-first-state p {
    max-width: 480px;
    margin-top: 8px;
    color: rgb(107 114 128);
    font-size: 0.875rem;
    line-height: 1.55;
  }

  .context-first-state button {
    min-height: 44px;
    margin-top: 22px;
    border-radius: 999px;
    background: rgb(var(--immich-primary));
    padding: 0 18px;
    color: white;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .context-event-first-state {
    display: flex;
    min-height: 56vh;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 52px 20px;
    text-align: center;
  }

  .context-event-first-mark {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    border-radius: 22px;
    background: rgb(var(--immich-primary) / 0.11);
    color: rgb(var(--immich-primary));
  }

  .context-event-first-kicker {
    margin-top: 18px;
    color: rgb(var(--immich-primary));
    font-size: 0.72rem;
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .context-event-first-state h2 {
    max-width: 640px;
    margin-top: 7px;
    font-size: clamp(1.6rem, 3vw, 2.3rem);
    font-weight: 720;
    letter-spacing: -0.035em;
  }

  .context-event-first-copy {
    max-width: 570px;
    margin-top: 12px;
    color: rgb(107 114 128);
    font-size: 0.92rem;
    line-height: 1.6;
  }

  .context-event-first-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin-top: 24px;
  }

  .context-event-first-actions button {
    display: inline-flex;
    min-height: 46px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0 18px;
    font-size: 0.86rem;
    font-weight: 720;
  }

  .context-event-first-primary {
    gap: 8px;
    background: rgb(var(--immich-primary));
    color: white;
    box-shadow: 0 10px 24px rgb(var(--immich-primary) / 0.2);
  }

  .context-event-first-secondary {
    border: 1px solid rgb(209 213 219);
    color: rgb(75 85 99);
  }

  :global(.dark) .context-event-first-secondary {
    border-color: rgb(55 65 81);
    color: rgb(209 213 219);
  }

  .context-event-first-primary:hover,
  .context-event-first-primary:focus-visible,
  .context-event-first-secondary:hover,
  .context-event-first-secondary:focus-visible {
    transform: translateY(-1px);
    outline: 2px solid rgb(var(--immich-primary) / 0.45);
    outline-offset: 2px;
  }

  .context-event-shapes {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 7px;
    margin-top: 30px;
  }

  .context-event-shapes span {
    border-radius: 999px;
    background: rgb(243 244 246);
    padding: 7px 11px;
    color: rgb(75 85 99);
    font-size: 0.72rem;
    font-weight: 650;
  }

  :global(.dark) .context-event-shapes span {
    background: rgb(31 41 55);
    color: rgb(209 213 219);
  }

  /* These are anchors, not buttons, so the button defaults they used to inherit
     (block-level box, inherited colour, no underline, left-aligned text) have to
     be stated. Everything else about the card is unchanged. */
  .context-place-card,
  .context-thing-card {
    display: block;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 22px;
    background: white;
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
    color: inherit;
    text-align: left;
    text-decoration: none;
    transition: 160ms ease;
  }

  .context-place-row,
  .context-event-card {
    color: inherit;
    text-decoration: none;
  }

  :global(.dark) .context-place-card,
  :global(.dark) .context-thing-card {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  .context-place-card:hover,
  .context-place-card:focus-visible,
  .context-thing-card:hover,
  .context-thing-card:focus-visible,
  .context-event-card:hover,
  .context-event-card:focus-visible {
    transform: translateY(-2px);
    border-color: rgb(var(--immich-primary) / 0.45);
    box-shadow: 0 14px 34px rgb(15 23 42 / 0.12);
    outline: none;
  }

  .context-cover {
    position: relative;
    display: grid;
    overflow: hidden;
    place-items: center;
    background: linear-gradient(145deg, rgb(var(--immich-primary) / 0.14), rgb(148 163 184 / 0.18));
    color: rgb(var(--immich-primary));
  }

  /* The cover box takes its height from `aspect-ratio`, not an explicit
     `height`, so a percentage height on the image has nothing definite to
     resolve against and the image falls back to its intrinsic size. It then
     overflowed the box and was clipped from the bottom — 84px off a place
     cover, 103px off a thing cover — which also made `object-position`
     inert, because an image already at its natural aspect has nothing to
     shift. Pinning to the box's edges gives a definite size in both axes, so
     `object-fit`/`object-position` govern the crop as intended. */
  .context-cover img,
  .context-event-cover img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .context-cover--place {
    aspect-ratio: 16 / 10;
  }

  .context-cover--thing {
    aspect-ratio: 4 / 3;
  }

  .context-cover-image--vehicle {
    object-position: center 68%;
  }

  .context-cover-chip,
  .context-event-kind {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 5px;
    border: 1px solid rgb(255 255 255 / 0.24);
    border-radius: 999px;
    background: rgb(15 23 42 / 0.76);
    padding: 0 9px;
    color: white;
    font-size: 0.6875rem;
    font-weight: 700;
    backdrop-filter: blur(8px);
  }

  .context-event-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }

  .context-event-timeline {
    display: grid;
    gap: 34px;
  }

  .context-event-year {
    display: grid;
    gap: 13px;
  }

  .context-event-year-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    border-bottom: 1px solid rgb(229 231 235);
    padding-bottom: 9px;
  }

  :global(.dark) .context-event-year-header {
    border-color: rgb(31 41 55);
  }

  .context-event-year-header h2 {
    font-size: 1.08rem;
    font-weight: 720;
    letter-spacing: -0.02em;
  }

  .context-event-year-header span {
    color: rgb(107 114 128);
    font-size: 0.72rem;
  }

  .context-event-card {
    display: flex;
    overflow: hidden;
    min-width: 0;
    flex-direction: column;
    border: 1px solid rgb(229 231 235);
    border-radius: 12px;
    background: white;
    text-align: left;
    transition: 160ms ease;
  }

  :global(.dark) .context-event-card {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }

  .context-event-cover {
    position: relative;
    display: grid;
    min-height: 0;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    place-items: center;
    background: linear-gradient(145deg, rgb(var(--immich-primary) / 0.12), rgb(124 58 237 / 0.12));
    color: rgb(var(--immich-primary));
  }

  .context-event-cover--contact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    gap: 2px;
    background: rgb(17 24 39);
  }

  .context-event-cover--contact img {
    position: static;
    inset: auto;
    min-width: 0;
    min-height: 0;
  }

  .context-event-cover--contact[data-preview-count='2'] {
    grid-template-rows: minmax(0, 1fr);
  }

  .context-event-cover--contact[data-preview-count='3'] {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.6fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  .context-event-cover--contact[data-preview-count='3'] img:first-child {
    grid-row: 1 / 3;
  }

  .context-event-copy {
    min-width: 0;
    padding: 16px;
  }

  .context-event-card--period {
    border-color: rgb(var(--immich-primary) / 0.3);
  }

  @media (min-width: 700px) {
    .context-atlas-grid {
      height: clamp(520px, calc(100dvh - 190px), 760px);
      min-height: 0;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }

    .context-atlas-map {
      height: 100%;
      min-height: 0;
    }

    .context-place-card-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .context-thing-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .context-event-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .context-event-card--trip {
      grid-column: span 2;
    }

    .context-event-card--trip .context-event-cover {
      aspect-ratio: 16 / 9;
    }
  }

  @media (min-width: 1180px) {
    .context-place-card-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .context-thing-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .context-event-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (max-width: 520px) {
    .context-place-card-grid,
    .context-thing-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .context-atlas-grid {
      min-height: 0;
    }

    .context-atlas-map,
    .context-map-placeholder {
      min-height: 360px;
    }

    .context-event-cover {
      aspect-ratio: 4 / 3;
    }

    .context-event-first-state {
      min-height: 50vh;
      padding-inline: 8px;
    }

    .context-event-first-actions {
      width: 100%;
    }

    .context-event-first-actions button {
      width: 100%;
    }
  }
</style>
