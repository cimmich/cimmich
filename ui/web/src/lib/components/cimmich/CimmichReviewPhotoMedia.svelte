<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiRotateLeft, mdiRotateRight, mdiUndoVariant } from '@mdi/js';
  import CimmichIdentityReviewImage from './CimmichIdentityReviewImage.svelte';
  import type { IdentityReviewCropSource } from './identity-review-crop';

  interface Props {
    busy?: boolean;
    contextLabel: string;
    filename: string;
    href?: string;
    image: IdentityReviewCropSource;
    onRotate: (direction: 'left' | 'right') => void;
    onToggle?: (event: MouseEvent) => void;
    onUndo?: () => void;
    rotationQuarterTurns?: number;
    selected?: boolean;
    sourceAssetId: string;
    targetAspect?: number;
  }

  let {
    busy = false,
    contextLabel,
    filename,
    href,
    image,
    onRotate,
    onToggle,
    onUndo,
    rotationQuarterTurns = 0,
    selected = false,
    sourceAssetId,
    targetAspect = 4 / 3,
  }: Props = $props();
</script>

<div class="relative overflow-hidden bg-gray-200" style={`aspect-ratio: ${targetAspect}`}>
  <a {href} class="absolute inset-0 block" aria-label={`Open ${filename}`}>
    <CimmichIdentityReviewImage
      alt={filename}
      item={image}
      {rotationQuarterTurns}
      src={getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Preview })}
      {targetAspect}
    />
  </a>
  <span
    class="absolute bottom-2 left-2 max-w-[calc(100%-7rem)] truncate rounded-sm bg-black/70 px-2 py-1 text-[11px] font-semibold text-white"
    title="Date and place come from current archive metadata and may need correction.">{contextLabel || filename}</span
  >
  {#if onToggle}
    <label
      class="absolute top-2 right-2 grid size-10 cursor-pointer place-items-center rounded-full bg-black/70 shadow-sm"
    >
      <span class="sr-only">Select {filename}</span>
      <input
        class="size-5 accent-immich-primary"
        type="checkbox"
        checked={selected}
        disabled={busy}
        onclick={onToggle}
      />
    </label>
  {/if}
  <div class="absolute right-2 bottom-2 flex items-center gap-1">
    <button
      class="grid size-8 place-items-center rounded-full bg-black/70 text-white disabled:opacity-40"
      type="button"
      aria-label={`Rotate ${filename} left`}
      disabled={busy}
      onclick={() => onRotate('left')}><Icon icon={mdiRotateLeft} size="17" /></button
    >
    <button
      class="grid size-8 place-items-center rounded-full bg-black/70 text-white disabled:opacity-40"
      type="button"
      aria-label={`Rotate ${filename} right`}
      disabled={busy}
      onclick={() => onRotate('right')}><Icon icon={mdiRotateRight} size="17" /></button
    >
    {#if onUndo}
      <button
        class="grid size-8 place-items-center rounded-full bg-black/70 text-white disabled:opacity-40"
        type="button"
        aria-label={`Undo rotation for ${filename}`}
        disabled={busy}
        onclick={onUndo}><Icon icon={mdiUndoVariant} size="17" /></button
      >
    {/if}
  </div>
</div>
