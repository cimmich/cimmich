<script lang="ts">
  import { Route } from '$lib/route';
  import type { CimmichPhotoDetailReviewItem } from '$lib/services/cimmich-asset-correction.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getParentPath } from '$lib/utils/tree-utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiFolderOpenOutline, mdiRotateLeft, mdiRotateRight, mdiUndoVariant } from '@mdi/js';

  interface Props {
    assets: Map<string, AssetResponseDto | null>;
    busyAssetId: string;
    error: string;
    hasMore: boolean;
    items: CimmichPhotoDetailReviewItem[];
    loaded: boolean;
    loading: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    onRotate: (item: CimmichPhotoDetailReviewItem, direction: 'left' | 'right') => void;
    onUndo: (item: CimmichPhotoDetailReviewItem) => void;
  }

  let {
    assets,
    busyAssetId,
    error,
    hasMore,
    items,
    loaded,
    loading,
    loadingMore,
    onLoadMore,
    onRotate,
    onUndo,
  }: Props = $props();

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
</script>

<section class="space-y-4" aria-labelledby="rotation-review-title">
  <div class="flex flex-wrap items-end justify-between gap-3 px-1">
    <div>
      <h2 id="rotation-review-title" class="text-xl font-semibold">Likely rotation candidates</h2>
      <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
        <strong>{number.format(items.length)} shown</strong>{hasMore ? ' so far' : ''}. Immich's visual index ranks
        these as resembling sideways or 90 degree rotated photos. Review the full photo before applying a correction.
      </p>
    </div>
    <p
      class="text-xs text-gray-500 dark:text-gray-400"
      title="Cimmich stores these corrections separately. Source files and Immich metadata are unchanged."
    >
      Reversible Cimmich correction
    </p>
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
  {:else if loaded && items.length === 0}
    <div
      class="rounded-3xl border border-gray-200 bg-white px-6 py-12 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <Icon icon={mdiRotateRight} size="38" class="mx-auto text-emerald-600" />
      <h3 class="mt-3 text-lg font-semibold">No likely rotation candidates</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Immich's visual index did not return any likely sideways photos in this scope.
      </p>
    </div>
  {:else}
    <div class="grid gap-3 lg:grid-cols-2">
      {#each items as item (item.assetId)}
        {@const asset = assets.get(item.sourceAssetId)}
        {@const folderPath = asset?.originalPath ? getParentPath(asset.originalPath) : ''}
        {@const hasCorrection = Boolean(item.rotationDecisionId)}
        <article
          class="flex min-w-0 flex-col overflow-hidden rounded-2xl border {hasCorrection
            ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/10'
            : 'border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg'} sm:flex-row"
        >
          <a
            class="relative block aspect-4/3 w-full shrink-0 overflow-hidden bg-black sm:w-44"
            href={Route.viewAsset({ id: item.sourceAssetId })}
            title={`Open ${item.filename}`}
          >
            <img
              class="size-full object-contain"
              src={getAssetMediaUrl({ id: item.sourceAssetId, size: AssetMediaSize.Preview })}
              alt={item.filename}
              loading="lazy"
              style={`transform: rotate(${item.rotationQuarterTurns * 90}deg)`}
            />
          </a>
          <div class="min-w-0 flex-1 space-y-3 p-4">
            <div>
              <div class="flex min-w-0 items-start justify-between gap-2">
                <a
                  class="min-w-0 truncate text-sm font-semibold hover:text-primary hover:underline"
                  href={Route.viewAsset({ id: item.sourceAssetId })}
                  title={item.filename}>{item.filename}</a
                >
                <span
                  class="shrink-0 rounded-full {hasCorrection
                    ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                    : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'} px-2 py-1 text-[0.68rem] font-semibold"
                  title={hasCorrection
                    ? 'A reversible display correction is active in Cimmich'
                    : 'Immich ranked this as visually similar to a sideways or 90 degree rotated photo'}
                >
                  {hasCorrection ? correctionLabel(item.rotationQuarterTurns) : 'Immich visual lead'}
                </span>
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {formatDate(asset?.exifInfo?.dateTimeOriginal ?? item.captureTime)} · {dimensions(asset)}
              </p>
            </div>

            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs/5">
              <dt class="font-semibold text-gray-700 dark:text-gray-200">Why flagged</dt>
              <dd class="text-gray-600 dark:text-gray-300">Visual similarity to sideways or 90° rotated photos</dd>
              <dt class="font-semibold text-gray-700 dark:text-gray-200">EXIF orientation</dt>
              <dd class="text-gray-600 dark:text-gray-300">{orientationLabel(asset?.exifInfo?.orientation)}</dd>
              <dt class="font-semibold text-gray-700 dark:text-gray-200">Correction</dt>
              <dd class="text-gray-600 dark:text-gray-300">{correctionLabel(item.rotationQuarterTurns)}</dd>
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
                class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
                type="button"
                disabled={Boolean(busyAssetId)}
                onclick={() => onRotate(item, 'left')}
                title="Apply a reversible 90 degree counterclockwise Cimmich correction"
              >
                <Icon icon={mdiRotateLeft} size="17" /> Rotate left
              </button>
              <button
                class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
                type="button"
                disabled={Boolean(busyAssetId)}
                onclick={() => onRotate(item, 'right')}
                title="Apply a reversible 90 degree clockwise Cimmich correction"
              >
                <Icon icon={mdiRotateRight} size="17" /> Rotate right
              </button>
              {#if item.rotationDecisionId}
                <button
                  class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
                  type="button"
                  disabled={Boolean(busyAssetId)}
                  onclick={() => onUndo(item)}
                  title="Undo the current Cimmich rotation correction"
                >
                  <Icon icon={mdiUndoVariant} size="17" /> Undo
                </button>
              {/if}
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

  {#if hasMore}
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
