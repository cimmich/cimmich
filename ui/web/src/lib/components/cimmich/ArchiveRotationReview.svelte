<script lang="ts">
  import { Route } from '$lib/route';
  import { countArchiveRotationBacklog, ROTATION_BACKLOG_LIMIT } from './archive-rotation-backlog';
  import type {
    CimmichAssetRotationChange,
    CimmichPhotoDetailReviewItem,
  } from '$lib/services/cimmich-asset-correction.service';
  import { getParentPath } from '$lib/utils/tree-utils';
  import type { AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiCheck, mdiContentSave, mdiFolderOpenOutline, mdiRotateRight } from '@mdi/js';
  import { onDestroy } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import CimmichReviewPhotoMedia from './CimmichReviewPhotoMedia.svelte';

  interface Props {
    assets: Map<string, AssetResponseDto | null>;
    busyAssetId: string;
    error: string;
    hasMore: boolean;
    items: CimmichPhotoDetailReviewItem[];
    loaded: boolean;
    loading: boolean;
    loadingMore: boolean;
    onConfirm: (changes: CimmichAssetRotationChange[]) => Promise<boolean>;
    onLoadMore: () => void;
  }

  let { assets, busyAssetId, error, hasMore, items, loaded, loading, loadingMore, onConfirm, onLoadMore }: Props =
    $props();

  let backlogCountError = $state('');
  let backlogCounting = $state(false);
  let backlogTotal = $state<number | null>(null);
  let reviewedTotal = $state<number | null>(null);
  let backlogCountGeneration = 0;
  let backlogCountStarted = false;
  const confirmedAssetIds = new SvelteSet<string>();
  const rotationDrafts = new SvelteMap<string, number>();

  const number = new Intl.NumberFormat();
  const formatDate = (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
      : 'Date unavailable';
  const dimensions = (asset: AssetResponseDto | null | undefined) =>
    asset?.width && asset.height
      ? `${number.format(asset.width)} × ${number.format(asset.height)}`
      : 'Size unavailable';
  const orientationLabel = (value: string | null | undefined) => {
    const orientation = Number(value);
    const labels = new Map<number, string>([
      [1, 'Normal'],
      [2, 'Mirrored horizontally'],
      [3, 'Rotated 180°'],
      [4, 'Mirrored vertically'],
      [5, 'Mirrored and rotated 90°'],
      [6, 'Rotated 90° clockwise'],
      [7, 'Mirrored and rotated 90° counterclockwise'],
      [8, 'Rotated 90° counterclockwise'],
      [90, 'Rotated 90° clockwise'],
      [-90, 'Rotated 90° counterclockwise'],
      [180, 'Rotated 180°'],
    ]);
    return labels.get(orientation) ?? (value ? `Recorded as ${value}` : 'Not recorded');
  };
  const correctionLabel = (quarterTurns: number) => {
    const normalized = ((quarterTurns % 4) + 4) % 4;
    return normalized === 1
      ? '90° clockwise'
      : normalized === 2
        ? '180°'
        : normalized === 3
          ? '90° counterclockwise'
          : 'No rotation';
  };
  const normalizedRotation = (quarterTurns: number) => ((Math.trunc(quarterTurns) % 4) + 4) % 4;
  const draftRotation = (item: CimmichPhotoDetailReviewItem) =>
    rotationDrafts.get(item.assetId) ?? normalizedRotation(item.rotationQuarterTurns);
  const hasDraft = (item: CimmichPhotoDetailReviewItem) => rotationDrafts.has(item.assetId);
  const pendingItems = $derived(items);

  const countBacklog = async () => {
    const generation = ++backlogCountGeneration;
    backlogCounting = true;
    backlogCountError = '';
    try {
      const result = await countArchiveRotationBacklog(() => generation === backlogCountGeneration);
      if (!result || generation !== backlogCountGeneration) {
        return;
      }
      const newlyConfirmed = result.unresolvedAssetIds.filter((assetId) => confirmedAssetIds.has(assetId)).length;
      backlogTotal = Math.max(0, result.backlogTotal - newlyConfirmed);
      reviewedTotal = result.reviewedTotal + newlyConfirmed;
    } catch (error) {
      if (generation === backlogCountGeneration) {
        backlogCountError = error instanceof Error ? error.message : 'Exact backlog count is unavailable';
      }
    } finally {
      if (generation === backlogCountGeneration) {
        backlogCounting = false;
      }
    }
  };

  $effect(() => {
    if (!loaded) {
      backlogCountStarted = false;
      backlogTotal = null;
      reviewedTotal = null;
      backlogCountGeneration += 1;
      return;
    }
    if (!loading && !backlogCountStarted) {
      backlogCountStarted = true;
      void countBacklog();
    }
  });

  onDestroy(() => {
    backlogCountGeneration += 1;
  });

  const rotateDraft = (item: CimmichPhotoDetailReviewItem, direction: 'left' | 'right') => {
    const next = normalizedRotation(draftRotation(item) + (direction === 'right' ? 1 : -1));
    if (next === normalizedRotation(item.rotationQuarterTurns)) {
      rotationDrafts.delete(item.assetId);
    } else {
      rotationDrafts.set(item.assetId, next);
    }
  };

  const confirmChanges = async (changes: CimmichAssetRotationChange[]) => {
    if (changes.length === 0 || !(await onConfirm(changes))) {
      return;
    }
    const newlyConfirmed = changes.filter(({ assetId }) => !confirmedAssetIds.has(assetId));
    for (const { assetId } of changes) {
      confirmedAssetIds.add(assetId);
      rotationDrafts.delete(assetId);
    }
    if (backlogTotal !== null) {
      backlogTotal = Math.max(0, backlogTotal - newlyConfirmed.length);
    }
    if (reviewedTotal !== null) {
      reviewedTotal += newlyConfirmed.length;
    }
  };

  const confirmAll = () =>
    confirmChanges(
      pendingItems.map((item) => ({
        assetId: item.assetId,
        quarterTurns: draftRotation(item),
      })),
    );
</script>

<section class="space-y-4" aria-labelledby="rotation-review-title">
  <div class="flex flex-wrap items-end justify-between gap-3 px-1">
    <div>
      <h2 id="rotation-review-title" class="text-xl font-semibold">Likely rotation candidates</h2>
      <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
        Immich's visual index ranks these as resembling sideways or 90 degree rotated photos. Review the full photo
        before applying a correction. This queue contains its {number.format(ROTATION_BACKLOG_LIMIT)} strongest matches.
      </p>
      <div class="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold tabular-nums">
        {#if items.length === 0 && ((loading && !loaded) || loadingMore)}
          <span class="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            Checking backlog…
          </span>
        {:else}
          <span class="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {number.format(items.length)} ready now
          </span>
          {#if backlogCounting || (backlogTotal === null && !backlogCountError)}
            <span
              class="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              title="The visible review cards stay usable while Cimmich counts the top 500 ranked candidates in the background"
            >
              Counting exact backlog…
            </span>
          {:else if backlogCountError}
            <button
              class="rounded-full bg-red-50 px-2.5 py-1 text-red-800 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200"
              type="button"
              onclick={() => void countBacklog()}
              title={backlogCountError}
            >
              Retry backlog count
            </button>
          {:else}
            <span
              class="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              title="Exact unresolved total among Immich's 500 strongest rotation matches"
            >
              {number.format(backlogTotal ?? 0)} in backlog
            </span>
            <span
              class="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              title="Candidates already saved or confirmed within Immich's 500 strongest rotation matches"
            >
              {number.format(reviewedTotal ?? 0)} reviewed
            </span>
          {/if}
        {/if}
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-end gap-2">
      <p
        class="text-xs text-gray-500 dark:text-gray-400"
        title="Cimmich stores these corrections separately. Source files and Immich metadata are unchanged."
      >
        Reversible Cimmich correction
      </p>
      <button
        class="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-white shadow-sm hover:bg-primary/90 disabled:cursor-default disabled:opacity-50"
        type="button"
        disabled={Boolean(busyAssetId) || pendingItems.length === 0}
        onclick={() => void confirmAll()}
        title="Save drafts and confirm every pending rotation candidate currently shown on this page"
      >
        <Icon icon={mdiContentSave} size="17" />
        {pendingItems.length > 0
          ? `Save / Confirm all (${pendingItems.length})`
          : loadingMore
            ? 'Loading next batch'
            : 'Review complete'}
      </button>
    </div>
  </div>

  {#if error}
    <div
      class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
      role="alert"
    >
      {error}
    </div>
  {/if}

  {#if loading && !loaded}
    <div
      class="grid min-h-52 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="text-center">
        <Icon icon={mdiRotateRight} size="34" class="mx-auto animate-pulse text-amber-500" />
        <p class="mt-3 text-sm font-semibold">Searching Immich's visual index…</p>
      </div>
    </div>
  {:else if loaded && items.length === 0 && loadingMore}
    <div
      class="grid min-h-40 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="text-center">
        <Icon icon={mdiRotateRight} size="30" class="mx-auto animate-pulse text-amber-500" />
        <p class="mt-2 text-sm font-semibold">Finding the next photos to review…</p>
      </div>
    </div>
  {:else if loaded && items.length === 0}
    <div
      class="rounded-3xl border border-gray-200 bg-white px-6 py-12 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <Icon icon={mdiRotateRight} size="38" class="mx-auto text-emerald-600" />
      <h3 class="mt-3 text-lg font-semibold">Rotation review complete</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        No unresolved likely rotation candidates remain in this scope.
      </p>
    </div>
  {:else}
    <div class="grid gap-3 lg:grid-cols-2">
      {#each items as item (item.assetId)}
        {@const asset = assets.get(item.sourceAssetId)}
        {@const folderPath = asset?.originalPath ? getParentPath(asset.originalPath) : ''}
        {@const rotation = draftRotation(item)}
        {@const dirty = hasDraft(item)}
        <article
          class="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white sm:flex-row dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        >
          <div
            class="w-full shrink-0 border-b border-gray-200 bg-gray-50 sm:w-48 sm:border-r sm:border-b-0 dark:border-immich-dark-gray dark:bg-gray-900/40"
          >
            <CimmichReviewPhotoMedia
              busy={Boolean(busyAssetId)}
              contextLabel={formatDate(asset?.exifInfo?.dateTimeOriginal ?? item.captureTime)}
              filename={item.filename}
              href={Route.viewAsset({ id: item.sourceAssetId })}
              image={{
                box: { h: 1, w: 1, x: 0, y: 0 },
                height: Math.max(1, asset?.height ?? 1),
                width: Math.max(1, asset?.width ?? 1),
              }}
              onRotate={(direction) => rotateDraft(item, direction)}
              rotationQuarterTurns={rotation}
              sourceAssetId={item.sourceAssetId}
              targetLabel="Review orientation"
            />
            <div class="px-3 py-2.5">
              <p class="text-[0.68rem] font-bold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                Why flagged
              </p>
              <p class="mt-0.5 text-xs/4 text-gray-700 dark:text-gray-200">
                Visually resembles a sideways or 90° rotated photo
              </p>
            </div>
          </div>
          <div class="min-w-0 flex-1 space-y-2.5 p-3.5">
            <div>
              <div class="flex min-w-0 items-start justify-between gap-2">
                <a
                  class="min-w-0 truncate text-sm font-semibold hover:text-primary hover:underline"
                  href={Route.viewAsset({ id: item.sourceAssetId })}
                  title={item.filename}>{item.filename}</a
                >
                <span
                  class="shrink-0 rounded-full {dirty
                    ? 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200'
                    : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'} px-2 py-1 text-[0.68rem] font-semibold"
                  title={dirty
                    ? 'This rotation is a draft until you save it'
                    : 'Immich ranked this as visually similar to a sideways or 90 degree rotated photo'}
                >
                  {dirty ? `Draft: ${correctionLabel(rotation)}` : 'Needs review'}
                </span>
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {formatDate(asset?.exifInfo?.dateTimeOriginal ?? item.captureTime)} · {dimensions(asset)}
              </p>
            </div>

            <dl class="grid grid-cols-2 gap-2 text-xs/4">
              <div class="rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-800/70">
                <dt class="font-semibold text-gray-500 dark:text-gray-400">EXIF orientation</dt>
                <dd class="mt-0.5 text-gray-800 dark:text-gray-100">
                  {orientationLabel(asset?.exifInfo?.orientation)}
                </dd>
              </div>
              <div class="rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-800/70">
                <dt class="font-semibold text-gray-500 dark:text-gray-400">
                  {dirty ? 'Draft rotation' : 'Correction'}
                </dt>
                <dd class="mt-0.5 text-gray-800 dark:text-gray-100">{correctionLabel(rotation)}</dd>
              </div>
            </dl>

            {#if folderPath}
              <div class="flex min-w-0 items-center gap-1.5 text-xs">
                <Icon icon={mdiFolderOpenOutline} size="16" class="shrink-0 text-primary" />
                <a
                  class="min-w-0 truncate font-semibold text-primary hover:underline"
                  href={Route.viewFolderAsset({ cimmich: 1, id: item.sourceAssetId, path: folderPath })}
                  title={`Open ${folderPath}`}>{folderPath}</a
                >
              </div>
            {:else if asset === null}
              <p class="text-xs text-gray-500 dark:text-gray-400">Source folder unavailable</p>
            {:else if asset === undefined}
              <p class="text-xs text-gray-500 dark:text-gray-400">Reading source details…</p>
            {/if}

            <div class="flex flex-wrap items-center gap-2">
              <button
                class="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-white hover:bg-primary/90 disabled:cursor-default disabled:opacity-50"
                type="button"
                disabled={Boolean(busyAssetId)}
                onclick={() => void confirmChanges([{ assetId: item.assetId, quarterTurns: rotation }])}
                title={dirty
                  ? 'Save this rotation as a reversible Cimmich correction'
                  : 'Confirm that this photo needs no rotation'}
              >
                <Icon icon={dirty ? mdiContentSave : mdiCheck} size="17" />
                {dirty ? 'Save' : 'Confirm'}
              </button>
              <a
                class="ml-auto inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-primary hover:underline"
                href={Route.viewAsset({ id: item.sourceAssetId })}
                title="Open the complete photo before deciding"
              >
                Open photo <Icon icon={mdiArrowRight} size="15" />
              </a>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}

  {#if hasMore && items.length > 0}
    <div class="flex justify-center">
      <button
        type="button"
        class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
        disabled={loadingMore}
        onclick={onLoadMore}
      >
        {loadingMore ? 'Loading candidates…' : 'Load 24 more candidates'}
      </button>
    </div>
  {/if}
</section>
