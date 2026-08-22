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
  import type { ArchiveFolderComparisonGroup, ArchiveFolderOverlap } from './archive-folder-comparison';

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
    const readable = `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
    return `${readable} (${value.toLocaleString()} bytes)`;
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
          second: '2-digit',
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

  type FactDefinition = {
    compare: (asset: AssetResponseDto) => unknown;
    label: string;
    value: (asset: AssetResponseDto) => string;
  };

  const primaryFactDefinitions: FactDefinition[] = [
    {
      compare: (asset) => asset.originalFileName,
      label: 'File name',
      value: (asset) => asset.originalFileName || 'Not recorded',
    },
    {
      compare: (asset) => asset.originalPath,
      label: 'File location',
      value: (asset) => asset.originalPath || 'Not recorded',
    },
    {
      compare: (asset) => asset.exifInfo?.fileSizeInByte,
      label: 'File size',
      value: (asset) => formatBytes(asset.exifInfo?.fileSizeInByte),
    },
    {
      compare: (asset) => [asset.width, asset.height],
      label: 'Resolution',
      value: dimensions,
    },
    {
      compare: (asset) => asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime,
      label: 'Captured',
      value: (asset) => formatDateTime(asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime),
    },
    {
      compare: (asset) => asset.fileModifiedAt,
      label: 'File modified',
      value: (asset) => formatDateTime(asset.fileModifiedAt),
    },
    {
      compare: (asset) => [
        asset.exifInfo?.city,
        asset.exifInfo?.state,
        asset.exifInfo?.country,
        asset.exifInfo?.latitude,
        asset.exifInfo?.longitude,
      ],
      label: 'Photo location',
      value: photoLocation,
    },
    {
      compare: (asset) => [asset.exifInfo?.make, asset.exifInfo?.model, asset.exifInfo?.lensModel],
      label: 'Camera',
      value: camera,
    },
  ];

  const secondaryFactDefinitions: FactDefinition[] = [
    {
      compare: (asset) => asset.originalMimeType,
      label: 'File type',
      value: (asset) => asset.originalMimeType || 'Not recorded',
    },
    {
      compare: (asset) => asset.exifInfo?.orientation,
      label: 'Rotation',
      value: orientation,
    },
    {
      compare: (asset) => asset.exifInfo?.description,
      label: 'Description',
      value: (asset) => asset.exifInfo?.description || 'Not recorded',
    },
    {
      compare: (asset) => asset.exifInfo?.rating,
      label: 'Rating',
      value: (asset) => (asset.exifInfo?.rating == null ? 'Not recorded' : `${asset.exifInfo.rating} stars`),
    },
    {
      compare: people,
      label: 'Immich People',
      value: people,
    },
    {
      compare: tags,
      label: 'Immich Tags',
      value: tags,
    },
    {
      compare: (asset) => asset.isFavorite,
      label: 'Favourite',
      value: (asset) => (asset.isFavorite ? 'Yes' : 'No'),
    },
    {
      compare: (asset) => asset.isArchived,
      label: 'Archive status',
      value: (asset) => (asset.isArchived ? 'Archived' : 'Not archived'),
    },
    {
      compare: (asset) => asset.visibility,
      label: 'Visibility',
      value: (asset) => asset.visibility || 'Not recorded',
    },
  ];

  const comparisonRows = (assets: AssetResponseDto[], definitions: FactDefinition[]) =>
    definitions.map((definition) => ({
      changed: new Set(assets.map((asset) => scalar(definition.compare(asset)))).size > 1,
      label: definition.label,
      values: assets.map((asset) => definition.value(asset)),
    }));
  const alignAssets = (here: AssetResponseDto[], elsewhere: AssetResponseDto[]) => {
    const remaining = [...elsewhere];
    const aligned: AssetResponseDto[] = [];
    for (const asset of here) {
      aligned.push(asset);
      const matchingIndex = remaining.findIndex((candidate) => candidate.originalFileName === asset.originalFileName);
      if (matchingIndex !== -1) {
        aligned.push(...remaining.splice(matchingIndex, 1));
      }
    }
    return [...aligned, ...remaining];
  };
  const scopeLabel = (asset: AssetResponseDto) =>
    getParentPath(asset.originalPath) === folderPath ? 'This folder' : folderLabel(getParentPath(asset.originalPath));
  const visibleRecommendation = (plan: ArchiveFolderComparisonGroup['canonicalPlan'], assets: AssetResponseDto[]) => {
    const visibleAssetIds = new Set(assets.map((asset) => asset.id));
    if (plan.preferredAssetId && visibleAssetIds.has(plan.preferredAssetId)) {
      return {
        assetId: plan.preferredAssetId,
        note: 'Review the image and copy-local metadata before removing anything.',
        reviewOnly: false,
      };
    }
    if (plan.status === 'hold_exact' || plan.status === 'hold_ambiguous') {
      return null;
    }
    const ranking = [...plan.rankings.values()]
      .filter((candidate) => visibleAssetIds.has(candidate.assetId))
      .sort((left, right) => left.position - right.position)[0];
    if (!ranking) {
      return null;
    }
    return {
      assetId: ranking.assetId,
      note:
        plan.status === 'candidate'
          ? 'The archive-wide winner is outside this folder pair. This visible-pair recommendation is review-only, not deletion proof.'
          : 'Byte evidence is incomplete. This is a review recommendation, not deletion proof.',
      reviewOnly: true,
    };
  };
  const recommendationReason = (
    plan: ArchiveFolderComparisonGroup['canonicalPlan'],
    assets: AssetResponseDto[],
    recommendedAssetId: string,
  ) => {
    if (plan.preferredAssetId === recommendedAssetId) {
      return plan.reasons.join(' ');
    }
    const visibleAssetIds = new Set(assets.map((asset) => asset.id));
    const ranked = [...plan.rankings.values()]
      .filter((candidate) => visibleAssetIds.has(candidate.assetId))
      .sort((left, right) => left.position - right.position);
    const preferred = ranked[0];
    const runnerUp = ranked[1];
    if (!preferred || !runnerUp) {
      return 'Available preservation signals rank this copy first.';
    }
    if (preferred.originalCapture !== runnerUp.originalCapture) {
      return `${preferred.extension.toLocaleUpperCase()} is an original capture format.`;
    }
    if (preferred.pixelCount !== runnerUp.pixelCount) {
      return `Higher pixel dimensions rank first: ${(preferred.pixelCount / 1_000_000).toFixed(1)} MP versus ${(runnerUp.pixelCount / 1_000_000).toFixed(1)} MP.`;
    }
    if (preferred.fileSize !== runnerUp.fileSize) {
      return `The larger complete file ranks first: ${formatBytes(preferred.fileSize)} versus ${formatBytes(runnerUp.fileSize)}.`;
    }
    if (preferred.metadataFields !== runnerUp.metadataFields) {
      return `More capture metadata ranks first: ${preferred.metadataFields} fields versus ${runnerUp.metadataFields}.`;
    }
    return `Richer organisation and identity evidence ranks first: ${preferred.evidenceLinks} links versus ${runnerUp.evidenceLinks}.`;
  };
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

<section class="space-y-5" aria-label="Folder comparison results">
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
          <dt class="text-sm font-semibold text-amber-700 dark:text-amber-300">Unique to this folder</dt>
          <dd class="mt-1 text-2xl font-semibold">{overlap.uniqueAssets.length.toLocaleString()}</dd>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            No current exact or visual match anywhere else. Repeats within this folder are counted separately.
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
        {@const comparisonAssets = alignAssets(group.here, outsideAssets)}
        {@const primaryRows = comparisonRows(comparisonAssets, primaryFactDefinitions)}
        {@const secondaryRows = comparisonRows(comparisonAssets, secondaryFactDefinitions)}
        {@const recommendation = visibleRecommendation(group.canonicalPlan, comparisonAssets)}
        {@const recommendedAssetId = recommendation?.assetId ?? null}
        {@const recommendedAsset = comparisonAssets.find((asset) => asset.id === recommendedAssetId)}
        {@const comparisonGrid = `grid-template-columns: 7.5rem repeat(${comparisonAssets.length}, 13rem);`}
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
                Every copy is on one line. Highlighted rows contain different values.
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
          {#if recommendedAsset}
            <div
              class="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/25"
            >
              <div class="min-w-0">
                <p class="font-semibold text-emerald-900 dark:text-emerald-100">Recommended to keep</p>
                {#if recommendation?.reviewOnly}
                  <span
                    class="mt-1 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-950 dark:bg-amber-900 dark:text-amber-100"
                    >Review only</span
                  >
                {/if}
                <a
                  class="mt-0.5 block font-semibold wrap-break-word text-primary hover:underline"
                  href={Route.viewAsset({ id: recommendedAsset.id })}>{recommendedAsset.originalFileName}</a
                >
              </div>
              <p class="max-w-2xl text-xs/5 text-emerald-900 dark:text-emerald-100">
                {recommendationReason(group.canonicalPlan, comparisonAssets, recommendedAsset.id)}
                {recommendation?.note}
              </p>
            </div>
          {:else}
            <div
              class="border-b border-gray-100 bg-gray-50 px-5 py-3 text-sm dark:border-immich-dark-gray dark:bg-gray-900"
            >
              <p class="font-semibold">No safe recommendation</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{group.canonicalPlan.reasons.join(' ')}</p>
            </div>
          {/if}
          <div class="overflow-x-auto">
            <div class="grid min-w-max text-xs" style={comparisonGrid}>
              <div
                class="sticky left-0 z-10 flex items-end border-r border-b border-gray-200 bg-gray-50 p-3 font-semibold text-gray-600 dark:border-immich-dark-gray dark:bg-gray-900 dark:text-gray-300"
              >
                Copies
              </div>
              {#each comparisonAssets as asset (asset.id)}
                <div
                  class="relative min-w-0 border-r border-b border-gray-200 p-3 last:border-r-0 dark:border-immich-dark-gray {recommendedAssetId ===
                  asset.id
                    ? 'bg-emerald-50 ring-2 ring-emerald-500 ring-inset dark:bg-emerald-950/25'
                    : ''}"
                >
                  <a
                    class="group block aspect-4/3 w-full overflow-hidden rounded-lg border border-gray-200 dark:border-immich-dark-gray"
                    href={Route.viewAsset({ id: asset.id })}
                  >
                    <img
                      class="size-full object-cover transition group-hover:scale-105"
                      src={thumbnail(asset.id)}
                      alt=""
                      loading="lazy"
                    />
                  </a>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <span
                      class="rounded-full px-2 py-0.5 text-[10px] font-semibold {getParentPath(asset.originalPath) ===
                      folderPath
                        ? 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100'
                        : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'}"
                      >{scopeLabel(asset)}</span
                    >
                    {#if recommendedAssetId === asset.id}
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold text-white"
                        ><Icon icon={mdiCheckCircleOutline} size="12" /> Recommended to keep</span
                      >
                      {#if recommendation?.reviewOnly}
                        <span
                          class="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-950 dark:bg-amber-900 dark:text-amber-100"
                          >Review only</span
                        >
                      {/if}
                    {/if}
                  </div>
                  <a
                    class="mt-2 block font-semibold wrap-break-word hover:text-primary hover:underline"
                    href={Route.viewAsset({ id: asset.id })}>{asset.originalFileName}</a
                  >
                  <a
                    class="mt-2 inline-block font-semibold text-primary hover:underline"
                    href={Route.viewAsset({ id: asset.id })}>Open photo</a
                  >
                </div>
              {/each}
              {#each primaryRows as row (row.label)}
                <div
                  class="sticky left-0 z-10 flex flex-wrap items-center gap-1.5 border-r border-b border-gray-200 p-3 font-semibold dark:border-immich-dark-gray {row.changed
                    ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
                    : 'bg-gray-50 text-gray-600 dark:bg-gray-900 dark:text-gray-300'}"
                >
                  {row.label}
                  {#if row.changed}
                    <span
                      class="rounded-full bg-amber-300 px-1.5 py-0.5 text-[10px] text-amber-950 dark:bg-amber-800 dark:text-amber-100"
                      >Different</span
                    >
                  {/if}
                </div>
                {#each row.values as value, index (`${row.label}-${comparisonAssets[index]?.id}`)}
                  <div
                    class="min-w-0 border-r border-b border-gray-200 p-3 wrap-break-word last:border-r-0 dark:border-immich-dark-gray {row.changed
                      ? 'bg-amber-50/70 dark:bg-amber-950/15'
                      : ''}"
                    title={value}
                  >
                    {value}
                  </div>
                {/each}
              {/each}
            </div>
          </div>
          <details class="border-t border-gray-100 dark:border-immich-dark-gray">
            <summary class="cursor-pointer px-5 py-3 text-sm font-semibold text-primary">
              More Immich metadata, same columns
            </summary>
            <div class="overflow-x-auto border-t border-gray-100 dark:border-immich-dark-gray">
              <div class="grid min-w-max text-xs" style={comparisonGrid}>
                {#each secondaryRows as row (row.label)}
                  <div
                    class="sticky left-0 z-10 flex flex-wrap items-center gap-1.5 border-r border-b border-gray-200 p-3 font-semibold dark:border-immich-dark-gray {row.changed
                      ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100'
                      : 'bg-gray-50 text-gray-600 dark:bg-gray-900 dark:text-gray-300'}"
                  >
                    {row.label}
                    {#if row.changed}
                      <span
                        class="rounded-full bg-amber-300 px-1.5 py-0.5 text-[10px] text-amber-950 dark:bg-amber-800 dark:text-amber-100"
                        >Different</span
                      >
                    {/if}
                  </div>
                  {#each row.values as value, index (`more-${row.label}-${comparisonAssets[index]?.id}`)}
                    <div
                      class="min-w-0 border-r border-b border-gray-200 p-3 wrap-break-word last:border-r-0 dark:border-immich-dark-gray {row.changed
                        ? 'bg-amber-50/70 dark:bg-amber-950/15'
                        : ''}"
                      title={value}
                    >
                      {value}
                    </div>
                  {/each}
                {/each}
              </div>
            </div>
          </details>
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
          >Unique to this folder ({overlap.uniqueAssets.length.toLocaleString()})</summary
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
