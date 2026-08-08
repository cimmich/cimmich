<script lang="ts">
  import {
    resolveCimmichPossiblePerson,
    type CimmichKnownPersonClusterSuggestion,
  } from '$lib/services/possible-people.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareCropBackgroundStyle } from '$lib/utils/cimmich-crop';
  import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
  import { AssetMediaSize } from '@immich/sdk';

  interface Props {
    items: CimmichKnownPersonClusterSuggestion[];
    onChanged?: (input: { candidateCount: number; clusterId: string; kind: 'review' | 'reject' }) => void;
    personId: string;
    personName: string;
  }

  let { items, onChanged = () => undefined, personId, personName }: Props = $props();
  let busyClusterId = $state('');
  let error = $state('');

  const cropStyle = (item: CimmichKnownPersonClusterSuggestion) =>
    cimmichSquareCropBackgroundStyle({
      boxH: item.representative.box.h,
      boxW: item.representative.box.w,
      boxX: item.representative.box.x,
      boxY: item.representative.box.y,
      height: item.representative.height ?? 0,
      padding: 4,
      url: getAssetMediaUrl({ id: item.representative.sourceAssetId, size: AssetMediaSize.Preview }),
      width: item.representative.width ?? 0,
    });

  const moveToChecks = async (item: CimmichKnownPersonClusterSuggestion) => {
    if (busyClusterId) {
      return;
    }
    busyClusterId = item.clusterId;
    error = '';
    try {
      const result = await resolveCimmichPossiblePerson(item.clusterId, {
        action: 'existing_person',
        commandId: `possible-person.known-review.${createCimmichUuid()}`,
        personId,
        snapshotDigest: item.snapshotDigest,
      });
      onChanged({ candidateCount: result.candidateCount ?? item.faceCount, clusterId: item.clusterId, kind: 'review' });
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : `Cimmich could not move this group to ${personName}’s checks.`;
    } finally {
      busyClusterId = '';
    }
  };

  const rejectMatch = async (item: CimmichKnownPersonClusterSuggestion) => {
    if (busyClusterId) {
      return;
    }
    busyClusterId = item.clusterId;
    error = '';
    try {
      await resolveCimmichPossiblePerson(item.clusterId, {
        action: 'not_suggested_person',
        commandId: `possible-person.known-reject.${createCimmichUuid()}`,
        snapshotDigest: item.snapshotDigest,
      });
      onChanged({ candidateCount: 0, clusterId: item.clusterId, kind: 'reject' });
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : `Cimmich could not reject the ${personName} match.`;
    } finally {
      busyClusterId = '';
    }
  };
</script>

{#if items.length > 0}
  <section
    class="grid gap-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/15"
    aria-labelledby="known-person-cluster-suggestions"
  >
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <h4 id="known-person-cluster-suggestions" class="font-semibold">Recurring groups matched to {personName}</h4>
        <span
          class="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-900 dark:text-violet-100"
        >
          {items.reduce((total, item) => total + item.evidence.photoCount, 0).toLocaleString()} photos
        </span>
      </div>
      <p class="mt-1 max-w-3xl text-xs/5 text-gray-600 dark:text-gray-300">
        Cimmich found these recurring groups in the unnamed archive and matched their representative Face to
        {personName}’s confirmed reference library. This is a grouped proposal only; no photo is identified until you
        move the group into Checks and confirm it.
      </p>
    </div>

    {#if error}
      <p class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">{error}</p>
    {/if}

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each items as item (item.clusterId)}
        <article
          class="overflow-hidden rounded-xl border border-violet-200 bg-white dark:border-violet-900 dark:bg-immich-dark-bg"
        >
          <a
            class="block aspect-square bg-gray-200 bg-no-repeat dark:bg-gray-800"
            href={`/photos/${item.representative.sourceAssetId}`}
            style={cropStyle(item)}
            aria-label={`Open representative photo for the possible ${personName} group`}
          ></a>
          <div class="grid gap-3 p-3">
            <div>
              <p class="font-semibold">
                {item.evidence.photoCount.toLocaleString()}
                {item.evidence.photoCount === 1 ? 'photo' : 'photos'} may be {personName}
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Similarity {item.match.leadScore.toFixed(3)}
                {item.match.margin === null
                  ? ' · no close competing Person'
                  : ` · ${item.match.margin.toFixed(3)} ahead`}
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="min-h-10 rounded-md bg-immich-primary px-3 text-xs font-semibold text-white disabled:opacity-40"
                type="button"
                disabled={Boolean(busyClusterId)}
                onclick={() => void moveToChecks(item)}
              >
                {busyClusterId === item.clusterId ? 'Saving…' : `Move to ${personName}’s Checks`}
              </button>
              <button
                class="min-h-10 rounded-md border border-gray-300 px-3 text-xs font-semibold disabled:opacity-40 dark:border-gray-600"
                type="button"
                disabled={Boolean(busyClusterId)}
                onclick={() => void rejectMatch(item)}
              >
                Not {personName}
              </button>
            </div>
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}
