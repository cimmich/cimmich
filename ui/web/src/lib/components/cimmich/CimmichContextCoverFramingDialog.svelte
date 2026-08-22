<script lang="ts">
  import { focusTrap } from '$lib/actions/focus-trap';
  import type { CimmichContextAsset, CimmichContextCoverCrop } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import {
    contextCoverCropFromFrame,
    contextCoverCropImageStyle,
    contextCoverFrameFromCrop,
    type CimmichContextCoverFrame,
  } from './context-cover-framing';

  interface Props {
    asset: CimmichContextAsset;
    crop: CimmichContextCoverCrop | null;
    entityName: string;
    onclose: () => void;
    onsave: (crop: CimmichContextCoverCrop) => void;
    saving?: boolean;
  }

  let { asset, crop, entityName, onclose, onsave, saving = false }: Props = $props();
  let frame = $state<CimmichContextCoverFrame>({ centerX: 50, centerY: 50, zoom: 1 });
  let shownAssetId = $state('');
  let drag = $state<{ pointerId: number; x: number; y: number } | null>(null);

  $effect(() => {
    if (asset.assetId !== shownAssetId) {
      shownAssetId = asset.assetId;
      frame = contextCoverFrameFromCrop(crop, asset.width, asset.height);
    }
  });

  const draftCrop = $derived(contextCoverCropFromFrame(frame, asset.width, asset.height));
  const imageStyle = $derived(contextCoverCropImageStyle(draftCrop));

  const adjust = (delta: Partial<CimmichContextCoverFrame>) => {
    frame = {
      centerX: Math.max(0, Math.min(100, frame.centerX + (delta.centerX ?? 0))),
      centerY: Math.max(0, Math.min(100, frame.centerY + (delta.centerY ?? 0))),
      zoom: Math.max(1, Math.min(4, frame.zoom + (delta.zoom ?? 0))),
    };
  };

  const startDrag = (event: PointerEvent) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const moveDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    adjust({
      centerX: (-(event.clientX - drag.x) / Math.max(1, bounds.width) / frame.zoom) * 100,
      centerY: (-(event.clientY - drag.y) / Math.max(1, bounds.height) / frame.zoom) * 100,
    });
    drag = { ...drag, x: event.clientX, y: event.clientY };
  };

  const endDrag = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
    }
  };

  const zoom = (event: WheelEvent) => {
    event.preventDefault();
    adjust({ zoom: event.deltaY < 0 ? 0.15 : -0.15 });
  };

  const keyFrame = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 5 : 2;
    const deltas: Record<string, Partial<CimmichContextCoverFrame>> = {
      '+': { zoom: 0.1 },
      '-': { zoom: -0.1 },
      '=': { zoom: 0.1 },
      ArrowDown: { centerY: step },
      ArrowLeft: { centerX: -step },
      ArrowRight: { centerX: step },
      ArrowUp: { centerY: -step },
    };
    const delta = deltas[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    adjust(delta);
  };
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
  role="presentation"
  onclick={(event) => event.currentTarget === event.target && !saving && onclose()}
  onkeydown={(event) => event.key === 'Escape' && !saving && onclose()}
>
  <div
    class="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-immich-dark-bg"
    role="dialog"
    aria-modal="true"
    aria-labelledby="context-cover-framing-title"
    use:focusTrap
  >
    <header class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
      <div>
        <h2 id="context-cover-framing-title" class="text-lg font-semibold">Frame hero for {entityName}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Drag the photo. Scroll or use the controls to zoom.</p>
      </div>
      <button
        class="grid size-10 shrink-0 place-items-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
        type="button"
        aria-label="Close"
        disabled={saving}
        onclick={onclose}
      >
        <Icon icon={mdiClose} size="20" />
      </button>
    </header>

    <div class="p-5">
      <div class="relative aspect-12/5 overflow-hidden rounded-2xl bg-slate-950 select-none">
        <button
          class={[
            'absolute inset-0 size-full touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
            drag ? 'cursor-grabbing' : 'cursor-grab',
          ]}
          type="button"
          aria-label="Hero framing editor. Drag the photo, use the mouse wheel to zoom, or use arrow and plus or minus keys."
          onpointerdown={startDrag}
          onpointermove={moveDrag}
          onpointerup={endDrag}
          onpointercancel={endDrag}
          onwheel={zoom}
          onkeydown={keyFrame}
        >
          <img
            class="pointer-events-none max-w-none"
            src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Preview })}
            style={imageStyle}
            alt=""
            draggable="false"
          />
        </button>
        <span
          class="pointer-events-none absolute top-3 left-3 rounded-lg bg-black/68 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur-sm"
          >Final hero</span
        >
        <div
          class="absolute right-3 bottom-3 z-10 flex items-center overflow-hidden rounded-lg border border-white/25 bg-black/72 text-white shadow-sm backdrop-blur-sm"
        >
          <button
            class="grid size-10 place-items-center text-lg hover:bg-white/15"
            type="button"
            aria-label="Zoom hero out"
            onclick={() => adjust({ zoom: -0.1 })}>−</button
          >
          <span class="min-w-14 px-1 text-center text-xs font-semibold">{frame.zoom.toFixed(1)}×</span>
          <button
            class="grid size-10 place-items-center text-lg hover:bg-white/15"
            type="button"
            aria-label="Zoom hero in"
            onclick={() => adjust({ zoom: 0.1 })}>+</button
          >
        </div>
      </div>
    </div>

    <footer class="flex flex-wrap justify-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-700">
      <button
        class="min-h-11 rounded-xl px-4 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
        type="button"
        disabled={saving}
        onclick={onclose}>Cancel</button
      >
      <button
        class="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-55"
        type="button"
        disabled={saving}
        onclick={() => onsave(draftCrop)}>{saving ? 'Saving…' : 'Save framing'}</button
      >
    </footer>
  </div>
</div>
