<script lang="ts">
  import { getCimmichPeople, type CimmichImmichPersonCluster, type CimmichPerson } from '$lib/services/cimmich.service';
  import {
    getCimmichPossiblePeople,
    refreshCimmichPossiblePeople,
    resolveCimmichPossiblePerson,
    undoCimmichPossiblePersonResolution,
    type CimmichPossiblePeopleRun,
  } from '$lib/services/possible-people.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareCropBackgroundStyle, cimmichSquareCropFrame } from '$lib/utils/cimmich-crop';
  import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiAccountQuestionOutline,
    mdiArrowUDownLeft,
    mdiCalendarRange,
    mdiCheck,
    mdiEyeOffOutline,
    mdiMapMarkerOutline,
    mdiRefresh,
  } from '@mdi/js';
  import { onDestroy } from 'svelte';

  interface Props {
    mode: 'active' | 'ignored';
    onignoredcount?: (count: number) => void;
  }

  let { mode, onignoredcount = () => undefined }: Props = $props();
  let clusters = $state<CimmichImmichPersonCluster[]>([]);
  let people = $state<CimmichPerson[]>([]);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let busyClusterId = $state('');
  let loadingPeople = $state(false);
  let openClusterId = $state('');
  let selectedPeople = $state<Record<string, string>>({});
  let loadGeneration = 0;
  let newNames = $state<Record<string, string>>({});
  let visibleCount = $state(20);
  let activeRun = $state<CimmichPossiblePeopleRun | null>(null);
  let completedRun = $state<CimmichPossiblePeopleRun | null>(null);
  let refreshRequested = $state(false);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const minimumRecurringPhotos = 5;
  const minimumSpreadPhotos = 3;
  const isIgnored = (cluster: CimmichImmichPersonCluster) =>
    cluster.resolution.state === 'later' && cluster.resolution.action === 'later';
  const hasMeaningfulRecurrence = (cluster: CimmichImmichPersonCluster) =>
    cluster.evidence.photoCount >= minimumRecurringPhotos ||
    (cluster.evidence.photoCount >= minimumSpreadPhotos &&
      (cluster.evidence.distinctYears >= 2 || cluster.evidence.locationCount >= 2));
  const isCurrentCandidate = (cluster: CimmichImmichPersonCluster) =>
    hasMeaningfulRecurrence(cluster) &&
    (cluster.resolution.state === 'unresolved' || cluster.resolution.state === 'stale');
  const significanceScore = (cluster: CimmichImmichPersonCluster) =>
    Math.log2(cluster.evidence.photoCount + 1) * 20 +
    Math.min(cluster.evidence.distinctYears, 20) * 5 +
    Math.min(cluster.evidence.locationCount, 10) * 8 +
    Math.min(cluster.evidence.timeSpanDays / 365, 20) * 2;
  const activeClusters = $derived(
    clusters
      .filter((cluster) => isCurrentCandidate(cluster))
      .sort(
        (left, right) =>
          right.evidence.photoCount - left.evidence.photoCount ||
          significanceScore(right) - significanceScore(left) ||
          left.immichPersonId.localeCompare(right.immichPersonId),
      ),
  );
  const ignoredClusters = $derived(
    clusters
      .filter((cluster) => hasMeaningfulRecurrence(cluster) && isIgnored(cluster))
      .sort(
        (left, right) =>
          right.evidence.photoCount - left.evidence.photoCount ||
          significanceScore(right) - significanceScore(left) ||
          left.immichPersonId.localeCompare(right.immichPersonId),
      ),
  );
  const displayedClusters = $derived(mode === 'active' ? activeClusters : ignoredClusters);
  const visibleClusters = $derived(displayedClusters.slice(0, visibleCount));
  const remainingCount = $derived(Math.max(0, displayedClusters.length - visibleClusters.length));

  const load = async () => {
    const generation = ++loadGeneration;
    loading = true;
    error = '';
    try {
      const preview = await getCimmichPossiblePeople();
      if (generation !== loadGeneration) {
        return;
      }
      clusters = preview.clusters;
      activeRun = preview.activeRun;
      completedRun = preview.completedRun;
      onignoredcount(
        preview.clusters.filter((cluster) => hasMeaningfulRecurrence(cluster) && isIgnored(cluster)).length,
      );
      visibleCount = Math.min(Math.max(20, visibleCount), Math.max(20, preview.clusters.length));
    } catch (error_) {
      if (generation !== loadGeneration) {
        return;
      }
      error = error_ instanceof Error ? error_.message : 'Cimmich could not read recurring unnamed face groups.';
    } finally {
      if (generation === loadGeneration) {
        loading = false;
      }
    }
  };

  const pollExplicitRefresh = async () => {
    if (!refreshRequested) {
      return;
    }
    await load();
    if (activeRun?.state === 'queued' || activeRun?.state === 'running') {
      pollTimer = setTimeout(() => void pollExplicitRefresh(), 1500);
      return;
    }
    refreshRequested = false;
    if (activeRun?.state === 'failed') {
      error = activeRun.errorMessage || 'Cimmich could not refresh Possible people.';
    } else if (completedRun) {
      notice = `Possible people refreshed: ${completedRun.clusterCount.toLocaleString()} groups found.`;
    }
  };

  const refresh = async () => {
    if (refreshRequested) {
      return;
    }
    error = '';
    notice = '';
    refreshRequested = true;
    try {
      await refreshCimmichPossiblePeople(`possible-people.refresh.${createCimmichUuid()}`);
      await pollExplicitRefresh();
    } catch (error_) {
      refreshRequested = false;
      error = error_ instanceof Error ? error_.message : 'Cimmich could not start Possible people refresh.';
    }
  };

  const ignore = async (cluster: CimmichImmichPersonCluster) => {
    if (busyClusterId) {
      return;
    }
    busyClusterId = cluster.immichPersonId;
    error = '';
    notice = '';
    try {
      const result = await resolveCimmichPossiblePerson(cluster.immichPersonId, {
        action: 'later',
        commandId: `possible-person.ignore.${createCimmichUuid()}`,
        snapshotDigest: cluster.snapshotDigest,
      });
      const resolution = result.resolution;
      if (!resolution || resolution.state !== 'later') {
        throw new Error('Cimmich saved an unexpected possible-person decision.');
      }
      const nextIgnoredCount = ignoredClusters.length + 1;
      clusters = clusters.map((candidate) =>
        candidate.immichPersonId === cluster.immichPersonId ? { ...candidate, resolution } : candidate,
      );
      onignoredcount(nextIgnoredCount);
      notice = 'Possible person moved to Needs attention. You can restore it there.';
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not ignore this possible person.';
    } finally {
      busyClusterId = '';
    }
  };

  const toggleReview = async (cluster: CimmichImmichPersonCluster) => {
    if (openClusterId === cluster.immichPersonId) {
      openClusterId = '';
      return;
    }
    openClusterId = cluster.immichPersonId;
    if (people.length > 0 || loadingPeople) {
      return;
    }
    loadingPeople = true;
    try {
      const visiblePeople = await getCimmichPeople(500);
      people = visiblePeople.filter((person) => person.subject_kind === 'person');
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not load the People directory.';
    } finally {
      loadingPeople = false;
    }
  };

  const resolve = async (cluster: CimmichImmichPersonCluster, action: 'create_person' | 'existing_person') => {
    if (busyClusterId) {
      return;
    }
    const personId = selectedPeople[cluster.immichPersonId]?.trim();
    const newPersonName = newNames[cluster.immichPersonId]?.trim();
    if (action === 'existing_person' && !personId) {
      error = 'Choose an existing Person first.';
      return;
    }
    if (action === 'create_person' && !newPersonName) {
      error = 'Enter a name for the new Person first.';
      return;
    }
    busyClusterId = cluster.immichPersonId;
    error = '';
    notice = '';
    try {
      const result = await resolveCimmichPossiblePerson(cluster.immichPersonId, {
        action,
        commandId: `possible-person.resolve.${createCimmichUuid()}`,
        ...(action === 'existing_person' ? { personId } : { newPersonName }),
        snapshotDigest: cluster.snapshotDigest,
      });
      notice =
        action === 'existing_person'
          ? `${result.candidateCount ?? cluster.faceCount} faces were added to that Person’s review queue.`
          : `Person created; ${result.candidateCount ?? cluster.faceCount} faces were added to their review queue.`;
      openClusterId = '';
      clusters = clusters.filter((candidate) => candidate.immichPersonId !== cluster.immichPersonId);
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not resolve this possible person.';
    } finally {
      busyClusterId = '';
    }
  };

  const restore = async (cluster: CimmichImmichPersonCluster) => {
    if (busyClusterId || cluster.resolution.state !== 'later') {
      return;
    }
    busyClusterId = cluster.immichPersonId;
    error = '';
    notice = '';
    try {
      await undoCimmichPossiblePersonResolution(
        cluster.resolution.decisionId,
        `possible-person.restore.${createCimmichUuid()}`,
      );
      const nextIgnoredCount = Math.max(0, ignoredClusters.length - 1);
      clusters = clusters.map((candidate) =>
        candidate.immichPersonId === cluster.immichPersonId
          ? { ...candidate, resolution: { state: 'unresolved' } }
          : candidate,
      );
      onignoredcount(nextIgnoredCount);
      notice = 'Possible person restored to Suggestions.';
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not restore this possible person.';
    } finally {
      busyClusterId = '';
    }
  };

  const cropFrame = (cluster: CimmichImmichPersonCluster) => {
    const box = cluster.representative.box;
    return {
      box,
      centerX: box.x + box.w / 2,
      centerY: box.y + box.h / 2,
      ...cimmichSquareCropFrame({
        boxH: box.h,
        boxW: box.w,
        boxX: box.x,
        boxY: box.y,
        height: cluster.representative.height ?? 0,
        padding: 4,
        width: cluster.representative.width ?? 0,
      }),
    };
  };

  const cropStyle = (cluster: CimmichImmichPersonCluster) => {
    const box = cluster.representative.box;
    return cimmichSquareCropBackgroundStyle({
      boxH: box.h,
      boxW: box.w,
      boxX: box.x,
      boxY: box.y,
      height: cluster.representative.height ?? 0,
      padding: 4,
      url: getAssetMediaUrl({ id: cluster.representative.sourceAssetId, size: AssetMediaSize.Preview }),
      width: cluster.representative.width ?? 0,
    });
  };

  const faceMarkerStyle = (cluster: CimmichImmichPersonCluster) => {
    const { box, centerX, centerY, cropH, cropW, cropX, cropY } = cropFrame(cluster);
    const diameter = Math.min(96, Math.max(box.w / cropW, box.h / cropH) * 1.18 * 100);
    const left = ((centerX - cropX) * 100) / cropW - diameter / 2;
    const top = ((centerY - cropY) * 100) / cropH - diameter / 2;
    return [
      `height: ${diameter}%`,
      `left: ${Math.max(0, Math.min(100 - diameter, left))}%`,
      `top: ${Math.max(0, Math.min(100 - diameter, top))}%`,
      `width: ${diameter}%`,
    ].join('; ');
  };

  const timeLabel = (cluster: CimmichImmichPersonCluster) => {
    const first = cluster.evidence.firstCaptureTime
      ? new Date(cluster.evidence.firstCaptureTime).getUTCFullYear()
      : null;
    const last = cluster.evidence.lastCaptureTime ? new Date(cluster.evidence.lastCaptureTime).getUTCFullYear() : null;
    if (first === null || last === null) {
      return 'Dates unavailable';
    }
    return first === last ? `Seen in ${first}` : `Seen ${first}–${last}`;
  };

  $effect(() => {
    void load();
  });

  onDestroy(() => {
    refreshRequested = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
  });
</script>

<section
  class="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
  aria-labelledby={`possible-people-${mode}`}
>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <p class="text-xs font-semibold tracking-[0.14em] text-gray-500 uppercase dark:text-gray-400">
        {mode === 'active' ? 'Recurring unnamed faces' : 'Hidden suggestions'}
      </p>
      <h2 id={`possible-people-${mode}`} class="mt-1 text-xl font-semibold">
        {mode === 'active' ? 'Possible people' : 'Ignored possible people'}
      </h2>
      <p class="mt-1 max-w-3xl text-sm/6 text-gray-600 dark:text-gray-300">
        {mode === 'active'
          ? 'Face groups seen at least five times, or at least three times across multiple years or known places, ranked by recurrence and spread.'
          : 'These recurring face groups were hidden from Suggestions. Restore any group you want to review again.'}
      </p>
    </div>
    <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold dark:bg-gray-800">
      {loading ? 'Loading' : displayedClusters.length.toLocaleString()}
    </span>
  </div>

  {#if error}
    <p class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
      {error}
    </p>
  {/if}
  {#if notice}
    <p class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950" role="status">
      {notice}
    </p>
  {/if}

  {#if loading}
    <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each [0, 1, 2] as placeholder (placeholder)}
        <div class="h-44 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800"></div>
      {/each}
    </div>
  {:else if !completedRun}
    <div class="mt-5 flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-5 text-sm dark:bg-gray-800/50">
      <Icon icon={mdiAccountQuestionOutline} size="24" />
      <span>No Possible people snapshot yet. Use Refresh when you want Cimmich to check the current matches.</span>
    </div>
  {:else if displayedClusters.length === 0}
    <div class="mt-5 flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-5 text-sm dark:bg-gray-800/50">
      <Icon icon={mdiAccountQuestionOutline} size="24" />
      <span>
        {mode === 'active'
          ? 'No recurring unnamed face groups currently meet the recurrence and spread threshold.'
          : 'No possible people are currently ignored.'}
      </span>
    </div>
  {:else}
    <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each visibleClusters as cluster (cluster.immichPersonId)}
        <article class="flex min-w-0 flex-col rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
          <a
            href={`/photos/${cluster.representative.sourceAssetId}`}
            class="relative block aspect-square w-full overflow-hidden rounded-xl bg-gray-200 bg-no-repeat dark:bg-gray-800"
            style={cropStyle(cluster)}
            aria-label="Open representative photo for possible person"
            data-testid="possible-person-photo"
          >
            <span
              class="pointer-events-none absolute rounded-full border-2 border-dotted border-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_0_12px_rgba(0,0,0,0.35)]"
              style={faceMarkerStyle(cluster)}
              data-testid="possible-person-face-marker"
              aria-hidden="true"
            ></span>
          </a>
          <div class="min-w-0 px-1 pt-4">
            <p class="font-semibold">Possible person</p>
            <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
              {cluster.evidence.photoCount.toLocaleString()}
              {cluster.evidence.photoCount === 1 ? 'photo' : 'photos'}
            </p>
            <div class="mt-2 grid gap-1 text-xs text-gray-500 dark:text-gray-400">
              <span class="inline-flex items-center gap-1.5">
                <Icon icon={mdiCalendarRange} size="15" />
                {timeLabel(cluster)}
                {#if cluster.evidence.distinctYears > 1}
                  · {cluster.evidence.distinctYears} years
                {/if}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <Icon icon={mdiMapMarkerOutline} size="15" />
                {cluster.evidence.locationCount > 0
                  ? `${cluster.evidence.locationCount} known ${cluster.evidence.locationCount === 1 ? 'place' : 'places'}`
                  : 'No place context yet'}
              </span>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              {#if mode === 'active'}
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center rounded-full bg-immich-primary px-3 text-xs font-semibold text-white dark:bg-immich-dark-primary dark:text-black"
                  aria-expanded={openClusterId === cluster.immichPersonId}
                  onclick={() => void toggleReview(cluster)}>Name or match</button
                >
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-xs font-semibold disabled:opacity-50 dark:border-gray-600"
                  disabled={Boolean(busyClusterId)}
                  onclick={() => void ignore(cluster)}
                >
                  <Icon icon={mdiEyeOffOutline} size="15" /> Ignore
                </button>
              {:else}
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-xs font-semibold disabled:opacity-50 dark:border-gray-600"
                  disabled={Boolean(busyClusterId)}
                  onclick={() => void restore(cluster)}
                >
                  <Icon icon={mdiArrowUDownLeft} size="15" /> Restore
                </button>
              {/if}
            </div>
          </div>
          {#if mode === 'active' && openClusterId === cluster.immichPersonId}
            <div class="mt-3 grid gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
              <label class="grid gap-1.5 text-xs font-semibold">
                Match an existing Person
                <select
                  class="min-h-10 rounded-xl border border-gray-300 bg-transparent px-3 text-sm font-normal dark:border-gray-600"
                  value={selectedPeople[cluster.immichPersonId] || ''}
                  disabled={loadingPeople}
                  onchange={(event) => {
                    selectedPeople = {
                      ...selectedPeople,
                      [cluster.immichPersonId]: event.currentTarget.value,
                    };
                  }}
                >
                  <option value="">{loadingPeople ? 'Loading people…' : 'Choose a Person'}</option>
                  {#each people as person (person.person_id)}
                    <option value={person.person_id}>{person.display_name}</option>
                  {/each}
                </select>
              </label>
              <button
                type="button"
                class="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-gray-300 px-3 text-xs font-semibold disabled:opacity-50 dark:border-gray-600"
                disabled={Boolean(busyClusterId) || !selectedPeople[cluster.immichPersonId]}
                onclick={() => void resolve(cluster, 'existing_person')}
              >
                <Icon icon={mdiCheck} size="15" /> Use selected Person
              </button>
              <label class="grid gap-1.5 text-xs font-semibold">
                Or name a new Person
                <input
                  class="min-h-10 rounded-xl border border-gray-300 bg-transparent px-3 text-sm font-normal dark:border-gray-600"
                  maxlength="160"
                  placeholder="Person name"
                  value={newNames[cluster.immichPersonId] || ''}
                  oninput={(event) => {
                    newNames = {
                      ...newNames,
                      [cluster.immichPersonId]: event.currentTarget.value,
                    };
                  }}
                />
              </label>
              <button
                type="button"
                class="inline-flex min-h-9 w-fit items-center rounded-full border border-gray-300 px-3 text-xs font-semibold disabled:opacity-50 dark:border-gray-600"
                disabled={Boolean(busyClusterId) || !newNames[cluster.immichPersonId]?.trim()}
                onclick={() => void resolve(cluster, 'create_person')}
              >
                Create and map
              </button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
    {#if remainingCount > 0}
      <button
        type="button"
        class="mt-4 min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold dark:border-gray-600"
        onclick={() => (visibleCount += 20)}
      >
        Show 20 more · {remainingCount.toLocaleString()} remaining
      </button>
    {/if}
  {/if}

  <button
    type="button"
    class="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold disabled:opacity-50 dark:border-gray-600"
    disabled={loading || refreshRequested}
    onclick={() => void refresh()}
  >
    <Icon icon={mdiRefresh} size="17" />
    {refreshRequested ? 'Refreshing possible people…' : 'Refresh possible people'}
  </button>
  {#if refreshRequested && activeRun}
    <p class="mt-2 text-xs text-gray-500 dark:text-gray-400" role="status">
      {activeRun.totalSeeds > 0
        ? `${activeRun.processedSeeds.toLocaleString()} of ${activeRun.totalSeeds.toLocaleString()} faces checked`
        : 'Preparing the Cimmich face snapshot…'}
    </p>
  {:else if completedRun?.completedAt}
    <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
      Last checked {new Date(completedRun.completedAt).toLocaleString()}
    </p>
  {/if}
</section>
