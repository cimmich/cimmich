<script lang="ts">
  import { Route } from '$lib/route';
  import type {
    CimmichArchiveBackupProofItem,
    CimmichArchiveBackupProofPage,
  } from '$lib/services/cimmich-archive-integrity.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiHarddisk, mdiShieldAlertOutline, mdiShieldCheckOutline } from '@mdi/js';
  import type { ArchiveVariantGroup } from './archive-variant-groups';

  interface Props {
    error: string;
    exactGroupCount: number;
    groups: ArchiveVariantGroup[];
    items: Map<string, CimmichArchiveBackupProofItem>;
    loaded: boolean;
    loading: boolean;
    summary: CimmichArchiveBackupProofPage['summary'];
  }

  let { error, exactGroupCount, groups, items, loaded, loading, summary }: Props = $props();
  let visibleCount = $state(12);
  let candidates = $derived(groups.filter((group) => group.canonicalPlan.status === 'candidate'));
  let visibleCandidates = $derived(candidates.slice(0, visibleCount));

  const formatBytes = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / 1024 ** power;
    return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
  };
  const thumbnail = (sourceAssetId: string) => getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Thumbnail });
</script>

<section class="space-y-5" aria-labelledby="backup-proof-title">
  <div class="flex flex-wrap items-end justify-between gap-4 px-1">
    <div>
      <p class="text-xs font-semibold tracking-[0.14em] text-rose-700 uppercase dark:text-rose-300">
        Retirement safety gate
      </p>
      <h2 id="backup-proof-title" class="mt-1 text-2xl font-semibold">Independent backup proof</h2>
    </div>
    <p class="text-sm text-gray-500 dark:text-gray-400">No file is retirement-ready</p>
  </div>

  {#if error}
    <div
      class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      {error}
    </div>
  {/if}

  <article
    class="overflow-hidden rounded-3xl border border-rose-200 bg-white dark:border-rose-950 dark:bg-immich-dark-bg"
  >
    <div class="grid gap-5 p-5 lg:grid-cols-[auto_1fr_auto] lg:items-center">
      <span
        class="grid size-12 place-items-center rounded-2xl bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
      >
        <Icon icon={mdiShieldAlertOutline} size="25" />
      </span>
      <div>
        <h3 class="font-semibold">Independent destination evidence is required</h3>
        <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
          Cimmich has byte authority for {summary.byteVerifiedItems.toLocaleString()} media objects, but their active copies
          resolve through {summary.sourceSystemCount.toLocaleString()}
          {summary.sourceSystemCount === 1 ? 'source system' : 'source systems'} on the same storage domain. Duplicate paths
          and Immich records protect against neither disk failure nor archive loss.
        </p>
      </div>
      <div class="rounded-2xl bg-rose-50 px-4 py-3 text-left lg:text-right dark:bg-rose-950/30">
        <p class="text-2xl font-semibold text-rose-800 dark:text-rose-200">0</p>
        <p class="text-xs font-semibold tracking-wide text-rose-700 uppercase dark:text-rose-300">Retirement-ready</p>
      </div>
    </div>
    <footer
      class="border-t border-rose-100 bg-rose-50/60 px-5 py-3 text-xs/5 text-rose-900 dark:border-rose-950 dark:bg-rose-950/20 dark:text-rose-200"
    >
      {exactGroupCount.toLocaleString()} exact-copy groups and {candidates.length.toLocaleString()} preferred canonical candidates
      remain blocked until matching bytes are verified on a distinct failure domain.
    </footer>
  </article>

  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Independent backup requirements">
    {#each [['Exact bytes', 'The destination must independently reproduce the complete-file SHA-256 and byte length.'], ['Distinct failure domain', 'A different folder, Immich UUID or partition on the same physical disk does not count.'], ['Fresh observation', 'Proof must come from a bounded verifier run, not a remembered copy or filename match.'], ['Sidecars travel too', 'Future retirement also requires the owner-approved sidecar set to verify beside the media.']] as requirement (requirement[0])}
      <div class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-immich-dark-gray dark:bg-immich-dark-bg">
        <Icon
          icon={requirement[0] === 'Exact bytes' ? mdiShieldCheckOutline : mdiHarddisk}
          size="20"
          class="text-emerald-600"
        />
        <h3 class="mt-3 text-sm font-semibold">{requirement[0]}</h3>
        <p class="mt-1 text-sm/6 text-gray-600 dark:text-gray-300">{requirement[1]}</p>
      </div>
    {/each}
  </div>

  <div class="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
    <div>
      <p class="text-xs font-semibold tracking-[0.14em] text-amber-700 uppercase dark:text-amber-300">
        Canonical candidates
      </p>
      <h3 class="mt-1 text-xl font-semibold">Awaiting independent proof</h3>
    </div>
    <p class="text-sm text-gray-500 dark:text-gray-400">
      {candidates.length.toLocaleString()} candidates · {formatBytes(summary.byteVerifiedBytes)} archive scope
    </p>
  </div>

  {#if loading && !loaded}
    <div
      class="grid min-h-48 place-items-center rounded-3xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div class="text-center">
        <Icon icon={mdiHarddisk} size="34" class="mx-auto animate-pulse text-rose-500" />
        <p class="mt-3 text-sm font-semibold">Checking independent storage evidence…</p>
      </div>
    </div>
  {:else}
    <div class="grid gap-4 lg:grid-cols-2">
      {#each visibleCandidates as group (group.duplicateId)}
        {@const preferred = group.assets.find((asset) => asset.id === group.canonicalPlan.preferredAssetId)}
        {@const proof = preferred ? items.get(preferred.id) : undefined}
        {#if preferred}
          <article
            class="grid overflow-hidden rounded-3xl border border-gray-200 bg-white sm:grid-cols-[10rem_1fr] dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          >
            <a
              class="relative block min-h-40 bg-gray-100 dark:bg-gray-900"
              href={Route.viewAsset({ id: preferred.id })}
            >
              <img class="size-full object-cover" src={thumbnail(preferred.id)} alt="" loading="lazy" />
              <span class="absolute top-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">
                Not proven
              </span>
            </a>
            <div class="space-y-3 p-4">
              <div>
                <p class="truncate text-sm font-semibold" title={preferred.originalFileName}>
                  {preferred.originalFileName}
                </p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatBytes(proof?.byteLength ?? preferred.exifInfo?.fileSizeInByte ?? 0)} ·
                  {proof ? `SHA-256 ${proof.contentDigest.slice(0, 12)}…` : 'Byte proof unavailable'}
                </p>
              </div>
              <p class="text-xs/5 text-gray-600 dark:text-gray-300">
                {proof
                  ? `${proof.sourceSystemCount} ${proof.sourceSystemCount === 1 ? 'source system' : 'source systems'}; 0 verified independent destinations.`
                  : 'Waiting for the archive evidence read.'}
              </p>
              <a
                class="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                href={Route.viewAsset({ id: preferred.id })}
              >
                Inspect candidate <Icon icon={mdiArrowRight} size="17" />
              </a>
            </div>
          </article>
        {/if}
      {/each}
    </div>
  {/if}

  {#if visibleCount < candidates.length}
    <div class="flex justify-center">
      <button
        type="button"
        class="min-h-11 rounded-full border border-gray-300 px-5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
        onclick={() => (visibleCount += 12)}
      >
        Show 12 more candidates
      </button>
    </div>
  {/if}
</section>
