<script lang="ts">
  import { Route } from '$lib/route';
  import CimmichReviewPhotoMedia from './CimmichReviewPhotoMedia.svelte';
  import CimmichUnknownPersonAction from './CimmichUnknownPersonAction.svelte';
  import type { CimmichPhotoReviewController } from './photo-review-controller.svelte';
  import type { CimmichPersonReviewItem, CimmichSamePhotoCollisionGroup } from './same-photo-collision-review';

  interface Props {
    groups: CimmichSamePhotoCollisionGroup[];
    onConfirm: (item: CimmichPersonReviewItem) => void;
    onUnknownChanged: (item: CimmichPersonReviewItem) => void;
    onUnknownError: (message: string) => void;
    onUnknownSaving: (item: CimmichPersonReviewItem, saving: boolean) => void;
    personId: string;
    personName: string;
    photoReview: CimmichPhotoReviewController;
    savingId: string;
  }

  let {
    groups,
    onConfirm,
    onUnknownChanged,
    onUnknownError,
    onUnknownSaving,
    personId,
    personName,
    photoReview,
    savingId,
  }: Props = $props();
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
        them. Review every outlined Face together; bulk confirmation is disabled here.
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
                <a
                  class="min-h-10 rounded-md border border-gray-300 px-3 py-2 text-center text-sm font-semibold hover:bg-white dark:border-gray-600 dark:hover:bg-gray-800"
                  href={Route.viewCimmichPersonAsset({
                    faceId: item.faceId,
                    id: item.sourceAssetId,
                    overlay: 'machinery',
                    personId,
                    personName,
                  })}>Someone else, not a Face, or fix box</a
                >
              </div>
            </section>
          {/each}
        </div>
      </article>
    {/each}
  </div>
</section>
