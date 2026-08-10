<script lang="ts">
  import { Route } from '$lib/route';
  import CimmichReviewPhotoMedia from './CimmichReviewPhotoMedia.svelte';
  import CimmichUnknownPersonAction from './CimmichUnknownPersonAction.svelte';
  import type { CimmichIdentityAuditCorrectionController } from './identity-audit-correction-controller.svelte';
  import type { CimmichPhotoReviewController } from './photo-review-controller.svelte';
  import type { CimmichPersonReviewItem, CimmichSamePhotoCollisionGroup } from './same-photo-collision-review';

  interface Props {
    correction: CimmichIdentityAuditCorrectionController;
    groups: CimmichSamePhotoCollisionGroup[];
    onChangePerson: (item: CimmichPersonReviewItem) => void;
    onConfirm: (item: CimmichPersonReviewItem) => void;
    onFixBoxLater: (item: CimmichPersonReviewItem) => void;
    onNotFace: (item: CimmichPersonReviewItem) => void;
    onUnknownChanged: (item: CimmichPersonReviewItem) => void;
    onUnknownError: (message: string) => void;
    onUnknownSaving: (item: CimmichPersonReviewItem, saving: boolean) => void;
    personId: string;
    personName: string;
    photoReview: CimmichPhotoReviewController;
    savingId: string;
  }

  let {
    correction,
    groups,
    onChangePerson,
    onConfirm,
    onFixBoxLater,
    onNotFace,
    onUnknownChanged,
    onUnknownError,
    onUnknownSaving,
    personId,
    personName,
    photoReview,
    savingId,
  }: Props = $props();

  const matchPercent = (score: number | null) =>
    score === null ? 'No comparable Face' : `${Math.round(score * 100)}%`;

  $effect(() => {
    void correction.preload(groups.flatMap(({ items }) => items));
  });
</script>

<section
  class="grid gap-4 rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/20"
  aria-labelledby="same-photo-collisions-heading"
>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <h4 id="same-photo-collisions-heading" class="font-semibold">Multiple matches in one photo</h4>
        <span
          class="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
        >
          {groups.length.toLocaleString()}
          {groups.length === 1 ? 'photo' : 'photos'}
        </span>
      </div>
      <p class="mt-1 max-w-3xl text-xs/5 text-amber-900/80 dark:text-amber-100/80">
        More than one Face region in the same photo points to {personName}, or another region is already confirmed as
        them. Compare every outlined Face with its closest known People. A collage or reflection can genuinely contain
        {personName} more than once, so every region stays visible, bulk confirmation is disabled here, and each decision
        remains manual.
      </p>
    </div>
  </div>
  <div class="grid gap-4">
    {#each groups as collision (collision.assetId)}
      {@const firstItem = collision.items[0]}
      {@const context = photoReview.context(collision.assetId)}
      <article
        class="overflow-hidden rounded-xl border border-amber-200 bg-white dark:border-amber-900 dark:bg-immich-dark-bg"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 px-3 py-2 dark:border-amber-900/70"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold">{firstItem?.filename || 'Photo'}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{firstItem ? photoReview.label(firstItem) : ''}</p>
          </div>
          <span class="text-xs font-semibold text-amber-800 dark:text-amber-200">
            {collision.items.length}
            {collision.items.length === 1 ? 'unresolved region' : 'competing regions'}
          </span>
        </div>
        <div class="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each collision.items as item (`collision:${item.faceId}`)}
            {@const closestMatches = correction.matchesFor(item)}
            <section
              class="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-black/10"
            >
              <CimmichReviewPhotoMedia
                busy={Boolean(savingId || photoReview.savingId)}
                contextLabel={`Face region · ${Math.round(item.suggestedPerson.score * 100)}% match`}
                filename={item.filename}
                href={item.sourceAssetId
                  ? Route.viewCimmichPersonAsset({
                      faceId: item.faceId,
                      id: item.sourceAssetId,
                      overlay: 'machinery',
                      personId,
                      personName,
                    })
                  : undefined}
                image={item}
                onRotate={(direction) => void photoReview.rotate(item.assetId, direction)}
                onUndo={context?.rotationDecisionId
                  ? () => void photoReview.undo(item.assetId, context.rotationDecisionId ?? '')
                  : undefined}
                rotationQuarterTurns={context?.rotationQuarterTurns ?? 0}
                sourceAssetId={item.sourceAssetId}
                targetAspect={1}
              />
              <div class="grid gap-2 p-3">
                <div>
                  <p class="text-sm font-semibold">Could this Face be {personName}?</p>
                  <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Match {item.suggestedPerson.score.toFixed(2)}
                    {item.samePhotoAcceptedCount ? ` · ${personName} is already confirmed elsewhere in this photo` : ''}
                  </p>
                </div>
                <div
                  class="grid gap-1.5 rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-black/20"
                >
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-[11px] font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                      Closest known People
                    </p>
                    <span class="text-[10px] text-gray-400">Comparison only</span>
                  </div>
                  {#if correction.loading(item)}
                    <p class="text-xs text-gray-500 dark:text-gray-400">Comparing this Face…</p>
                  {:else if closestMatches.length > 0}
                    <div class="grid gap-1">
                      {#each closestMatches as match (match.person_id)}
                        {@const comparisonSelected = correction.comparisonSelected(item, match.person_id)}
                        <div
                          class={`overflow-hidden rounded-md border ${
                            comparisonSelected
                              ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
                              : 'border-transparent'
                          }`}
                        >
                          <button
                            class="grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                            type="button"
                            aria-expanded={comparisonSelected}
                            disabled={Boolean(savingId)}
                            onclick={() => correction.toggleComparison(item, match.person_id)}
                          >
                            <span class="truncate font-semibold">
                              {match.display_name}
                              {match.person_id === item.suggestedPerson.personId ? ' · proposed' : ''}
                            </span>
                            <span class="text-gray-500 tabular-nums dark:text-gray-400">
                              {matchPercent(match.similarity ?? match.prime_score)}
                            </span>
                          </button>
                          {#if comparisonSelected}
                            <div
                              class="grid gap-2 border-t border-amber-200 p-2 dark:border-amber-800"
                              aria-label={`Confirm ${match.display_name}`}
                            >
                              <p class="text-[11px]/4 text-amber-900 dark:text-amber-100">
                                Apply this manual correction to this Face?
                              </p>
                              <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                <button
                                  class="min-h-9 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white disabled:opacity-40"
                                  type="button"
                                  disabled={Boolean(savingId)}
                                  onclick={() => onChangePerson(item)}
                                >
                                  {savingId === `change:${item.faceId}` ? 'Saving…' : correction.decision(item).label}
                                </button>
                                <button
                                  class="min-h-9 rounded-md px-3 text-xs font-semibold text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800"
                                  type="button"
                                  disabled={Boolean(savingId)}
                                  onclick={() => correction.closeComparison(item)}>Cancel</button
                                >
                              </div>
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                    <p class="text-[10px]/4 text-gray-500 dark:text-gray-400">
                      Select a name to confirm it here. Nothing changes until you press the inline action.
                    </p>
                  {:else}
                    <p class="text-xs text-gray-500 dark:text-gray-400">No compatible known Person comparison.</p>
                  {/if}
                </div>
                {#if item.kind === 'untagged_match'}
                  <button
                    class="min-h-10 rounded-md bg-immich-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    type="button"
                    disabled={Boolean(savingId)}
                    onclick={() => onConfirm(item)}
                  >
                    {savingId === `confirm:${item.faceId}` ? 'Saving…' : `Confirm ${personName}`}
                  </button>
                  <CimmichUnknownPersonAction
                    busy={Boolean(savingId)}
                    faceId={item.faceId}
                    onChanged={() => onUnknownChanged(item)}
                    onError={onUnknownError}
                    onSaving={(saving) => onUnknownSaving(item, saving)}
                  />
                {/if}
                <button
                  class="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-white disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"
                  type="button"
                  aria-expanded={correction.faceId === item.faceId}
                  disabled={Boolean(savingId)}
                  onclick={() => correction.toggle(item)}
                >
                  {correction.faceId === item.faceId ? 'Close correction' : 'Correct…'}
                </button>
                {#if correction.faceId === item.faceId}
                  <div
                    class="grid min-w-0 gap-2 rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-black/20"
                  >
                    <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">
                      Likely matches
                      <select
                        aria-label="Likely identity matches"
                        class="min-h-10 min-w-0 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white"
                        value={correction.decision(item).targetPersonId}
                        disabled={Boolean(savingId)}
                        onchange={(event) => correction.setTarget(item, event.currentTarget.value)}
                      >
                        {#if !correction.decision(item).targetPersonId}
                          <option value="">Choose a person</option>
                        {/if}
                        {#each correction.options(item) as option (option.personId)}
                          <option value={option.personId}>{option.label}</option>
                        {/each}
                      </select>
                    </label>
                    <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">
                      Someone else
                      <input
                        class="min-h-10 min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white"
                        value={correction.query(item)}
                        placeholder="Type a name"
                        disabled={Boolean(savingId)}
                        oninput={(event) => correction.setQuery(item, event.currentTarget.value)}
                      />
                    </label>
                    {#if correction.searchResults(item).length > 0}
                      <div class="grid gap-1" aria-label="Matching People">
                        {#each correction.searchResults(item) as person (person.person_id)}
                          <button
                            class="min-h-9 rounded-md bg-gray-50 px-3 text-left text-sm font-medium hover:bg-gray-100 dark:bg-immich-dark-gray dark:hover:bg-gray-700"
                            type="button"
                            onclick={() => correction.selectSearchResult(item, person.person_id, person.display_name)}
                          >
                            {person.display_name}
                          </button>
                        {/each}
                      </div>
                    {:else if correction.query(item).trim()}
                      <p class="text-xs text-gray-500">No matching Person. Try another spelling.</p>
                    {/if}
                    <button
                      class="min-h-10 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                      type="button"
                      disabled={Boolean(savingId) || !correction.decision(item).targetPersonId}
                      onclick={() => onChangePerson(item)}
                    >
                      {savingId === `change:${item.faceId}` ? 'Saving…' : correction.decision(item).label}
                    </button>
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        class="min-h-10 rounded-md border border-sky-300 bg-sky-50 px-2 text-sm font-semibold text-sky-800 disabled:opacity-40 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100"
                        type="button"
                        disabled={Boolean(savingId)}
                        onclick={() => onFixBoxLater(item)}
                      >
                        {savingId === `fix-box:${item.faceId}` ? 'Saving…' : 'Fix box later'}
                      </button>
                      <button
                        class="min-h-10 rounded-md border border-gray-300 px-2 text-sm font-semibold disabled:opacity-40 dark:border-gray-600"
                        type="button"
                        disabled={Boolean(savingId)}
                        onclick={() => onNotFace(item)}
                      >
                        {savingId === `not-face:${item.faceId}` ? 'Saving…' : 'Not a face'}
                      </button>
                    </div>
                    <div
                      class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2 dark:border-gray-700"
                    >
                      <button
                        class="min-h-9 rounded-md px-3 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                        type="button"
                        onclick={() => correction.toggle(item)}>Cancel</button
                      >
                      <a
                        class="min-h-9 rounded-md px-3 py-2 text-xs font-semibold text-immich-primary hover:bg-gray-100 dark:hover:bg-gray-800"
                        href={Route.viewCimmichPersonAsset({
                          faceId: item.faceId,
                          id: item.sourceAssetId,
                          overlay: 'machinery',
                          personId,
                          personName,
                        })}>Resize box now</a
                      >
                    </div>
                    {#if correction.loading(item)}
                      <p class="text-[11px] text-gray-500 dark:text-gray-400">Loading the closest matches…</p>
                    {/if}
                  </div>
                {/if}
              </div>
            </section>
          {/each}
        </div>
      </article>
    {/each}
  </div>
</section>
