<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import {
    getCimmichContextEntities,
    getCimmichPhotoDetailReview,
    rotateCimmichAssets,
    setCimmichAssetCaptureTime,
    setCimmichAssetPlace,
    undoCimmichAssetCorrections,
    type CimmichContextEntity,
    type CimmichPhotoDetailReviewItem,
    type CimmichPhotoDetailReviewPage,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiCalendarAlertOutline,
    mdiMapMarkerAlertOutline,
    mdiRotateLeft,
    mdiRotateRight,
    mdiUndoVariant,
  } from '@mdi/js';

  type ReviewKind = CimmichPhotoDetailReviewPage['kind'];

  let kind = $state<ReviewKind>('orientation');
  let items = $state<CimmichPhotoDetailReviewItem[]>([]);
  let places = $state<CimmichContextEntity[]>([]);
  let loading = $state(true);
  let busyAssetId = $state('');
  let error = $state('');
  let captureDrafts = $state<Record<string, string>>({});
  let placeDrafts = $state<Record<string, string>>({});
  let loadGeneration = 0;

  const tabs: Array<{ id: ReviewKind; label: string }> = [
    { id: 'orientation', label: 'Orientation' },
    { id: 'dates', label: 'Dates' },
    { id: 'locations', label: 'Locations' },
  ];

  const reasonCopy = (item: CimmichPhotoDetailReviewItem) =>
    item.reason === 'likely_sideways_face'
      ? 'Face pose suggests this photo may be sideways.'
      : item.reason === 'future_capture_time'
        ? 'The current capture date is in the future.'
        : 'More than one current Place is attached to this photo.';

  const dateInputValue = (value: string | null) => {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  };

  const load = async () => {
    const generation = ++loadGeneration;
    loading = true;
    error = '';
    try {
      const [page, availablePlaces] = await Promise.all([
        getCimmichPhotoDetailReview(kind, 50),
        places.length > 0 ? Promise.resolve(places) : getCimmichContextEntities('places', { limit: 500 }),
      ]);
      if (generation !== loadGeneration) {
        return;
      }
      items = page.items;
      places = availablePlaces;
      captureDrafts = Object.fromEntries(page.items.map((item) => [item.assetId, dateInputValue(item.captureTime)]));
      placeDrafts = Object.fromEntries(page.items.map((item) => [item.assetId, item.location?.entityId ?? '']));
    } catch (error_) {
      if (generation === loadGeneration) {
        error = error_ instanceof Error ? error_.message : 'Photo details could not be loaded.';
      }
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  };

  $effect(() => {
    void kind;
    void load();
  });

  const rotate = async (item: CimmichPhotoDetailReviewItem, direction: 'left' | 'right') => {
    if (busyAssetId) {
      return;
    }
    busyAssetId = item.assetId;
    error = '';
    try {
      await rotateCimmichAssets([item.assetId], direction);
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The photo could not be rotated.';
    } finally {
      busyAssetId = '';
    }
  };

  const undoRotation = async (item: CimmichPhotoDetailReviewItem) => {
    if (!item.rotationDecisionId || busyAssetId) {
      return;
    }
    busyAssetId = item.assetId;
    error = '';
    try {
      await undoCimmichAssetCorrections([item.rotationDecisionId]);
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The rotation could not be undone.';
    } finally {
      busyAssetId = '';
    }
  };

  const saveDate = async (item: CimmichPhotoDetailReviewItem) => {
    const value = captureDrafts[item.assetId];
    if (!value || busyAssetId) {
      return;
    }
    busyAssetId = item.assetId;
    error = '';
    try {
      await setCimmichAssetCaptureTime(item.assetId, new Date(value).toISOString());
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The date correction could not be saved.';
    } finally {
      busyAssetId = '';
    }
  };

  const savePlace = async (item: CimmichPhotoDetailReviewItem) => {
    const placeEntityId = placeDrafts[item.assetId];
    if (!placeEntityId || busyAssetId) {
      return;
    }
    busyAssetId = item.assetId;
    error = '';
    try {
      await setCimmichAssetPlace(item.assetId, placeEntityId);
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The Place correction could not be saved.';
    } finally {
      busyAssetId = '';
    }
  };
</script>

<UserPageLayout title="Photo details review">
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:py-10">
    <a class="w-fit text-sm font-semibold text-primary hover:underline" href={Route.cimmichLibrary()}>← Library</a>

    <header class="rounded-3xl bg-gray-950 px-6 py-7 text-white sm:px-8">
      <p class="text-xs font-semibold tracking-[0.16em] text-white/55 uppercase">Archive quality</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight">Review what the system noticed.</h1>
      <p class="mt-3 max-w-3xl text-sm/6 text-white/65">
        Suggestions remain proposals. Your corrections are recorded separately in Cimmich; source media and Immich
        metadata are never changed.
      </p>
    </header>

    <div class="flex gap-2 overflow-x-auto" role="tablist" aria-label="Photo detail checks">
      {#each tabs as tab (tab.id)}
        <button
          class={[
            'min-h-10 rounded-full px-4 text-sm font-semibold',
            kind === tab.id
              ? 'bg-immich-primary text-white'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
          ]}
          type="button"
          role="tab"
          aria-selected={kind === tab.id}
          onclick={() => (kind = tab.id)}>{tab.label}</button
        >
      {/each}
    </div>

    {#if error}
      <p class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>
    {/if}

    {#if loading}
      <p class="py-16 text-center text-sm text-gray-500">Checking current archive evidence…</p>
    {:else if items.length === 0}
      <div class="rounded-2xl border border-gray-200 px-6 py-14 text-center dark:border-gray-700">
        <p class="font-semibold">Nothing currently needs attention here.</p>
        <p class="mt-1 text-sm text-gray-500">New deterministic findings will appear as the archive is processed.</p>
      </div>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {#each items as item (item.assetId)}
          <article
            class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <a
              class="relative block aspect-4/3 overflow-hidden bg-black"
              href={item.sourceAssetId ? Route.viewAsset({ id: item.sourceAssetId }) : undefined}
              aria-label={`Open ${item.filename}`}
            >
              <img
                class="size-full object-contain transition-transform"
                src={getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}
                alt={item.filename}
                style={`transform: rotate(${item.rotationQuarterTurns * 90}deg)`}
              />
            </a>
            <div class="grid gap-4 p-4">
              <div class="flex items-start gap-3">
                <span class="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-800">
                  <Icon
                    icon={kind === 'orientation'
                      ? mdiRotateRight
                      : kind === 'dates'
                        ? mdiCalendarAlertOutline
                        : mdiMapMarkerAlertOutline}
                    size="18"
                  />
                </span>
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold">{item.filename}</p>
                  <p class="mt-1 text-xs/5 text-gray-500">{reasonCopy(item)}</p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="rounded-lg border px-3 py-2 text-sm"
                  type="button"
                  disabled={Boolean(busyAssetId)}
                  onclick={() => void rotate(item, 'left')}><Icon icon={mdiRotateLeft} size="18" /> Rotate left</button
                >
                <button
                  class="rounded-lg border px-3 py-2 text-sm"
                  type="button"
                  disabled={Boolean(busyAssetId)}
                  onclick={() => void rotate(item, 'right')}
                  ><Icon icon={mdiRotateRight} size="18" /> Rotate right</button
                >
                {#if item.rotationDecisionId}
                  <button
                    class="rounded-lg border px-3 py-2 text-sm"
                    type="button"
                    disabled={Boolean(busyAssetId)}
                    onclick={() => void undoRotation(item)}><Icon icon={mdiUndoVariant} size="18" /> Undo</button
                  >
                {/if}
              </div>

              {#if kind === 'dates'}
                <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Capture date and time
                  <input
                    class="rounded-lg border bg-transparent px-3 py-2 text-sm font-normal"
                    type="datetime-local"
                    bind:value={captureDrafts[item.assetId]}
                  />
                </label>
                <button
                  class="rounded-lg bg-immich-primary px-3 py-2 text-sm font-semibold text-white"
                  type="button"
                  disabled={Boolean(busyAssetId) || !captureDrafts[item.assetId]}
                  onclick={() => void saveDate(item)}>Save date correction</button
                >
              {:else if kind === 'locations'}
                <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Effective Place
                  <select
                    class="rounded-lg border bg-transparent px-3 py-2 text-sm font-normal"
                    bind:value={placeDrafts[item.assetId]}
                  >
                    <option value="">Choose a Place…</option>
                    {#each places as place (place.entityId)}
                      <option value={place.entityId}>{place.displayName}</option>
                    {/each}
                  </select>
                </label>
                <button
                  class="rounded-lg bg-immich-primary px-3 py-2 text-sm font-semibold text-white"
                  type="button"
                  disabled={Boolean(busyAssetId) || !placeDrafts[item.assetId]}
                  onclick={() => void savePlace(item)}>Save Place correction</button
                >
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</UserPageLayout>
