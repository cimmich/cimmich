<script lang="ts">
  import {
    resolveCimmichPossiblePerson,
    type CimmichKnownPersonClusterSuggestion,
  } from '$lib/services/possible-people.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { cimmichSquareCropBackgroundStyle, cimmichSquareCropFrame } from '$lib/utils/cimmich-crop';
  import { createCimmichUuid } from '$lib/utils/cimmich-uuid';
  import { AssetMediaSize } from '@immich/sdk';

  interface Props {
    items: CimmichKnownPersonClusterSuggestion[];
    onChanged?: (input: {
      candidateCount: number;
      clusterId: string;
      collisionAssetCount: number;
      collisionFaceCount: number;
      kind: 'review' | 'reject' | 'ungroup';
    }) => void;
    personId: string;
    personName: string;
  }

  let { items, onChanged = () => undefined, personId, personName }: Props = $props();
  let busyClusterId = $state('');
  let error = $state('');
  let confirmUngroupClusterId = $state('');
  let previewIndexes = $state<Record<string, number>>({});

  type Preview = CimmichKnownPersonClusterSuggestion['representative'];

  const previewsFor = (item: CimmichKnownPersonClusterSuggestion): Preview[] =>
    item.previews.length > 0 ? item.previews : [item.representative];
  const previewIndexFor = (item: CimmichKnownPersonClusterSuggestion) =>
    Math.min(previewIndexes[item.clusterId] ?? 0, previewsFor(item).length - 1);
  const previewFor = (item: CimmichKnownPersonClusterSuggestion) => previewsFor(item)[previewIndexFor(item)];

  const cropStyle = (preview: Preview) =>
    cimmichSquareCropBackgroundStyle({
      boxH: preview.box.h,
      boxW: preview.box.w,
      boxX: preview.box.x,
      boxY: preview.box.y,
      height: preview.height ?? 0,
      padding: 4,
      url: getAssetMediaUrl({ id: preview.sourceAssetId, size: AssetMediaSize.Preview }),
      width: preview.width ?? 0,
    });

  const faceMarkerStyle = (preview: Preview) => {
    const { box } = preview;
    const frame = cimmichSquareCropFrame({
      boxH: box.h,
      boxW: box.w,
      boxX: box.x,
      boxY: box.y,
      height: preview.height ?? 0,
      padding: 4,
      width: preview.width ?? 0,
    });
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    const diameter = Math.min(96, Math.max(box.w / frame.cropW, box.h / frame.cropH) * 1.18 * 100);
    const left = ((centerX - frame.cropX) * 100) / frame.cropW - diameter / 2;
    const top = ((centerY - frame.cropY) * 100) / frame.cropH - diameter / 2;
    return [
      `height: ${diameter}%`,
      `left: ${Math.max(0, Math.min(100 - diameter, left))}%`,
      `top: ${Math.max(0, Math.min(100 - diameter, top))}%`,
      `width: ${diameter}%`,
    ].join('; ');
  };

  const movePreview = (item: CimmichKnownPersonClusterSuggestion, direction: -1 | 1) => {
    const count = previewsFor(item).length;
    previewIndexes = {
      ...previewIndexes,
      [item.clusterId]: (previewIndexFor(item) + direction + count) % count,
    };
  };

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
      onChanged({
        candidateCount: result.candidateCount ?? item.faceCount,
        clusterId: item.clusterId,
        collisionAssetCount: result.collisionAssetCount ?? 0,
        collisionFaceCount: result.collisionFaceCount ?? 0,
        kind: 'review',
      });
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
      onChanged({
        candidateCount: 0,
        clusterId: item.clusterId,
        collisionAssetCount: 0,
        collisionFaceCount: 0,
        kind: 'reject',
      });
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : `Cimmich could not reject the ${personName} match.`;
    } finally {
      busyClusterId = '';
    }
  };

  const ungroup = async (item: CimmichKnownPersonClusterSuggestion) => {
    if (busyClusterId) {
      return;
    }
    busyClusterId = item.clusterId;
    error = '';
    try {
      await resolveCimmichPossiblePerson(item.clusterId, {
        action: 'ungroup',
        commandId: `possible-person.ungroup.${createCimmichUuid()}`,
        snapshotDigest: item.snapshotDigest,
      });
      confirmUngroupClusterId = '';
      onChanged({
        candidateCount: 0,
        clusterId: item.clusterId,
        collisionAssetCount: 0,
        collisionFaceCount: 0,
        kind: 'ungroup',
      });
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Cimmich could not ungroup these photos.';
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
        Cimmich compared Face evidence distributed across each recurring group with {personName}’s confirmed reference
        library. A group appears here only when multiple sampled Faces agree, at least half of the sample matches, and
        no other known Person wins a sampled Face. This is still a proposal; no photo is identified until you move the
        group into Checks and confirm it.
      </p>
    </div>

    {#if error}
      <p class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">{error}</p>
    {/if}

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each items as item (item.clusterId)}
        {@const previews = previewsFor(item)}
        {@const previewIndex = previewIndexFor(item)}
        {@const preview = previewFor(item)}
        <article
          class="overflow-hidden rounded-xl border border-violet-200 bg-white dark:border-violet-900 dark:bg-immich-dark-bg"
        >
          <div class="relative aspect-square overflow-hidden bg-gray-200 dark:bg-gray-800">
            <a
              class="block size-full bg-no-repeat"
              href={`/photos/${preview.sourceAssetId}?cimmichFaceId=${encodeURIComponent(preview.faceId)}&cimmichOverlay=machinery`}
              style={cropStyle(preview)}
              aria-label={`Open evidence photo ${previewIndex + 1} for the possible ${personName} group`}
              data-testid="known-cluster-preview"
            >
              <span
                class="pointer-events-none absolute rounded-full border-2 border-dotted border-white/95 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_0_12px_rgba(0,0,0,0.35)]"
                style={faceMarkerStyle(preview)}
                data-testid="known-cluster-face-marker"
                aria-hidden="true"
              ></span>
            </a>
            {#if previews.length > 1}
              <button
                class="absolute top-1/2 left-2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-xl text-white hover:bg-black/80"
                type="button"
                aria-label={`Previous evidence photo for ${personName}`}
                onclick={() => movePreview(item, -1)}>←</button
              >
              <button
                class="absolute top-1/2 right-2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-xl text-white hover:bg-black/80"
                type="button"
                aria-label={`Next evidence photo for ${personName}`}
                onclick={() => movePreview(item, 1)}>→</button
              >
              <span
                class="absolute right-2 bottom-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white"
              >
                {previewIndex + 1} of {previews.length}
              </span>
            {/if}
          </div>
          <div class="grid gap-3 p-3">
            <div>
              <p class="font-semibold">
                {item.evidence.photoCount.toLocaleString()}
                {item.evidence.photoCount === 1 ? 'photo' : 'photos'} may be {personName}
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {item.match.matchedFaceCount} of {item.match.sampledFaceCount} sampled Faces agree · average similarity
                {item.match.leadScore.toFixed(3)}
                {item.match.margin === null
                  ? ' · no close competing Person'
                  : ` · average ${item.match.margin.toFixed(3)} ahead`}
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
            {#if confirmUngroupClusterId === item.clusterId}
              <div class="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <p>
                  Reject this exact grouping? The photos stay unassigned and may reappear only if a later Refresh forms
                  a different group.
                </p>
                <div class="flex flex-wrap gap-2">
                  <button
                    class="min-h-9 rounded-md bg-amber-700 px-3 font-semibold text-white disabled:opacity-40"
                    type="button"
                    disabled={Boolean(busyClusterId)}
                    onclick={() => void ungroup(item)}
                  >
                    {busyClusterId === item.clusterId ? 'Ungrouping…' : 'Ungroup these photos'}
                  </button>
                  <button
                    class="min-h-9 rounded-md border border-amber-300 px-3 font-semibold"
                    type="button"
                    disabled={Boolean(busyClusterId)}
                    onclick={() => (confirmUngroupClusterId = '')}>Keep grouped</button
                  >
                </div>
              </div>
            {:else}
              <button
                class="min-h-9 justify-self-start text-xs font-semibold text-gray-600 underline-offset-2 hover:underline dark:text-gray-300"
                type="button"
                disabled={Boolean(busyClusterId)}
                onclick={() => (confirmUngroupClusterId = item.clusterId)}>Ungroup…</button
              >
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}
