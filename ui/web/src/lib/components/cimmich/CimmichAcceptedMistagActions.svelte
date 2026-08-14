<script lang="ts">
  import type { CimmichPersonReviewItem } from './same-photo-collision-review';

  let {
    busy = false,
    item,
    onBody,
    onFace,
    onHead,
    onNotFace,
    onUnknown,
    personName,
    saving = false,
  }: {
    busy?: boolean;
    item: CimmichPersonReviewItem;
    onBody: () => void;
    onFace: () => void;
    onHead: () => void;
    onNotFace: () => void;
    onUnknown: () => void;
    personName: string;
    saving?: boolean;
  } = $props();
</script>

<div
  class="col-span-2 grid min-w-0 grid-cols-3 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-black/10"
>
  <p class="col-span-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
    Keep {item.assignedPerson?.displayName ?? personName}; this box is
  </p>
  <button
    class="min-h-10 min-w-0 rounded-md border border-gray-300 bg-white p-2 text-sm/5 font-semibold whitespace-normal disabled:opacity-40 dark:border-gray-600 dark:bg-immich-dark-gray"
    type="button"
    disabled={busy}
    onclick={onFace}
  >
    {saving ? 'Saving…' : 'Face'}
  </button>
  <button
    class="min-h-10 min-w-0 rounded-md border border-cyan-300 bg-white p-2 text-sm/5 font-semibold whitespace-normal text-cyan-800 disabled:opacity-40 dark:border-cyan-800 dark:bg-immich-dark-gray dark:text-cyan-200"
    type="button"
    disabled={busy}
    onclick={onHead}
  >
    {saving ? 'Saving…' : 'Head'}
  </button>
  <button
    class="min-h-10 min-w-0 rounded-md border border-cyan-300 bg-white p-2 text-sm/5 font-semibold whitespace-normal text-cyan-800 disabled:opacity-40 dark:border-cyan-800 dark:bg-immich-dark-gray dark:text-cyan-200"
    type="button"
    disabled={busy || typeof item.currentRevision !== 'number'}
    title={typeof item.currentRevision === 'number'
      ? 'Keep this Person, save the same box as Body evidence, and retire the mistaken Face'
      : 'Reload this review before saving the box as Body'}
    onclick={onBody}
  >
    {saving ? 'Saving…' : 'Body'}
  </button>
  <button
    class="col-span-2 min-h-10 min-w-0 rounded-md border border-gray-300 bg-white p-2 text-sm/5 font-semibold whitespace-normal disabled:opacity-40 dark:border-gray-600 dark:bg-immich-dark-gray"
    type="button"
    disabled={busy || !item.assignedPerson?.identityClaimId}
    title={item.assignedPerson?.identityClaimId
      ? 'Remove the accepted identity and pause identity suggestions for this Face'
      : 'Reload this review before removing the accepted identity'}
    onclick={onUnknown}
  >
    {saving ? 'Saving…' : 'Unknown person'}
  </button>
  <button
    class="min-h-10 min-w-0 rounded-md border border-red-300 bg-white p-2 text-sm/5 font-semibold whitespace-normal text-red-700 disabled:opacity-40 dark:border-red-800 dark:bg-immich-dark-gray dark:text-red-200"
    type="button"
    disabled={busy || typeof item.currentRevision !== 'number'}
    title={typeof item.currentRevision === 'number'
      ? 'Reject this detection and retire its identity evidence'
      : 'Reload this review before marking the region as not a Face'}
    onclick={onNotFace}
  >
    {saving ? 'Saving…' : 'Not a face'}
  </button>
</div>
