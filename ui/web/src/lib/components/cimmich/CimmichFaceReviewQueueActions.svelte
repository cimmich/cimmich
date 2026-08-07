<script lang="ts">
  import type { CimmichFaceReviewReason } from '$lib/services/cimmich-deferred-face-review';

  interface Props {
    busy: boolean;
    disposition?: 'active' | 'later' | 'unknown';
    onSet: (disposition: 'later', reason?: CimmichFaceReviewReason) => void;
    reviewReason?: CimmichFaceReviewReason;
  }

  let { busy, disposition, onSet, reviewReason }: Props = $props();
</script>

{#if disposition === 'later'}
  <p class="col-span-2 rounded-sm bg-sky-400/15 px-2 py-1 text-sky-100">
    {reviewReason === 'geometry' ? 'Saved in Box fixes.' : 'Saved for later review.'}
  </p>
{:else if disposition === 'unknown'}
  <p class="col-span-2 rounded-sm bg-slate-400/15 px-2 py-1 text-slate-100">Marked as an unknown person.</p>
{/if}
<button
  class="min-h-11 w-full rounded-sm border border-white/20 px-3 font-semibold text-white/75 hover:bg-white/10 disabled:opacity-50"
  disabled={busy || disposition === 'later'}
  type="button"
  onclick={() => onSet('later')}>Review later</button
>
<button
  class="min-h-11 w-full rounded-sm border border-sky-300/45 bg-sky-400/10 px-3 font-semibold text-sky-100 hover:bg-sky-400/20 disabled:opacity-50"
  disabled={busy || (disposition === 'later' && reviewReason === 'geometry')}
  type="button"
  onclick={() => onSet('later', 'geometry')}>Fix box later</button
>
