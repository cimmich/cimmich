<script lang="ts">
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    getCimmichPeople,
    previewCimmichImmichPersonClusters,
    resolveCimmichImmichPersonCluster,
    undoCimmichImmichPersonClusterResolution,
    type CimmichImmichOnboardingScope,
    type CimmichImmichPersonCluster,
    type CimmichPerson,
  } from '$lib/services/cimmich.service';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiArrowUDownLeft, mdiCheck, mdiHelpCircleOutline, mdiRefresh } from '@mdi/js';

  interface Props {
    mode?: 'review' | 'setup';
    oncomplete?: () => void;
    oncount?: (count: number) => void;
    onreadiness?: (ready: boolean) => void;
    scope: CimmichImmichOnboardingScope;
  }

  let {
    mode = 'setup',
    oncomplete = () => undefined,
    oncount = () => undefined,
    onreadiness = () => undefined,
    scope,
  }: Props = $props();
  let clusters = $state<CimmichImmichPersonCluster[]>([]);
  let people = $state<CimmichPerson[]>([]);
  let loading = $state(true);
  let busyClusterId = $state('');
  let error = $state('');
  let notice = $state('');
  let applyImportNeeded = $state(false);
  let selectedPeople = $state<Record<string, string>>({});
  let newNames = $state<Record<string, string>>({});
  let visibleCount = $state(20);

  const needsDecision = (cluster: CimmichImmichPersonCluster) =>
    cluster.resolution.state === 'unresolved' ||
    cluster.resolution.state === 'stale' ||
    cluster.resolution.state === 'later';
  const decisionClusters = $derived(clusters.filter((cluster) => needsDecision(cluster)));
  const displayedClusters = $derived(mode === 'review' ? decisionClusters : clusters);
  const unresolvedCount = $derived(decisionClusters.length);
  const visibleClusters = $derived(displayedClusters.slice(0, visibleCount));
  const remainingCount = $derived(Math.max(0, displayedClusters.length - visibleClusters.length));
  const sectionVisible = $derived(
    mode === 'setup' || loading || Boolean(error) || Boolean(notice) || displayedClusters.length > 0,
  );

  const load = async () => {
    loading = true;
    error = '';
    try {
      const [clusterPreview, visiblePeople] = await Promise.all([
        previewCimmichImmichPersonClusters(scope),
        getCimmichPeople(500),
      ]);
      clusters = clusterPreview.clusters;
      const nextDecisionCount = clusterPreview.clusters.filter((cluster) => needsDecision(cluster)).length;
      const nextDisplayedCount = mode === 'review' ? nextDecisionCount : clusterPreview.clusters.length;
      visibleCount = Math.min(nextDisplayedCount, Math.max(20, visibleCount));
      oncount(nextDecisionCount);
      people = visiblePeople.filter((person) => person.subject_kind === 'person');
      selectedPeople = Object.fromEntries(
        clusterPreview.clusters.map((cluster) => [
          cluster.immichPersonId,
          cluster.resolution.state === 'resolved' && cluster.resolution.personId ? cluster.resolution.personId : '',
        ]),
      );
      const ready = clusterPreview.clusters.every(
        (cluster) => cluster.resolution.state === 'resolved' && cluster.resolution.action !== 'later',
      );
      onreadiness(ready);
      if (clusterPreview.clusters.length > 0 && ready) {
        oncomplete();
      }
    } catch (error_) {
      oncount(0);
      error = error_ instanceof Error ? error_.message : 'Cimmich could not read unnamed Immich People.';
    } finally {
      loading = false;
    }
  };

  const cropStyle = (cluster: CimmichImmichPersonCluster) => {
    const box = cluster.representative.box;
    const cropSize = Math.min(1, Math.max(box.w * 2.4, box.h * 2.4, 0.01));
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    const cropX = Math.max(0, Math.min(1 - cropSize, centerX - cropSize / 2));
    const cropY = Math.max(0, Math.min(1 - cropSize, centerY - cropSize / 2));
    const positionX = (cropX / Math.max(0.0001, 1 - cropSize)) * 100;
    const positionY = (cropY / Math.max(0.0001, 1 - cropSize)) * 100;
    return [
      `background-image: url("${getAssetMediaUrl({ id: cluster.representative.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / cropSize}% ${100 / cropSize}%`,
      `background-position: ${Math.max(0, Math.min(100, positionX))}% ${Math.max(0, Math.min(100, positionY))}%`,
    ].join('; ');
  };

  const personName = (personId: string | null) =>
    people.find((person) => person.person_id === personId)?.display_name ?? 'Mapped Person';

  const resolve = async (
    cluster: CimmichImmichPersonCluster,
    action: 'create_person' | 'existing_person' | 'later' | 'noise' | 'unknown',
  ) => {
    if (busyClusterId) {
      return;
    }
    if (
      (action === 'unknown' || action === 'noise') &&
      !globalThis.confirm(
        action === 'unknown'
          ? `Mark all ${cluster.faceCount} Faces in this Immich cluster as an unknown Person?`
          : `Mark all ${cluster.faceCount} Faces in this Immich cluster as noise rather than a Person?`,
      )
    ) {
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
    applyImportNeeded = false;
    try {
      const result = await resolveCimmichImmichPersonCluster(cluster.immichPersonId, {
        action,
        commandId: `immich-person.resolve.${crypto.randomUUID()}`,
        expectedSourceRevision: cluster.sourceRevision,
        ...(action === 'existing_person' ? { personId } : {}),
        ...(action === 'create_person' ? { newPersonName } : {}),
        scope,
        snapshotDigest: cluster.snapshotDigest,
      });
      if (mode === 'review') {
        notice =
          action === 'existing_person' || action === 'create_person'
            ? 'Decision saved. Update the import when you want this current group’s Face labels admitted to Cimmich.'
            : action === 'later'
              ? 'Left for later. This group remains in Review.'
              : 'Decision saved. This group no longer needs identity review.';
        applyImportNeeded = action === 'existing_person' || action === 'create_person';
      } else {
        notice = result.changed
          ? 'Owner decision saved. Generic import can consume only this exact current revision.'
          : 'This exact decision was already current; no evidence changed.';
      }
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not save this cluster decision.';
    } finally {
      busyClusterId = '';
    }
  };

  const undo = async (cluster: CimmichImmichPersonCluster) => {
    if (cluster.resolution.state !== 'resolved' && cluster.resolution.state !== 'later') {
      return;
    }
    busyClusterId = cluster.immichPersonId;
    error = '';
    notice = '';
    applyImportNeeded = false;
    try {
      await undoCimmichImmichPersonClusterResolution(cluster.resolution.decisionId, {
        commandId: `immich-person.undo.${crypto.randomUUID()}`,
        scope,
      });
      notice = 'Cluster decision undone. Imported identity dependencies would have blocked this action as stale.';
      await load();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not undo this cluster decision.';
    } finally {
      busyClusterId = '';
    }
  };

  $effect(() => {
    void scope;
    void load();
  });
</script>

{#if sectionVisible}
  <section
    aria-labelledby="immich-cluster-resolution-title"
    class={mode === 'review'
      ? 'rounded-4xl border border-indigo-200 bg-white p-6 shadow-sm sm:p-8 dark:border-indigo-900 dark:bg-immich-dark-bg'
      : 'mt-6 border-t border-indigo-200 pt-6 dark:border-indigo-900'}
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold tracking-[0.14em] text-indigo-700 uppercase dark:text-indigo-300">
          {mode === 'review' ? 'Imported identity questions' : 'Before or after import'}
        </p>
        <h3 id="immich-cluster-resolution-title" class="mt-1 font-semibold">
          {mode === 'review' ? 'Review unnamed Face groups' : 'Resolve unnamed Face groups'}
        </h3>
        <p class="mt-1 max-w-3xl text-sm/6 text-gray-700 dark:text-gray-200">
          {#if mode === 'review'}
            These are live unresolved groups from the connected Immich library—not matcher suggestions or technical
            import exceptions. Map a clear group, keep it unknown, mark noise, or leave it for later. Cimmich never
            infers the choice.
          {:else}
            These are separate upstream Immich face groups, not unnamed versions of your existing Cimmich People. A
            group can remain after its source Person no longer appears separately in Immich, so this total may be higher
            than the preview above. Review them now or return to Review later; they do not block media or labelled
            People from importing. Cimmich never infers this choice from Bodies, geometry or matching.
          {/if}
        </p>
      </div>
      <span class="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold dark:bg-indigo-950/50">
        {loading ? 'Loading' : `${unresolvedCount} unresolved ${unresolvedCount === 1 ? 'group' : 'groups'}`}
      </span>
    </div>

    {#if error}
      <p role="alert" class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p>
    {/if}
    {#if notice}
      <div class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        <p>{notice}</p>
        {#if applyImportNeeded}
          <a class="mt-2 inline-flex font-semibold underline underline-offset-4" href={Route.cimmichMaintenance()}>
            Update import
          </a>
        {/if}
      </div>
    {/if}

    {#if !loading}
      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        {#each visibleClusters as cluster (cluster.immichPersonId)}
          <article
            class="grid gap-4 rounded-2xl border border-gray-200 p-4 sm:grid-cols-[8rem_1fr] dark:border-gray-700"
          >
            <div
              aria-label={`Representative crop for unnamed Immich face group with ${cluster.faceCount} ${cluster.faceCount === 1 ? 'Face' : 'Faces'}`}
              class="aspect-square w-full rounded-2xl bg-gray-200 bg-no-repeat dark:bg-gray-800"
              style={cropStyle(cluster)}
            ></div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-semibold">Unnamed face group</p>
                  <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {cluster.faceCount}
                    {cluster.faceCount === 1 ? 'Face' : 'Faces'} in this upstream group
                  </p>
                </div>
                <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold dark:bg-immich-dark-gray">
                  {cluster.resolution.state === 'resolved'
                    ? cluster.resolution.action.replaceAll('_', ' ')
                    : cluster.resolution.state}
                </span>
              </div>
              <details class="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                <summary class="cursor-pointer font-medium">Technical details</summary>
                <code class="mt-1 block truncate" title={cluster.immichPersonId}>{cluster.immichPersonId}</code>
              </details>

              {#if cluster.resolution.state === 'resolved' || cluster.resolution.state === 'later'}
                <p class="mt-3 text-sm/6">
                  {cluster.resolution.action === 'existing_person' || cluster.resolution.action === 'create_person'
                    ? `Mapped to ${personName(cluster.resolution.personId)}`
                    : cluster.resolution.action === 'later'
                      ? 'Held for later; it remains in Review until you make a final decision.'
                      : cluster.resolution.action === 'unknown'
                        ? 'Kept as an explicit unknown Person without identity.'
                        : 'Marked as non-Person noise.'}
                </p>
                <button
                  type="button"
                  class="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-3 text-sm font-semibold disabled:opacity-50 dark:border-gray-600"
                  disabled={Boolean(busyClusterId)}
                  onclick={() => void undo(cluster)}
                >
                  <Icon icon={mdiArrowUDownLeft} size="17" /> Undo decision
                </button>
              {:else}
                <label class="mt-3 grid gap-1.5 text-sm font-semibold">
                  Map to an existing Person
                  <select
                    class="min-h-10 rounded-xl border border-gray-300 bg-transparent px-3 font-normal dark:border-gray-600"
                    value={selectedPeople[cluster.immichPersonId] || ''}
                    onchange={(event) => {
                      selectedPeople = { ...selectedPeople, [cluster.immichPersonId]: event.currentTarget.value };
                    }}
                  >
                    <option value="">Choose a Person</option>
                    {#each people as person (person.person_id)}
                      <option value={person.person_id}>{person.display_name}</option>
                    {/each}
                  </select>
                </label>
                <button
                  type="button"
                  class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-full bg-indigo-950 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-indigo-100 dark:text-indigo-950"
                  disabled={Boolean(busyClusterId) || !selectedPeople[cluster.immichPersonId]}
                  onclick={() => void resolve(cluster, 'existing_person')}
                >
                  <Icon icon={mdiCheck} size="17" /> Use selected Person
                </button>

                <label class="mt-4 grid gap-1.5 text-sm font-semibold">
                  Or create a genuinely new Person
                  <input
                    class="min-h-10 rounded-xl border border-gray-300 bg-transparent px-3 font-normal dark:border-gray-600"
                    maxlength="160"
                    placeholder="Person name"
                    value={newNames[cluster.immichPersonId] || ''}
                    oninput={(event) => {
                      newNames = { ...newNames, [cluster.immichPersonId]: event.currentTarget.value };
                    }}
                  />
                </label>
                <button
                  type="button"
                  class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-full border border-indigo-300 px-4 text-sm font-semibold disabled:opacity-50 dark:border-indigo-700"
                  disabled={Boolean(busyClusterId) || !newNames[cluster.immichPersonId]?.trim()}
                  onclick={() => void resolve(cluster, 'create_person')}
                >
                  Create and map
                </button>

                <div class="mt-4 flex flex-wrap gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <button
                    type="button"
                    class="min-h-9 rounded-full border border-gray-300 px-3 text-xs font-semibold dark:border-gray-600"
                    onclick={() => void resolve(cluster, 'later')}>Later</button
                  >
                  <button
                    type="button"
                    class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-300 px-3 text-xs font-semibold dark:border-gray-600"
                    onclick={() => void resolve(cluster, 'unknown')}
                  >
                    <Icon icon={mdiHelpCircleOutline} size="15" /> Unknown Person
                  </button>
                  <button
                    type="button"
                    class="min-h-9 rounded-full border border-gray-300 px-3 text-xs font-semibold dark:border-gray-600"
                    onclick={() => void resolve(cluster, 'noise')}>Not a Person</button
                  >
                </div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
      {#if remainingCount > 0}
        <button
          type="button"
          class="mt-4 inline-flex min-h-10 items-center rounded-full border border-gray-300 px-4 text-sm font-semibold dark:border-gray-600"
          onclick={() => {
            visibleCount += 20;
          }}
        >
          Show 20 more · {remainingCount.toLocaleString()} remaining
        </button>
      {/if}
      <button
        type="button"
        class="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 px-4 text-sm font-semibold dark:border-gray-600"
        disabled={loading}
        onclick={() => void load()}
      >
        <Icon icon={mdiRefresh} size="17" /> Refresh clusters
      </button>
    {/if}
  </section>
{/if}
