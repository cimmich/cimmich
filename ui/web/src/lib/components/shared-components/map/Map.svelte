<script lang="ts" module>
  import mapboxRtlUrl from '@mapbox/mapbox-gl-rtl-text?url';
  import { addProtocol, getRTLTextPluginStatus, setRTLTextPlugin } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';

  let protocol = new Protocol();
  void addProtocol('pmtiles', protocol.tile);
  if (getRTLTextPluginStatus() === 'unavailable') {
    void setRTLTextPlugin(mapboxRtlUrl, true);
  }
</script>

<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import MapSettingsModal from '$lib/modals/MapSettingsModal.svelte';
  import { getCimmichVisibleMapAssetIds } from '$lib/services/cimmich.service';
  import { mapSettings } from '$lib/stores/preferences.store';
  import { getAssetMediaUrl, handlePromiseError } from '$lib/utils';
  import { getMapMarkers, type MapMarkerResponseDto } from '@immich/sdk';
  import { Icon, modalManager, Theme, themeManager } from '@immich/ui';
  import { mdiCog, mdiEarth, mdiMap, mdiMapMarker } from '@mdi/js';
  import type { Feature, GeoJsonProperties, Geometry, Point } from 'geojson';
  import { isEqual, omit } from 'lodash-es';
  import { DateTime, Duration } from 'luxon';
  import {
    GlobeControl,
    LngLat,
    LngLatBounds,
    Marker as MapLibreMarker,
    type GeoJSONSource,
    type LngLatLike,
    type Map,
    type MapMouseEvent,
  } from 'maplibre-gl';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    AttributionControl,
    Control,
    ControlButton,
    ControlGroup,
    GeoJSON,
    GeolocateControl,
    MapLibre,
    Marker as SvelteMarker,
    MarkerLayer,
    NavigationControl,
    Popup,
    ScaleControl,
  } from 'svelte-maplibre';
  import type { SelectionBBox } from './types';

  interface Props {
    mapMarkers?: MapMarkerResponseDto[];
    placeMarkers?: PlaceMarker[];
    draggablePlaceMarker?: PlaceMarker;
    placeAreas?: PlaceArea[];
    placeBrushPoints?: PlaceBrushPoint[];
    showSettings?: boolean;
    zoom?: number | undefined;
    center?: LngLatLike | undefined;
    hash?: boolean;
    simplified?: boolean;
    brushable?: boolean;
    clickable?: boolean;
    useLocationPin?: boolean;
    onOpenInMapView?: (() => Promise<void> | void) | undefined;
    onSelect?: (assetIds: string[]) => void;
    onPlaceSelect?: (placeMarker: PlaceMarker) => void;
    onPlaceMarkerDragEnd?: (point: { id: string; lat: number; lng: number }) => void;
    onClusterSelect?: (assetIds: string[], bbox: SelectionBBox) => void;
    onBrushPoint?: ({ lat, lng }: { lat: number; lng: number }) => void;
    onClickPoint?: ({ lat, lng }: { lat: number; lng: number }) => void;
    popup?: import('svelte').Snippet<[{ marker: MapMarkerResponseDto }]>;
    rounded?: boolean;
    showSimpleControls?: boolean;
    autoFitBounds?: boolean;
    showSatelliteControl?: boolean;
    placeMarkersDraggable?: boolean;
    showPlaceMarkerLabels?: boolean;
    visibilityFiltered?: boolean;
  }

  export type PlaceMarker = {
    id: string;
    lat: number;
    lon: number;
    name: string;
    parentName: string;
    radiusMeters?: number | null;
  };

  export type PlaceArea = {
    corridorMeters?: number | null;
    geometryKind?: 'area' | 'route' | 'unlocated';
    geometrySource?: 'derived' | 'gps_best_guess' | 'manual' | 'unlocated';
    id: string;
    name: string;
    parentName: string;
    points: Array<{ lat: number; lon: number }>;
  };

  export type PlaceBrushPoint = {
    id: string;
    lat: number;
    lon: number;
  };

  let {
    mapMarkers = $bindable(),
    placeMarkers = [],
    draggablePlaceMarker = undefined,
    placeAreas = [],
    placeBrushPoints = [],
    showSettings = true,
    zoom = undefined,
    center = $bindable(undefined),
    hash = false,
    simplified = false,
    brushable = false,
    clickable = false,
    useLocationPin = false,
    onOpenInMapView = undefined,
    onSelect = () => {},
    onPlaceSelect = () => {},
    onPlaceMarkerDragEnd = () => {},
    onClusterSelect,
    onBrushPoint = () => {},
    onClickPoint = () => {},
    popup,
    rounded = false,
    showSimpleControls = true,
    autoFitBounds = true,
    showSatelliteControl = false,
    placeMarkersDraggable = false,
    showPlaceMarkerLabels = true,
    visibilityFiltered = false,
  }: Props = $props();

  // Calculate initial bounds from every visible map projection once during initialization.
  const initialBounds = (() => {
    if (!autoFitBounds || center || zoom !== undefined) {
      return undefined;
    }

    const bounds = new LngLatBounds();
    for (const marker of mapMarkers ?? []) {
      bounds.extend([marker.lon, marker.lat]);
    }
    for (const marker of placeMarkers) {
      bounds.extend([marker.lon, marker.lat]);
    }
    for (const area of placeAreas) {
      for (const point of area.points) {
        bounds.extend([point.lon, point.lat]);
      }
    }
    return bounds.isEmpty() ? undefined : bounds;
  })();

  let map: Map | undefined = $state();
  let marker: MapLibreMarker | null = null;
  let abortController: AbortController;
  let isBrushDragging = false;
  let satelliteOverlayEnabled = $state(false);
  let mapBackgroundState = $state<'loading' | 'ready' | 'unavailable'>('loading');

  const satelliteSourceId = 'cimmich-satellite-imagery';
  const satelliteLayerId = 'cimmich-satellite-imagery-layer';
  const satelliteTileUrl =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const placeAreaSourceId = 'cimmich-place-areas';
  const placeAreaFillLayerId = 'cimmich-place-areas-fill';
  const placeAreaLineLayerId = 'cimmich-place-areas-line';
  const placeRouteSourceId = 'cimmich-place-routes';
  const placeRouteLayerId = 'cimmich-place-routes-line';
  const placeBrushSourceId = 'cimmich-place-brush';
  const placeBrushLayerId = 'cimmich-place-brush-points';

  const mapTheme = $derived($mapSettings.allowDarkMode ? themeManager.value : Theme.Light);
  const styleUrl = $derived(
    mapTheme === Theme.Dark ? serverConfigManager.value.mapDarkStyleUrl : serverConfigManager.value.mapLightStyleUrl,
  );

  export function addClipMapMarker(lng: number, lat: number) {
    if (map) {
      if (marker) {
        marker.remove();
      }

      center = { lng, lat };
      marker = new MapLibreMarker().setLngLat([lng, lat]).addTo(map);
    }
  }

  function handleAssetClick(assetId: string, map: Map | null) {
    if (!map) {
      return;
    }
    onSelect([assetId]);
  }

  async function handleClusterClick(clusterId: number, map: Map | null) {
    if (!map) {
      return;
    }

    const mapSource = map.getSource('geojson') as GeoJSONSource;
    const leaves = await mapSource.getClusterLeaves(clusterId, 10_000, 0);
    const ids = leaves.map((leaf) => leaf.properties?.id as string);

    if (onClusterSelect && ids.length > 1) {
      const [firstLongitude, firstLatitude] = (leaves[0].geometry as Point).coordinates;
      let west = firstLongitude;
      let south = firstLatitude;
      let east = firstLongitude;
      let north = firstLatitude;

      for (const leaf of leaves.slice(1)) {
        const [longitude, latitude] = (leaf.geometry as Point).coordinates;
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }

      const bbox = { west, south, east, north };
      onClusterSelect(ids, bbox);
      return;
    }

    onSelect(ids);
  }

  function handleMapClick(event: MapMouseEvent) {
    if (clickable && !brushable) {
      const { lng, lat } = event.lngLat;
      onClickPoint({ lng, lat });

      if (!placeMarkersDraggable && marker) {
        marker.remove();
      }

      if (!placeMarkersDraggable && map) {
        marker = new MapLibreMarker().setLngLat([lng, lat]).addTo(map);
      }
    }
  }

  const emitBrushPoint = (event: MapMouseEvent) => {
    const { lng, lat } = event.lngLat;
    onBrushPoint({ lng, lat });
  };

  function handleBrushMouseDown(event: MapMouseEvent) {
    if (!brushable) {
      return;
    }

    event.preventDefault();
    isBrushDragging = true;
    map?.dragPan.disable();
    emitBrushPoint(event);
  }

  function handleBrushMouseMove(event: MapMouseEvent) {
    if (!brushable || !isBrushDragging) {
      return;
    }

    emitBrushPoint(event);
  }

  function handleBrushMouseUp() {
    if (!isBrushDragging) {
      return;
    }

    isBrushDragging = false;
    map?.dragPan.enable();
  }

  const addSatelliteLayer = () => {
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    if (!map.getSource(satelliteSourceId)) {
      map.addSource(satelliteSourceId, {
        type: 'raster',
        tiles: [satelliteTileUrl],
        tileSize: 256,
        attribution: 'Tiles © Esri',
      });
    }

    if (!map.getLayer(satelliteLayerId)) {
      const firstSymbolLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
      map.addLayer(
        {
          id: satelliteLayerId,
          type: 'raster',
          source: satelliteSourceId,
          paint: { 'raster-opacity': 0.92 },
        },
        firstSymbolLayer,
      );
    }
  };

  const removeSatelliteLayer = () => {
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    if (map.getLayer(satelliteLayerId)) {
      map.removeLayer(satelliteLayerId);
    }
    if (map.getSource(satelliteSourceId)) {
      map.removeSource(satelliteSourceId);
    }
  };

  const syncSatelliteLayer = () => {
    if (satelliteOverlayEnabled) {
      addSatelliteLayer();
    } else {
      removeSatelliteLayer();
    }
  };

  const placeAreaFeatureCollection = () => ({
    type: 'FeatureCollection' as const,
    features: placeAreas
      .filter((area) => area.geometryKind !== 'route' && area.points.length >= 3)
      .map((area) => {
        const coordinates = area.points.map((point) => [point.lon, point.lat]);
        const first = coordinates[0];
        const last = coordinates.at(-1);
        const ring =
          last && first && (last[0] !== first[0] || last[1] !== first[1]) ? [...coordinates, first] : coordinates;
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [ring],
          },
          properties: {
            id: area.id,
            name: area.name,
            parentName: area.parentName,
          },
        };
      }),
  });

  const syncPlaceAreaLayers = () => {
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const data = placeAreaFeatureCollection();
    const source = map.getSource(placeAreaSourceId) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(placeAreaSourceId, { type: 'geojson', data });
    }

    if (!map.getLayer(placeAreaFillLayerId)) {
      map.addLayer({
        id: placeAreaFillLayerId,
        type: 'fill',
        source: placeAreaSourceId,
        paint: {
          'fill-color': '#ff6b35',
          'fill-opacity': 0.22,
        },
      });
    }

    if (!map.getLayer(placeAreaLineLayerId)) {
      map.addLayer({
        id: placeAreaLineLayerId,
        type: 'line',
        source: placeAreaSourceId,
        paint: {
          'line-color': '#ff6b35',
          'line-opacity': 0.9,
          'line-width': 3,
        },
      });
    }
  };

  const placeRouteFeatureCollection = () => ({
    type: 'FeatureCollection' as const,
    features: placeAreas
      .filter((area) => area.geometryKind === 'route' && area.points.length >= 2)
      .map((area) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: area.points.map((point) => [point.lon, point.lat]),
        },
        properties: {
          id: area.id,
          name: area.name,
          parentName: area.parentName,
        },
      })),
  });

  const syncPlaceRouteLayers = () => {
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const data = placeRouteFeatureCollection();
    const source = map.getSource(placeRouteSourceId) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(placeRouteSourceId, { type: 'geojson', data });
    }

    if (!map.getLayer(placeRouteLayerId)) {
      map.addLayer({
        id: placeRouteLayerId,
        type: 'line',
        source: placeRouteSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#14b8a6',
          'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 8],
        },
      });
    }
  };

  const placeBrushFeatureCollection = () => ({
    type: 'FeatureCollection' as const,
    features: placeBrushPoints.map((point) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [point.lon, point.lat],
      },
      properties: {
        id: point.id,
      },
    })),
  });

  const syncPlaceBrushLayers = () => {
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const data = placeBrushFeatureCollection();
    const source = map.getSource(placeBrushSourceId) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(placeBrushSourceId, { type: 'geojson', data });
    }

    if (!map.getLayer(placeBrushLayerId)) {
      map.addLayer({
        id: placeBrushLayerId,
        type: 'circle',
        source: placeBrushSourceId,
        paint: {
          'circle-color': '#ff6b35',
          'circle-opacity': 0.42,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 11, 18, 22],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.8,
          'circle-stroke-width': 1,
        },
      });
    }
  };

  type FeaturePoint = Feature<Point, { id: string; city: string | null; state: string | null; country: string | null }>;
  type PlaceFeaturePoint = Feature<
    Point,
    {
      id: string;
      name: string;
      parentName: string;
      radiusMeters: number | null;
    }
  >;

  const asFeature = (marker: MapMarkerResponseDto): FeaturePoint => {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [marker.lon, marker.lat] },
      properties: {
        id: marker.id,
        city: marker.city,
        state: marker.state,
        country: marker.country,
      },
    };
  };

  const asMarker = (feature: Feature<Geometry, GeoJsonProperties>): MapMarkerResponseDto => {
    const featurePoint = feature as FeaturePoint;
    const coords = LngLat.convert(featurePoint.geometry.coordinates as [number, number]);
    return {
      lat: coords.lat,
      lon: coords.lng,
      id: featurePoint.properties.id,
      city: featurePoint.properties.city,
      state: featurePoint.properties.state,
      country: featurePoint.properties.country,
    };
  };

  const asPlaceFeature = (placeMarker: PlaceMarker): PlaceFeaturePoint => {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [placeMarker.lon, placeMarker.lat] },
      properties: {
        id: placeMarker.id,
        name: placeMarker.name,
        parentName: placeMarker.parentName,
        radiusMeters: placeMarker.radiusMeters ?? null,
      },
    };
  };

  const asPlaceMarker = (feature: Feature<Geometry, GeoJsonProperties>): PlaceMarker => {
    const featurePoint = feature as PlaceFeaturePoint;
    const coords = LngLat.convert(featurePoint.geometry.coordinates as [number, number]);
    return {
      id: featurePoint.properties.id,
      lat: coords.lat,
      lon: coords.lng,
      name: featurePoint.properties.name,
      parentName: featurePoint.properties.parentName,
      radiusMeters: featurePoint.properties.radiusMeters,
    };
  };

  function getFileCreatedDates() {
    const { relativeDate, dateAfter, dateBefore } = $mapSettings;

    if (relativeDate) {
      const duration = Duration.fromISO(relativeDate);
      return {
        fileCreatedAfter: duration.isValid ? DateTime.now().minus(duration).toUTC().toISO() : undefined,
      };
    }

    return {
      fileCreatedAfter: dateAfter,
      fileCreatedBefore: dateBefore,
    };
  }

  async function loadMapMarkers() {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    const { includeArchived, onlyFavorites, withPartners, withSharedAlbums } = $mapSettings;
    const { fileCreatedAfter, fileCreatedBefore } = getFileCreatedDates();

    const markers = await getMapMarkers(
      {
        isArchived: includeArchived || undefined,
        isFavorite: onlyFavorites || undefined,
        fileCreatedAfter,
        fileCreatedBefore,
        withPartners: withPartners || undefined,
        withSharedAlbums: withSharedAlbums || undefined,
      },
      {
        signal: abortController.signal,
      },
    );
    if (!visibilityFiltered || markers.length === 0) {
      return markers;
    }
    const visibleAssetIds = await getCimmichVisibleMapAssetIds(markers.map((marker) => marker.id));
    return markers.filter((marker) => visibleAssetIds.has(marker.id));
  }

  const handleSettingsClick = async () => {
    const settings = await modalManager.show(MapSettingsModal);
    if (settings) {
      const shouldUpdate = !isEqual(omit(settings, 'allowDarkMode'), omit($mapSettings, 'allowDarkMode'));
      $mapSettings = settings;

      if (shouldUpdate) {
        mapMarkers = await loadMapMarkers();
      }
    }
  };

  afterNavigate(() => {
    if (map) {
      map.resize();

      if (globalThis.location.hash) {
        const hashChangeEvent = new HashChangeEvent('hashchange');
        globalThis.dispatchEvent(hashChangeEvent);
      }
    }
  });

  onMount(() => {
    if (!mapMarkers) {
      handlePromiseError(loadMapMarkers().then((markers) => (mapMarkers = markers)));
    }
    const reloadForVisibility = () => handlePromiseError(loadMapMarkers().then((markers) => (mapMarkers = markers)));
    if (visibilityFiltered) {
      globalThis.addEventListener('cimmich:visibility-changed', reloadForVisibility);
    }
    return () => globalThis.removeEventListener('cimmich:visibility-changed', reloadForVisibility);
  });

  onDestroy(() => {
    abortController?.abort();
  });

  $effect(() => {
    map?.setStyle(styleUrl, {
      transformStyle: (previousStyle, nextStyle) => {
        if (previousStyle) {
          // Preserves the custom map markers from the previous style when the theme is switched
          // Required until https://github.com/dimfeld/svelte-maplibre/issues/146 is fixed
          const customLayers = previousStyle.layers.filter((l) => l.type == 'fill' && l.source == 'geojson');
          const layers = nextStyle.layers.concat(customLayers);
          const sources = nextStyle.sources;

          for (const [key, value] of Object.entries(previousStyle.sources || {})) {
            if (key.startsWith('geojson')) {
              sources[key] = value;
            }
          }

          return {
            ...nextStyle,
            sources,
            layers,
          };
        }
        return nextStyle;
      },
    });
  });

  $effect(() => {
    void satelliteOverlayEnabled;
    void map;
    syncSatelliteLayer();
  });

  $effect(() => {
    void placeAreas;
    void map;
    syncPlaceAreaLayers();
    syncPlaceRouteLayers();
  });

  $effect(() => {
    void placeBrushPoints;
    void map;
    syncPlaceBrushLayers();
  });

  $effect(() => {
    if (!map) {
      return;
    }

    map.getCanvas().style.cursor = brushable ? 'crosshair' : '';
    if (!brushable) {
      handleBrushMouseUp();
    }
  });

  $effect(() => {
    if (!center || !zoom) {
      return;
    }

    untrack(() => map?.jumpTo({ center, zoom }));
  });

  const onAssetsDelete = async () => {
    mapMarkers = await loadMapMarkers();
  };

  const addMissingMapStyleImage = (event: { id: string }) => {
    if (event.id !== 'capital' || map?.hasImage(event.id)) {
      return;
    }
    const size = 12;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = (y * size + x) * 4;
        const inside = (x - 5.5) ** 2 + (y - 5.5) ** 2 <= 14;
        data[offset] = 71;
        data[offset + 1] = 85;
        data[offset + 2] = 105;
        data[offset + 3] = inside ? 220 : 0;
      }
    }
    map?.addImage(event.id, { data, height: size, width: size });
  };

  const handleMapBackgroundError = () => {
    if (!map?.isStyleLoaded()) {
      mapBackgroundState = 'unavailable';
    }
  };
</script>

<OnEvents {onAssetsDelete} />

<!--  We handle style loading ourselves so we set style blank here -->
<div class="relative size-full">
  <MapLibre
    {hash}
    style=""
    class="h-full {rounded ? 'rounded-2xl' : 'rounded-none'}"
    {zoom}
    {center}
    bounds={initialBounds}
    fitBoundsOptions={{ padding: 50, maxZoom: 15 }}
    attributionControl={false}
    diffStyleUpdates={true}
    onload={(event: Map) => {
      event.setMaxZoom(18);
      event.on('click', handleMapClick);
      event.on('mousedown', handleBrushMouseDown);
      event.on('mousemove', handleBrushMouseMove);
      event.on('mouseup', handleBrushMouseUp);
      event.on('mouseout', handleBrushMouseUp);
      event.on('style.load', () => (mapBackgroundState = 'ready'));
      event.on('style.load', syncSatelliteLayer);
      event.on('style.load', syncPlaceAreaLayers);
      event.on('style.load', syncPlaceRouteLayers);
      event.on('style.load', syncPlaceBrushLayers);
      event.on('styleimagemissing', addMissingMapStyleImage);
      event.on('error', handleMapBackgroundError);
      if (!simplified) {
        event.addControl(new GlobeControl(), 'top-left');
      }
    }}
    bind:map
  >
    {#snippet children({ map }: { map: Map })}
      {#if showSimpleControls}
        <NavigationControl position="top-left" showCompass={!simplified} />

        {#if !simplified}
          <GeolocateControl position="top-left" />
          <ScaleControl />
          <AttributionControl compact={false} />
        {/if}
      {/if}

      {#if showSettings}
        <Control>
          <ControlGroup>
            <ControlButton onclick={handleSettingsClick}>
              <Icon icon={mdiCog} size="100%" class="text-black/80" />
            </ControlButton>
          </ControlGroup>
        </Control>
      {/if}

      {#if showSatelliteControl}
        <Control>
          <ControlGroup>
            <ControlButton
              onclick={() => {
                satelliteOverlayEnabled = !satelliteOverlayEnabled;
                syncSatelliteLayer();
              }}
            >
              <Icon
                title="Satellite"
                icon={mdiEarth}
                size="100%"
                class={satelliteOverlayEnabled ? 'text-immich-primary' : 'text-black/80'}
              />
            </ControlButton>
          </ControlGroup>
        </Control>
      {/if}

      {#if onOpenInMapView && showSimpleControls}
        <Control position="top-right">
          <ControlGroup>
            <ControlButton onclick={() => onOpenInMapView()}>
              <Icon title={$t('open_in_map_view')} icon={mdiMap} size="100%" class="text-black/80" />
            </ControlButton>
          </ControlGroup>
        </Control>
      {/if}

      <GeoJSON
        data={{
          type: 'FeatureCollection',
          features: mapMarkers?.map((marker) => asFeature(marker)) ?? [],
        }}
        id="geojson"
        cluster={{ radius: 35, maxZoom: 17 }}
      >
        <MarkerLayer
          applyToClusters
          asButton
          onclick={(event) => handlePromiseError(handleClusterClick(event.feature.properties?.cluster_id, map))}
        >
          {#snippet children({ feature })}
            <div
              class="flex size-10 items-center justify-center rounded-full bg-immich-primary font-mono font-bold text-white opacity-90 shadow-lg transition-all duration-200 hover:bg-immich-dark-primary hover:text-immich-dark-bg"
            >
              {feature.properties?.point_count?.toLocaleString()}
            </div>
          {/snippet}
        </MarkerLayer>
        <MarkerLayer
          applyToClusters={false}
          asButton
          onclick={(event) => {
            if (!popup) {
              handleAssetClick(event.feature.properties?.id, map);
            }
          }}
        >
          {#snippet children({ feature }: { feature: Feature })}
            {#if useLocationPin}
              <Icon icon={mdiMapMarker} size="50px" class="translate-y-[calc(5px-50%)] text-primary" />
            {:else}
              <img
                src={getAssetMediaUrl({ id: feature.properties?.id })}
                class="size-15 rounded-full border-2 border-immich-primary bg-immich-primary object-cover shadow-lg transition-all duration-200 hover:scale-150 hover:border-immich-dark-primary"
                alt={feature.properties?.city && feature.properties.country
                  ? $t('map_marker_for_image', {
                      values: { city: feature.properties.city, country: feature.properties.country },
                    })
                  : $t('map_marker_with_image')}
              />
            {/if}
            {#if popup}
              <Popup offset={[0, -30]} openOn="click" closeOnClickOutside>
                {@render popup({ marker: asMarker(feature) })}
              </Popup>
            {/if}
          {/snippet}
        </MarkerLayer>
      </GeoJSON>

      {#if placeMarkers.length > 0}
        <GeoJSON
          data={{
            type: 'FeatureCollection',
            features: placeMarkers.map((placeMarker) => asPlaceFeature(placeMarker)),
          }}
          id="place-tags-geojson"
        >
          <MarkerLayer
            applyToClusters={false}
            asButton
            onclick={(event) => {
              onPlaceSelect(asPlaceMarker(event.feature));
            }}
          >
            {#snippet children({ feature }: { feature: Feature })}
              {#if showPlaceMarkerLabels}
                <div
                  class="flex translate-y-[-18px] items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-xs font-semibold text-gray-800 shadow-lg ring-2 ring-primary/60 backdrop-blur-sm transition-transform hover:scale-105 dark:bg-immich-dark-bg/95 dark:text-gray-100"
                >
                  <Icon icon={mdiMapMarker} size="18" class="text-primary" />
                  {#if feature.properties?.parentName}
                    <span class="max-w-40 truncate">{feature.properties.parentName}</span>
                  {/if}
                  {#if feature.properties?.parentName && feature.properties?.name}
                    <span class="text-gray-400">/</span>
                  {/if}
                  {#if feature.properties?.name}
                    <span class="max-w-32 truncate">{feature.properties.name}</span>
                  {/if}
                </div>
              {:else}
                <div
                  class="grid size-8 translate-y-[-16px] place-items-center rounded-full bg-white/95 text-primary shadow-lg ring-2 ring-primary/60 backdrop-blur-sm transition-transform hover:scale-110 dark:bg-immich-dark-bg/95"
                  title={feature.properties?.name}
                >
                  <Icon icon={mdiMapMarker} size="20" />
                </div>
              {/if}
            {/snippet}
          </MarkerLayer>
        </GeoJSON>
      {/if}

      {#if placeMarkersDraggable && draggablePlaceMarker}
        <SvelteMarker
          anchor="bottom"
          asButton
          class="cursor-grab active:cursor-grabbing"
          draggable
          lngLat={[draggablePlaceMarker.lon, draggablePlaceMarker.lat]}
          ondragend={(event) => {
            const [lng, lat] = event.lngLat;
            onPlaceMarkerDragEnd({ id: draggablePlaceMarker.id, lat, lng });
          }}
        >
          <div
            title="Drag to adjust this point"
            class="flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-xs font-semibold text-gray-800 shadow-lg ring-2 ring-primary/60 backdrop-blur-sm transition-transform hover:scale-105 dark:bg-immich-dark-bg/95 dark:text-gray-100"
          >
            <Icon icon={mdiMapMarker} size="18" class="text-primary" />
            <span class="max-w-32 truncate">{draggablePlaceMarker.name}</span>
          </div>
        </SvelteMarker>
      {/if}
    {/snippet}
  </MapLibre>
  {#if mapBackgroundState === 'unavailable'}
    <div
      class="pointer-events-none absolute inset-x-3 bottom-3 z-10 rounded-xl border border-amber-200/80 bg-white/92 px-4 py-3 text-sm text-amber-950 shadow-lg backdrop-blur-sm dark:border-amber-800 dark:bg-gray-950/92 dark:text-amber-100"
      role="status"
    >
      <p class="font-semibold">Map background unavailable offline</p>
      <p class="mt-0.5 text-xs/5 opacity-80">
        Your Place areas, points and admitted photo markers remain visible. Connect a tile source in Immich map settings
        when you want the street background.
      </p>
    </div>
  {/if}
</div>
