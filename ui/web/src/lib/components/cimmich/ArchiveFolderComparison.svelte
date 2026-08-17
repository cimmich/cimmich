<script lang="ts">
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getParentPath } from '$lib/utils/tree-utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiCheckCircleOutline,
    mdiFolderMultipleImage,
    mdiImageSearchOutline,
    mdiShieldSearch,
  } from '@mdi/js';
  import type { ArchiveFolderOverlap } from './archive-folder-comparison';

  interface Props {
    error: string;
    folderPath: string;
    loaded: boolean;
    loading: boolean;
    onVerify?: (folderPath: string) => void;
    overlap: ArchiveFolderOverlap;
    verifiedFolders?: string[];
    verifyingFolder?: string;
  }

  let {
    error,
    folderPath,
    loaded,
    loading,
    onVerify,
    overlap,
    verifiedFolders = [],
    verifyingFolder = '',
  }: Props = $props();
  let selectedFolder = $state('');
  let visibleGroupCount = $state(8);
  let visibleSharedFolderCount = $state(6);
  let visibleUniqueCount = $state(24);
  let activeSharedFolder = $derived(selectedFolder || overlap.sharedFolders[0]?.folderPath || '');
  let selectedSummary = $derived(
    overlap.sharedFolders.find((shared) => shared.folderPath === activeSharedFolder) ?? null,
  );
  let filteredGroups = $derived(
    overlap.groups.filter(
      (group) =>
        !activeSharedFolder ||
        group.elsewhere.some(
          (asset) => Boolean(asset.originalPath) && getParentPath(asset.originalPath) === activeSharedFolder,
        ),
    ),
  );
  let visibleGroups = $derived(filteredGroups.slice(0, visibleGroupCount));
  let visibleSharedFolders = $derived(overlap.sharedFolders.slice(0, visibleSharedFolderCount));
  let maxSharedAssetCount = $derived(overlap.sharedFolders[0]?.sharedAssetCount ?? 1);
  let sharedPercent = $derived(
    overlap.folderAssetCount > 0 ? (overlap.sharedAssetCount / overlap.folderAssetCount) * 100 : 0,
  );
  let uniquePercent = $derived(
    overlap.folderAssetCount > 0 ? (overlap.uniqueAssets.length / overlap.folderAssetCount) * 100 : 0,
  );
  let internalPercent = $derived(Math.max(0, 100 - sharedPercent - uniquePercent));

  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
  const folderLabel = (path: string) => path.split('/').findLast(Boolean) || path;
  const formatBytes = (value: number | null | undefined) => {
    if (!value || !Number.isFinite(value)) {
      return 'Not recorded';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** power;
    return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
  };
  const formatDateTime = (value: string | null | undefined) => {
    if (!value) {
      return 'Not recorded';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Not recorded'
      : new Intl.DateTimeFormat(undefined, {
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          month: 'short',
          year: 'numeric',
        }).format(date);
  };
  const dimensions = (asset: AssetResponseDto) =>
    asset.width && asset.height
      ? `${asset.width.toLocaleString()} × ${asset.height.toLocaleString()} pixels`
      : 'Not recorded';
  const photoLocation = (asset: AssetResponseDto) => {
    const place = [asset.exifInfo?.city, asset.exifInfo?.state, asset.exifInfo?.country].filter(Boolean).join(', ');
    const coordinates =
      asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null
        ? `${asset.exifInfo.latitude.toFixed(5)}, ${asset.exifInfo.longitude.toFixed(5)}`
        : '';
    return [place, coordinates].filter(Boolean).join(' · ') || 'Not recorded';
  };
  const camera = (asset: AssetResponseDto) => {
    const body = [asset.exifInfo?.make, asset.exifInfo?.model].filter(Boolean).join(' ');
    const lens = asset.exifInfo?.lensModel ? `Lens: ${asset.exifInfo.lensModel}` : '';
    return [body, lens].filter(Boolean).join(' · ') || 'Not recorded';
  };
  const people = (asset: AssetResponseDto) =>
    asset.people
      ?.map((person) => person.name.trim())
      .filter(Boolean)
      .sort()
      .join(', ') || 'None recorded';
  const tags = (asset: AssetResponseDto) =>
    asset.tags
      ?.map((tag) => tag.value.trim())
      .filter(Boolean)
      .sort()
      .join(', ') || 'None recorded';
  const orientation = (asset: AssetResponseDto) =>
    asset.exifInfo?.orientation == null ? 'Not recorded' : String(asset.exifInfo.orientation);
  const scalar = (value: unknown) => JSON.stringify(value ?? null);
  const pairedAsset = (asset: AssetResponseDto, candidates: AssetResponseDto[], index: number) =>
    candidates.find((candidate) => candidate.originalFileName === asset.originalFileName) ?? candidates[index];
  const factsFor = (asset: AssetResponseDto, comparison: AssetResponseDto | undefined) => [
    {
      changed: Boolean(comparison && asset.originalFileName !== comparison.originalFileName),
      label: 'File name',
      value: asset.originalFileName || 'Not recorded',
    },
    {
      changed: Boolean(comparison && asset.originalPath !== comparison.originalPath),
      label: 'File location',
      value: asset.originalPath || 'Not recorded',
    },
    {
      changed: Boolean(comparison && asset.exifInfo?.fileSizeInByte !== comparison.exifInfo?.fileSizeInByte),
      label: 'File size',
      value: formatBytes(asset.exifInfo?.fileSizeInByte),
    },
    {
      changed: Boolean(comparison && (asset.width !== comparison.width || asset.height !== comparison.height)),
      label: 'Resolution',
      value: dimensions(asset),
    },
    {
      changed: Boolean(
        comparison &&
        (asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime) !==
          (comparison.exifInfo?.dateTimeOriginal ?? comparison.localDateTime),
      ),
      label: 'Captured',
      value: formatDateTime(asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime),
    },
    {
      changed: Boolean(comparison && asset.fileModifiedAt !== comparison.fileModifiedAt),
      label: 'File modified',
      value: formatDateTime(asset.fileModifiedAt),
    },
    {
      changed: Boolean(
        comparison &&
        scalar([
          asset.exifInfo?.city,
          asset.exifInfo?.state,
          asset.exifInfo?.country,
          asset.exifInfo?.latitude,
          asset.exifInfo?.longitude,
        ]) !==
          scalar([
            comparison.exifInfo?.city,
            comparison.exifInfo?.state,
            comparison.exifInfo?.country,
            comparison.exifInfo?.latitude,
            comparison.exifInfo?.longitude,
          ]),
      ),
      label: 'Photo location',
      value: photoLocation(asset),
    },
    {
      changed: Boolean(
        comparison &&
        scalar([asset.exifInfo?.make, asset.exifInfo?.model, asset.exifInfo?.lensModel]) !==
          scalar([comparison.exifInfo?.make, comparison.exifInfo?.model, comparison.exifInfo?.lensModel]),
      ),
      label: 'Camera',
      value: camera(asset),
    },
  ];
  const moreFactsFor = (asset: AssetResponseDto, comparison: AssetResponseDto | undefined) => [
    {
      changed: Boolean(comparison && asset.originalMimeType !== comparison.originalMimeType),
      label: 'File type',
      value: asset.originalMimeType || 'Not recorded',
    },
    {
      changed: Boolean(comparison && asset.exifInfo?.orientation !== comparison.exifInfo?.orientation),
      label: 'Rotation',
      value: orientation(asset),
    },
    {
      changed: Boolean(comparison && asset.exifInfo?.description !== comparison.exifInfo?.description),
      label: 'Description',
      value: asset.exifInfo?.description || 'Not recorded',
    },
    {
      changed: Boolean(comparison && asset.exifInfo?.rating !== comparison.exifInfo?.rating),
      label: 'Rating',
      value: asset.exifInfo?.rating == null ? 'Not recorded' : `${asset.exifInfo.rating} stars`,
    },
    {
      changed: Boolean(comparison && people(asset) !== people(comparison)),
      label: 'Immich People',
      value: people(asset),
    },
    {
      changed: Boolean(comparison && tags(asset) !== tags(comparison)),
      label: 'Immich Tags',
      value: tags(asset),
    },
    {
      changed: Boolean(comparison && asset.isFavorite !== comparison.isFavorite),
      label: 'Favourite',
      value: asset.isFavorite ? 'Yes' : 'No',
    },
    {
      changed: Boolean(comparison && asset.isArchived !== comparison.isArchived),
      label: 'Archive status',
      value: asset.isArchived ? 'Archived' : 'Not archived',
    },
    {
      changed: Boolean(comparison && asset.visibility !== comparison.visibility),
      label: 'Visibility',
      value: asset.visibility || 'Not recorded',
    },
  ];
  const statusLabel = (classification: string) =>
    classification === 'verified_exact'
      ? 'Exact bytes'
      : classification === 'verified_variant'
        ? 'Different file'
        : 'Possible duplicate';
  const isVerified = (path: string) => verifiedFolders.includes(path);
  const chooseFolder = (path: string) => {
    selectedFolder = path;
    visibleGroupCount = 8;
    if (!isVerified(path)) {
      onVerify?.(path);
    }
  };
</script>

{#snippet assetEvidence(
  asset: AssetResponseDto,
  comparison: AssetResponseDto | undefined,
  accent: 'violet' | 'emerald',
)}
  <div class="overflow-hidden rounded-2xl border border-gray-200 dark:border-immich-dark-gray">
    <div class="grid grid-cols-[7rem_minmax(0,1fr)] border-b border-gray-100 dark:border-immich-dark-gray">
      <a href={Route.viewAsset({ id: asset.id })} aria-label={`Open ${asset.originalFileName}`}>
        <img class="aspect-square size-28 object-cover" src={thumbnail(asset.id)} alt="" loading="lazy" />
      </a>
      <div class="min-w-0 self-center p-4">
        <p
          class="text-xs font-semibold tracking-wide uppercase {accent === 'violet'
            ? 'text-violet-700 dark:text-violet-300'
            : 'text-emerald-700 dark:text-emerald-300'}"
        >
          File
        </p>
        <a
          class="mt-1 block text-sm font-semibold wrap-break-word hover:text-primary hover:underline"
          href={Route.viewAsset({ id: asset.id })}>{asset.originalFileName}</a
        >
        <a
          class="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
          href={Route.viewAsset({ id: asset.id })}>Open photo</a
        >
      </div>
    </div>
    <dl class="divide-y divide-gray-100 text-xs dark:divide-immich-dark-gray">
      {#each factsFor(asset, comparison) as fact (fact.label)}
        <div
          class="grid gap-1 px-4 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] {fact.changed
            ? 'bg-amber-50/80 dark:bg-amber-950/20'
            : ''}"
        >
          <dt class="flex items-center gap-1.5 font-semibold text-gray-600 dark:text-gray-300">
            {fact.label}
            {#if fact.changed}
              <span
                class="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-950 dark:bg-amber-900 dark:text-amber-100"
                >Different</span
              >
            {/if}
          </dt>
          <dd class="wrap-break-word text-gray-900 dark:text-gray-100" title={fact.value}>{fact.value}</dd>
        </div>
      {/each}
    </dl>
    <details class="border-t border-gray-100 text-xs dark:border-immich-dark-gray">
      <summary class="cursor-pointer px-4 py-3 font-semibold text-primary">More Immich metadata</summary>
      <dl
        class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-immich-dark-gray dark:border-immich-dark-gray"
      >
        {#each moreFactsFor(asset, comparison) as fact (fact.label)}
          <div
            class="grid gap-1 px-4 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] {fact.changed
              ? 'bg-amber-50/80 dark:bg-amber-950/20'
              : ''}"
          >
            <dt class="flex items-center gap-1.5 font-semibold text-gray-600 dark:text-gray-300">
              {fact.label}
              {#if fact.changed}
                <span
                  class="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-950 dark:bg-amber-900 dark:text-amber-100"
                  >Different</span
                >
              {/if}
            </dt>
            <dd class="wrap-break-word text-gray-900 dark:text-gray-100" title={fact.value}>{fact.value}</dd>
          </div>
        {/each}
      </dl>
    </details>
  </div>
{/snippet}

<section class="space-y-5" aria-labelledby="folder-comparison-title">
  <header class="min-w-0 px-1">
    <p class="text-xs font-semibold tracking-[0.14em] text-violet-700 uppercase dark:text-violet-300">Checked folder</p>
    <h2 id="folder-comparison-title" class="mt-1 truncate text-2xl font-semibold" title={folderPath}>
      {folderLabel(folderPath)}
    </h2>
    <p class="mt-1 truncate text-sm text-gray-500 dark:text-gray-400" title={folderPath}>{folderPath}</p>
  </header>

  {#if error}
    <div
      class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      {error}
    </div>
  {/if}

  {#if loading && !loaded}
    <div
      class="grid min-h-52 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="text-center">
        <Icon icon={mdiImageSearchOutline} size="34" class="mx-auto animate-pulse text-violet-500" />
        <p class="mt-3 text-sm font-semibold">Checking every photo in this folder…</p>
      </div>
    </div>
  {:else if loaded}
    <div
      class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="flex flex-wrap items-center justify-between gap-4 p-5">
        <div class="flex items-center gap-3">
          <span
            class="grid size-11 place-items-center rounded-2xl bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
          >
            <Icon icon={mdiFolderMultipleImage} size="23" />
          </span>
          <div>
            <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">Folder result</p>
            <p class="text-2xl font-semibold">{overlap.folderAssetCount.toLocaleString()} files checked</p>
          </div>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Matches reach {overlap.sharedFolders.length.toLocaleString()} other folders
        </p>
      </div>
      <div class="mx-5 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
        <span class="bg-violet-600" style={`width: ${sharedPercent}%`}></span>
        <span class="bg-amber-400" style={`width: ${uniquePercent}%`}></span>
        <span class="bg-gray-400" style={`width: ${internalPercent}%`}></span>
      </div>
      <dl class="grid gap-px bg-gray-100 sm:grid-cols-3 dark:bg-immich-dark-gray">
        <div class="bg-white p-5 dark:bg-immich-dark-bg">
          <dt class="text-sm font-semibold text-violet-700 dark:text-violet-300">Also found elsewhere</dt>
          <dd class="mt-1 text-2xl font-semibold">{overlap.sharedAssetCount.toLocaleString()}</dd>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">These files have a match in another folder.</p>
        </div>
        <div class="bg-white p-5 dark:bg-immich-dark-bg">
          <dt class="text-sm font-semibold text-amber-700 dark:text-amber-300">No match elsewhere</dt>
          <dd class="mt-1 text-2xl font-semibold">{overlap.uniqueAssets.length.toLocaleString()}</dd>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            No current exact or visual match outside this folder.
          </p>
        </div>
        <div class="bg-white p-5 dark:bg-immich-dark-bg">
          <dt class="text-sm font-semibold text-gray-600 dark:text-gray-300">Repeated only inside</dt>
          <dd class="mt-1 text-2xl font-semibold">{overlap.withinFolderOnlyAssets.length.toLocaleString()}</dd>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Matched within this folder, but not elsewhere.</p>
        </div>
      </dl>
    </div>

    {#if overlap.sharedFolders.length > 0}
      <div
        class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <header
          class="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray"
        >
          <div>
            <h3 class="font-semibold">Biggest overlaps</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose one folder to compare side by side.</p>
          </div>
          <p class="text-sm font-semibold">{overlap.sharedFolders.length.toLocaleString()} folders total</p>
        </header>
        <div class="divide-y divide-gray-100 dark:divide-immich-dark-gray">
          {#each visibleSharedFolders as shared (shared.folderPath)}
            <button
              type="button"
              class="grid w-full gap-3 px-5 py-3 text-left hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,14rem)_auto] sm:items-center dark:hover:bg-gray-900 {activeSharedFolder ===
              shared.folderPath
                ? 'bg-violet-50 dark:bg-violet-950/20'
                : ''}"
              aria-pressed={activeSharedFolder === shared.folderPath}
              onclick={() => chooseFolder(shared.folderPath)}
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold" title={shared.folderPath}
                  >{folderLabel(shared.folderPath)}</span
                >
                <span class="block truncate text-xs text-gray-500 dark:text-gray-400" title={shared.folderPath}
                  >{shared.folderPath}</span
                >
              </span>
              <span class="flex items-center gap-3">
                <span class="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <span
                    class="block h-full rounded-full bg-violet-600"
                    style={`width: ${(shared.sharedAssetCount / maxSharedAssetCount) * 100}%`}
                  ></span>
                </span>
                <span class="min-w-18 text-right text-sm font-semibold">{shared.sharedAssetCount.toLocaleString()}</span
                >
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400">{shared.groupCount.toLocaleString()} groups</span>
            </button>
          {/each}
        </div>
        {#if overlap.sharedFolders.length > 6}
          <div class="border-t border-gray-100 px-5 py-3 dark:border-immich-dark-gray">
            <button
              type="button"
              class="text-sm font-semibold text-primary hover:underline"
              onclick={() =>
                (visibleSharedFolderCount =
                  visibleSharedFolderCount < overlap.sharedFolders.length ? overlap.sharedFolders.length : 6)}
            >
              {visibleSharedFolderCount < overlap.sharedFolders.length
                ? `Show all ${overlap.sharedFolders.length.toLocaleString()} folders`
                : 'Show top 6 only'}
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if filteredGroups.length > 0 && selectedSummary}
      <div class="flex flex-wrap items-end justify-between gap-4 px-1 pt-1">
        <div class="min-w-0">
          <p class="text-xs font-semibold tracking-[0.14em] text-amber-700 uppercase dark:text-amber-300">
            Side by side
          </p>
          <h3 class="mt-1 truncate text-xl font-semibold" title={activeSharedFolder}>
            {folderLabel(folderPath)} with {folderLabel(activeSharedFolder)}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {selectedSummary.sharedAssetCount.toLocaleString()} from this folder match
            {selectedSummary.outsideAssetCount.toLocaleString()} there, across {selectedSummary.groupCount.toLocaleString()}
            groups.
          </p>
        </div>
        {#if isVerified(activeSharedFolder)}
          <span
            class="inline-flex min-h-10 items-center gap-2 rounded-full bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
          >
            <Icon icon={mdiCheckCircleOutline} size="18" /> Details checked
          </span>
        {:else}
          <button
            type="button"
            class="inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
            disabled={verifyingFolder === activeSharedFolder}
            onclick={() => onVerify?.(activeSharedFolder)}
          >
            <Icon icon={mdiShieldSearch} size="18" />
            {verifyingFolder === activeSharedFolder ? 'Checking details…' : 'Check byte details'}
          </button>
        {/if}
      </div>
      {#each visibleGroups as group (group.duplicateId)}
        {@const outsideAssets = group.elsewhere.filter(
          (asset) => !activeSharedFolder || getParentPath(asset.originalPath) === activeSharedFolder,
        )}
        <article
          class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
        >
          <header
            class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-immich-dark-gray"
          >
            <div>
              <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold dark:bg-gray-800"
                >{statusLabel(group.classification)}</span
              >
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Group flags are listed here. Highlighted rows compare aligned files below.
              </p>
            </div>
            <div class="flex max-w-2xl flex-wrap justify-end gap-1.5">
              {#each group.differences as difference (difference)}
                <span
                  class="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                  >{difference}</span
                >
              {/each}
            </div>
          </header>
          <div class="grid lg:grid-cols-2">
            <div class="p-4 lg:border-r lg:border-gray-100 dark:lg:border-immich-dark-gray">
              <p class="mb-3 text-xs font-semibold tracking-wide text-violet-700 uppercase dark:text-violet-300">
                This folder
              </p>
              <div class="grid gap-3">
                {#each group.here as asset, index (asset.id)}
                  {@render assetEvidence(asset, pairedAsset(asset, outsideAssets, index), 'violet')}
                {/each}
              </div>
            </div>
            <div class="p-4">
              <p class="mb-3 text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
                Elsewhere
              </p>
              <div class="grid gap-3">
                {#each outsideAssets as asset, index (asset.id)}
                  {@render assetEvidence(asset, pairedAsset(asset, group.here, index), 'emerald')}
                {/each}
              </div>
            </div>
          </div>
        </article>
      {/each}
      {#if visibleGroupCount < filteredGroups.length}
        <div class="flex justify-center">
          <button
            type="button"
            class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            onclick={() => (visibleGroupCount += 8)}>Show 8 more groups</button
          >
        </div>
      {/if}
    {/if}

    {#if overlap.uniqueAssets.length > 0}
      <details
        class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <summary class="cursor-pointer px-5 py-4 font-semibold"
          >No match elsewhere ({overlap.uniqueAssets.length.toLocaleString()})</summary
        >
        <div class="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-immich-dark-gray">
          {#each overlap.uniqueAssets.slice(0, visibleUniqueCount) as asset (asset.id)}
            <a
              class="group overflow-hidden rounded-2xl border border-gray-200 dark:border-immich-dark-gray"
              href={Route.viewAsset({ id: asset.id })}
            >
              <img
                class="aspect-4/3 w-full object-cover transition group-hover:scale-[1.02]"
                src={thumbnail(asset.id)}
                alt=""
                loading="lazy"
              />
              <span class="flex min-h-11 items-center justify-between gap-2 px-3 text-xs font-semibold"
                ><span class="truncate">{asset.originalFileName}</span><Icon icon={mdiArrowRight} size="15" /></span
              >
            </a>
          {/each}
        </div>
        {#if visibleUniqueCount < overlap.uniqueAssets.length}
          <div class="flex justify-center border-t border-gray-100 p-4 dark:border-immich-dark-gray">
            <button
              type="button"
              class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold dark:border-gray-600"
              onclick={() => (visibleUniqueCount += 24)}>Show 24 more</button
            >
          </div>
        {/if}
      </details>
    {/if}
  {/if}
</section>
