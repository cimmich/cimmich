<script lang="ts">
  import {
    archiveVariantFolderContext,
    type ArchiveVariantClassification,
    type ArchiveVariantGroup,
  } from '$lib/components/cimmich/archive-variant-groups';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiFolderOpenOutline,
    mdiInformationOutline,
    mdiShieldCheckOutline,
    mdiTuneVariant,
  } from '@mdi/js';

  type VariantFilter = 'all' | ArchiveVariantClassification;

  interface Props {
    allGroups: ArchiveVariantGroup[];
    error: string;
    filter: VariantFilter;
    filteredGroups: ArchiveVariantGroup[];
    loaded: boolean;
    loading: boolean;
    onFilter: (filter: VariantFilter) => void;
    onLoadMore: () => void;
    totalGroupCount: number;
    visibleGroups: ArchiveVariantGroup[];
  }

  let {
    allGroups,
    error,
    filter,
    filteredGroups,
    loaded,
    loading,
    onFilter,
    onLoadMore,
    totalGroupCount,
    visibleGroups,
  }: Props = $props();

  const number = new Intl.NumberFormat();
  const countLabel = (value: number, singular: string, plural = `${singular}s`) =>
    `${number.format(value)} ${value === 1 ? singular : plural}`;
  const formatBytes = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** power;
    return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
  };
  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
      : 'Date unavailable';
  const assetDimensions = (asset: AssetResponseDto) =>
    asset.width && asset.height ? `${number.format(asset.width)} × ${number.format(asset.height)}` : 'Size unavailable';
  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
  const classificationLabel = (classification: ArchiveVariantClassification) =>
    classification === 'verified_variant'
      ? 'Different files'
      : classification === 'verified_exact'
        ? 'Exact copies'
        : 'Needs verification';
  const classificationClass = (classification: ArchiveVariantClassification) =>
    classification === 'verified_variant'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      : classification === 'verified_exact'
        ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
        : 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200';
  const names = (asset: AssetResponseDto) =>
    asset.people
      ?.map((person) => person.name.trim())
      .filter(Boolean)
      .join(', ') || 'No Immich People';
  const tags = (asset: AssetResponseDto) =>
    asset.tags
      ?.map((tag) => tag.value)
      .filter(Boolean)
      .join(', ') || 'No Immich Tags';
</script>

<section class="space-y-4" aria-labelledby="variant-groups-title">
  <div class="flex flex-wrap items-end justify-between gap-4 px-1">
    <h2 id="variant-groups-title" class="text-xl font-semibold">Possible duplicate groups</h2>
    <div class="flex flex-wrap gap-1 rounded-full bg-gray-100 p-1 dark:bg-gray-900" aria-label="Filter variants">
      {#each [['all', 'All'], ['verified_variant', 'Different files'], ['verified_exact', 'Exact copies'], ['similarity_candidate', 'Unverified']] as option (option[0])}
        <button
          type="button"
          class="min-h-9 rounded-full px-3 text-xs font-semibold {filter === option[0]
            ? 'bg-white shadow-sm dark:bg-gray-700'
            : 'text-gray-500 dark:text-gray-400'}"
          aria-pressed={filter === option[0]}
          onclick={() => onFilter(option[0] as VariantFilter)}>{option[1]}</button
        >
      {/each}
    </div>
  </div>

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
        <Icon icon={mdiTuneVariant} size="34" class="mx-auto animate-pulse text-amber-500" />
        <p class="mt-3 text-sm font-semibold">Loading comparisons…</p>
      </div>
    </div>
  {:else if loaded && filteredGroups.length === 0}
    <div
      class="rounded-3xl border border-gray-200 bg-white px-6 py-12 text-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <Icon icon={mdiShieldCheckOutline} size="38" class="mx-auto text-emerald-600" />
      <h3 class="mt-3 text-lg font-semibold">No groups match this evidence filter</h3>
    </div>
  {:else}
    {#each visibleGroups as group (group.duplicateId)}
      {@const plan = group.canonicalPlan}
      {@const preferred = group.assets.find((asset) => asset.id === plan.preferredAssetId)}
      <article
        class="overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      >
        <header class="border-b border-gray-100 px-5 py-4 dark:border-immich-dark-gray">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span
                class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold {classificationClass(
                  group.classification,
                )}">{classificationLabel(group.classification)}</span
              >
              <h3 class="mt-2 text-lg font-semibold">{countLabel(group.assets.length, 'file')} to compare</h3>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {group.classification === 'verified_variant'
                  ? 'They look alike, but the file bytes differ.'
                  : group.classification === 'verified_exact'
                    ? 'The complete file bytes match.'
                    : 'They look alike, but byte verification is incomplete.'}
              </p>
            </div>
            <div
              class="max-w-md rounded-2xl {preferred
                ? 'bg-emerald-50 dark:bg-emerald-950/25'
                : 'bg-gray-100 dark:bg-gray-900'} px-4 py-3"
            >
              <p
                class="text-xs font-semibold tracking-wide uppercase {preferred
                  ? 'text-emerald-800 dark:text-emerald-200'
                  : 'text-gray-600 dark:text-gray-300'}"
              >
                {preferred ? 'Recommended to keep' : 'No safe recommendation'}
              </p>
              <p class="mt-1 text-sm font-semibold">{preferred?.originalFileName ?? 'Compare these yourself'}</p>
              {#if plan.reasons[0]}
                <p class="mt-1 text-xs/5 text-gray-600 dark:text-gray-300">{plan.reasons[0]}</p>
              {/if}
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            {#if group.differences.length === 0}
              <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800">
                No catalogued metadata difference
              </span>
            {:else}
              {#each group.differences as difference (difference)}
                <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800">{difference}</span>
              {/each}
            {/if}
          </div>
          {#if plan.reasons.length > 1 || plan.cautions.length > 0}
            <details class="mt-3 text-xs/5 text-gray-600 dark:text-gray-300">
              <summary class="cursor-pointer font-semibold">Why this recommendation</summary>
              <div class="mt-2 grid gap-2 sm:grid-cols-2">
                <ul>
                  {#each plan.reasons as reason (reason)}<li>• {reason}</li>{/each}
                </ul>
                <ul>
                  {#each plan.cautions as caution (caution)}<li>• {caution}</li>{/each}
                </ul>
              </div>
            </details>
          {/if}
        </header>

        <div class="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {#each group.assets as asset, assetIndex (asset.id)}
            {@const cimmichEvidence = group.evidence.get(asset.id)}
            {@const folderContext = archiveVariantFolderContext(allGroups, asset)}
            {@const isPreferred = plan.preferredAssetId === asset.id}
            <div
              class="overflow-hidden rounded-2xl border {isPreferred
                ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                : 'border-gray-200 dark:border-immich-dark-gray'}"
            >
              <a
                class="group relative block aspect-16/10 overflow-hidden bg-gray-100 dark:bg-gray-900"
                href={Route.viewAsset({ id: asset.id })}
              >
                <img
                  class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                  src={thumbnail(asset.id)}
                  alt=""
                  loading="lazy"
                />
                <span
                  class="absolute top-3 left-3 rounded-full {isPreferred
                    ? 'bg-emerald-700'
                    : 'bg-black/70'} px-2.5 py-1 text-xs font-semibold text-white"
                  >{isPreferred ? 'Recommended keep' : `Version ${assetIndex + 1}`}</span
                >
              </a>
              <div class="space-y-3 p-4">
                <div>
                  <p class="truncate text-sm font-semibold" title={asset.originalFileName}>{asset.originalFileName}</p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime)} · {assetDimensions(asset)} ·
                    {formatBytes(asset.exifInfo?.fileSizeInByte ?? 0)}
                  </p>
                  {#if folderContext}
                    <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium">
                      <Icon icon={mdiFolderOpenOutline} size="16" class="shrink-0 text-primary" />
                      <a
                        class="max-w-full min-w-0 truncate text-primary hover:underline"
                        href={Route.viewFolderAsset({ cimmich: 1, id: asset.id, path: folderContext.path })}
                        title={`Open ${folderContext.path}`}>{folderContext.path}</a
                      >
                      <a
                        class="shrink-0 whitespace-nowrap text-primary hover:underline"
                        data-sveltekit-reload
                        href={Route.cimmichArchiveIntegrity({ folder: folderContext.path, mode: 'folder' })}
                        >({countLabel(folderContext.otherFlaggedHere, 'other flagged photo')} here)</a
                      >
                    </div>
                  {/if}
                </div>
                <details class="text-xs/5 text-gray-600 dark:text-gray-300">
                  <summary class="cursor-pointer font-semibold text-gray-700 dark:text-gray-200"
                    >Technical details</summary
                  >
                  <div class="mt-2 space-y-1.5">
                    <p><strong class="text-gray-900 dark:text-white">Immich People:</strong> {names(asset)}</p>
                    <p><strong class="text-gray-900 dark:text-white">Immich Tags:</strong> {tags(asset)}</p>
                    <p>
                      <strong class="text-gray-900 dark:text-white">Cimmich evidence:</strong>
                      {cimmichEvidence
                        ? `${countLabel(cimmichEvidence.people, 'person', 'people')} · ${countLabel(cimmichEvidence.faceAssignments, 'face')} · ${countLabel(cimmichEvidence.headAssignments, 'head')} · ${countLabel(cimmichEvidence.bodyAssignments, 'body', 'bodies')} · ${countLabel(cimmichEvidence.presenceAssignments, 'presence', 'presence')}`
                        : 'Byte-linked evidence unavailable'}
                    </p>
                  </div>
                </details>
                <a
                  class="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                  href={Route.viewAsset({ id: asset.id })}
                >
                  Open photo <Icon icon={mdiArrowRight} size="17" />
                </a>
              </div>
            </div>
          {/each}
        </div>

        {#if group.classification === 'verified_exact'}
          <footer
            class="flex items-start gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs/5 text-gray-600 dark:border-immich-dark-gray dark:bg-gray-900/50 dark:text-gray-300"
          >
            <Icon icon={mdiInformationOutline} size="17" class="mt-0.5 shrink-0" />
            Cimmich intelligence follows verified content, so its evidence is shared across exact copies. Immich People and
            Tags remain copy-local and can still differ.
          </footer>
        {/if}
      </article>
    {/each}
  {/if}
</section>

{#if allGroups.length < totalGroupCount}
  <div class="flex justify-center">
    <button
      type="button"
      class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
      disabled={loading}
      onclick={onLoadMore}
    >
      {loading ? 'Loading details…' : 'Load 12 more comparisons'}
    </button>
  </div>
{/if}
