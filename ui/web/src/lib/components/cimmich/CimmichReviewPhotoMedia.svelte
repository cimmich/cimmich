<script lang="ts">
  import {
    getCimmichAssetEvidence,
    getCimmichManualPresences,
    getCimmichManualSubjectTags,
    type CimmichAssetEvidence,
    type CimmichManualPresenceAssociation,
    type CimmichManualSubjectTag,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon, Modal, ModalBody } from '@immich/ui';
  import { mdiMagnifyPlusOutline, mdiRotateLeft, mdiRotateRight, mdiUndoVariant } from '@mdi/js';
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import CimmichIdentityReviewImage from './CimmichIdentityReviewImage.svelte';
  import {
    identityReviewSvgTransform,
    rotateIdentityReviewSource,
    type IdentityReviewCropSource,
  } from './identity-review-crop';

  type PreviewPeopleTag = {
    box: { h: number; w: number; x: number; y: number };
    id: string;
    label: string;
    source: 'body' | 'face' | 'imported' | 'manual';
  };

  interface Props {
    busy?: boolean;
    contextLabel: string;
    filename: string;
    href?: string;
    image: IdentityReviewCropSource;
    onRotate: (direction: 'left' | 'right') => void;
    onOpen?: () => void;
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
    onOpen,
    onToggle,
    onUndo,
    rotationQuarterTurns = 0,
    selected = false,
    sourceAssetId,
    targetAspect = 4 / 3,
  }: Props = $props();

  let previewOpen = $state(false);
  let previewEvidence = $state<CimmichAssetEvidence>();
  let previewManualTags = $state<CimmichManualSubjectTag[]>([]);
  let previewManualPresences = $state<CimmichManualPresenceAssociation[]>([]);
  let previewLoading = $state(false);
  let previewLoadError = $state('');
  let previewLoadGeneration = 0;
  let previewViewport = $state<HTMLElement>();
  let previewDragging = $state(false);
  let previewPan = { pointerId: -1, scrollLeft: 0, scrollTop: 0, x: 0, y: 0 };

  const normalizedRotation = $derived(((Math.trunc(rotationQuarterTurns) % 4) + 4) % 4);
  const rotatedPreview = $derived(rotateIdentityReviewSource(image, normalizedRotation));
  const previewTransform = $derived(identityReviewSvgTransform(image.width, image.height, normalizedRotation));
  const previewCanvasStyle = $derived(
    `width: max(100%, min(${rotatedPreview.width}px, 2400px)); aspect-ratio: ${rotatedPreview.width} / ${rotatedPreview.height};`,
  );

  const previewTags = $derived.by(() => {
    const tags: PreviewPeopleTag[] = [];
    const representedByFace = new SvelteSet<string>();
    const representedObservations = new SvelteSet<string>();
    const add = (
      id: string,
      label: string | null | undefined,
      box: PreviewPeopleTag['box'],
      source: PreviewPeopleTag['source'],
    ) => {
      if (label) {
        tags.push({ box, id, label, source });
      }
    };

    for (const face of previewEvidence?.faces ?? []) {
      if (!face.display_name) {
        continue;
      }
      add(
        `face:${face.face_id}`,
        face.display_name,
        { h: face.box_h, w: face.box_w, x: face.box_x, y: face.box_y },
        'face',
      );
      representedObservations.add(face.face_id);
      if (face.person_id) {
        representedByFace.add(face.person_id);
      }
    }

    for (const body of previewEvidence?.bodies ?? []) {
      if (!body.display_name || (body.person_id && representedByFace.has(body.person_id))) {
        continue;
      }
      add(
        `body:${body.body_id}`,
        body.display_name,
        { h: body.box_h, w: body.box_w, x: body.box_x, y: body.box_y },
        'body',
      );
    }

    for (const locator of previewEvidence?.identity_locators ?? []) {
      add(
        `imported:${locator.locator_id}`,
        locator.display_name,
        { h: locator.box_h, w: locator.box_w, x: locator.box_x, y: locator.box_y },
        'imported',
      );
    }

    for (const tag of previewManualTags) {
      if (!tag.geometry || (tag.observationId && representedObservations.has(tag.observationId))) {
        continue;
      }
      add(`manual:${tag.tagId}`, tag.subject.displayName, tag.geometry, 'manual');
    }

    for (const presence of previewManualPresences) {
      if (!presence.geometry) {
        continue;
      }
      const geometry =
        presence.geometry.kind === 'region'
          ? presence.geometry
          : {
              h: 0.03,
              w: 0.03,
              x: Math.max(0, Math.min(0.97, presence.geometry.x - 0.015)),
              y: Math.max(0, Math.min(0.97, presence.geometry.y - 0.015)),
            };
      add(`presence:${presence.associationId}`, presence.displayName, geometry, 'manual');
    }

    return tags;
  });

  const previewPresenceNames = $derived.by(() => {
    const spatialNames = new SvelteSet(previewTags.map((tag) => tag.label.toLocaleLowerCase()));
    const seen = new SvelteSet<string>();
    const names: string[] = [];
    for (const presence of [
      ...(previewEvidence?.presence ?? []).map((item) => item.display_name),
      ...previewManualPresences.filter((item) => item.geometry === null).map((item) => item.displayName),
    ]) {
      const key = presence.trim().toLocaleLowerCase();
      if (key && !spatialNames.has(key) && !seen.has(key)) {
        seen.add(key);
        names.push(presence);
      }
    }
    return names;
  });

  const previewTagStyle = (tag: PreviewPeopleTag) => {
    const rotated = rotateIdentityReviewSource(
      { box: tag.box, height: image.height, width: image.width },
      normalizedRotation,
    ).box;
    return `left: ${rotated.x * 100}%; top: ${rotated.y * 100}%; width: ${rotated.w * 100}%; height: ${rotated.h * 100}%;`;
  };

  const centerPreview = () => {
    if (!previewViewport) {
      return;
    }
    const target = rotatedPreview.box;
    previewViewport.scrollLeft =
      (target.x + target.w / 2) * previewViewport.scrollWidth - previewViewport.clientWidth / 2;
    previewViewport.scrollTop =
      (target.y + target.h / 2) * previewViewport.scrollHeight - previewViewport.clientHeight / 2;
  };

  const loadPreviewPeople = async (force = false) => {
    if ((!force && previewEvidence) || previewLoading) {
      return;
    }
    if (force) {
      previewEvidence = undefined;
      previewManualTags = [];
      previewManualPresences = [];
    }
    const generation = ++previewLoadGeneration;
    previewLoading = true;
    previewLoadError = '';
    try {
      const evidence = await getCimmichAssetEvidence(sourceAssetId);
      if (generation !== previewLoadGeneration) {
        return;
      }
      previewEvidence = evidence;
      const [manualTags, manualPresences] = await Promise.allSettled([
        getCimmichManualSubjectTags(evidence.asset_id),
        getCimmichManualPresences(evidence.asset_id),
      ]);
      if (generation !== previewLoadGeneration) {
        return;
      }
      previewManualTags = manualTags.status === 'fulfilled' ? manualTags.value.items : [];
      previewManualPresences = manualPresences.status === 'fulfilled' ? manualPresences.value.items : [];
      if (manualTags.status === 'rejected' || manualPresences.status === 'rejected') {
        previewLoadError = 'Some saved People tags are unavailable';
      }
    } catch (error) {
      if (generation === previewLoadGeneration) {
        previewLoadError = error instanceof Error ? error.message : 'People tags are unavailable';
      }
    } finally {
      if (generation === previewLoadGeneration) {
        previewLoading = false;
      }
    }
  };

  const openPreview = async () => {
    previewOpen = true;
    void loadPreviewPeople();
    await tick();
    requestAnimationFrame(centerPreview);
  };

  const startPreviewPan = (event: PointerEvent) => {
    if (!previewViewport || event.button !== 0) {
      return;
    }
    previewDragging = true;
    previewPan = {
      pointerId: event.pointerId,
      scrollLeft: previewViewport.scrollLeft,
      scrollTop: previewViewport.scrollTop,
      x: event.clientX,
      y: event.clientY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const movePreviewPan = (event: PointerEvent) => {
    if (!previewViewport || !previewDragging || event.pointerId !== previewPan.pointerId) {
      return;
    }
    event.preventDefault();
    previewViewport.scrollLeft = previewPan.scrollLeft - (event.clientX - previewPan.x);
    previewViewport.scrollTop = previewPan.scrollTop - (event.clientY - previewPan.y);
  };

  const stopPreviewPan = (event: PointerEvent) => {
    if (!previewViewport || event.pointerId !== previewPan.pointerId) {
      return;
    }
    const captureTarget = event.currentTarget as HTMLElement;
    if (captureTarget.hasPointerCapture(event.pointerId)) {
      captureTarget.releasePointerCapture(event.pointerId);
    }
    previewDragging = false;
  };

  const movePreviewWithKeyboard = (event: KeyboardEvent) => {
    if (!previewViewport || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const distance = event.shiftKey ? 240 : 80;
    previewViewport.scrollBy({
      left: event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0,
      top: event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0,
    });
  };
</script>

<div class="relative overflow-hidden bg-gray-200" style={`aspect-ratio: ${targetAspect}`}>
  <a {href} class="absolute inset-0 block" aria-label={`Open ${filename}`} onclick={onOpen}>
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
      aria-haspopup="dialog"
      aria-label={`Preview ${filename} with context`}
      disabled={busy}
      onclick={() => void openPreview()}><Icon icon={mdiMagnifyPlusOutline} size="17" /></button
    >
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

{#if previewOpen}
  <Modal title={filename} icon={mdiMagnifyPlusOutline} size="full" onClose={() => (previewOpen = false)}>
    <ModalBody class="flex min-h-0 grow overflow-hidden bg-black p-0!">
      <div
        bind:this={previewViewport}
        class="size-full overflow-auto overscroll-contain bg-black select-none"
        role="region"
        aria-label={`${filename} large preview. Drag, scroll, or use the arrow keys to move around the photo.`}
      >
        <div
          class="relative shrink-0 overflow-hidden bg-black"
          style={previewCanvasStyle}
          data-testid="cimmich-large-photo-preview-canvas"
        >
          <svg
            class="absolute inset-0 size-full"
            viewBox={`0 0 ${rotatedPreview.width} ${rotatedPreview.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={filename}
          >
            <image
              href={getAssetMediaUrl({ id: sourceAssetId, size: AssetMediaSize.Fullsize })}
              width={image.width}
              height={image.height}
              transform={previewTransform}
              preserveAspectRatio="none"
            />
          </svg>

          <button
            class={[
              'absolute inset-0 z-10 size-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-300',
              previewDragging ? 'cursor-grabbing' : 'cursor-grab',
            ]}
            style="touch-action: none;"
            type="button"
            aria-label={`Move around ${filename}`}
            onkeydown={movePreviewWithKeyboard}
            onpointerdown={startPreviewPan}
            onpointermove={movePreviewPan}
            onpointerup={stopPreviewPan}
            onpointercancel={stopPreviewPan}
          ></button>

          <div class="pointer-events-none absolute inset-0 z-20" data-testid="cimmich-preview-people-tags">
            {#each previewTags as tag (tag.id)}
              <div
                class="absolute border-2 border-cyan-300/90 shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
                class:border-dashed={tag.source !== 'face'}
                style={previewTagStyle(tag)}
                title={`${tag.label} · already tagged`}
              >
                <span
                  class="absolute -top-1 left-0 max-w-44 -translate-y-full truncate rounded-sm bg-black/82 px-2 py-1 text-xs font-semibold text-white shadow-lg"
                  >{tag.label}</span
                >
              </div>
            {/each}
          </div>

          {#if previewPresenceNames.length > 0}
            <div class="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap justify-center gap-2">
              {#each previewPresenceNames as name (name)}
                <span
                  class="rounded-full border border-white/25 bg-black/78 px-3 py-2 text-xs font-semibold text-white shadow-lg"
                  >{name}</span
                >
              {/each}
            </div>
          {/if}

          {#if previewLoadError}
            <div class="absolute top-4 left-4 z-30 rounded-md bg-black/78 px-3 py-2 text-xs text-white/80" role="alert">
              <p>{previewLoadError}</p>
              <button
                class="mt-2 min-h-10 rounded-full px-3 font-semibold ring-1 ring-white/70"
                type="button"
                onclick={() => void loadPreviewPeople(true)}>Try again</button
              >
            </div>
          {/if}
          <span class="sr-only" aria-live="polite">{previewLoading ? 'Loading saved People tags' : ''}</span>
        </div>
      </div>
    </ModalBody>
  </Modal>
{/if}
