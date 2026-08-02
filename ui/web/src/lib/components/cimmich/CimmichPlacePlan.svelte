<script lang="ts">
  import {
    type CimmichContextEntity,
    type CimmichPlacePlan,
    type CimmichPlacePlanGeometry,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiCheck,
    mdiClose,
    mdiFloorPlan,
    mdiImageOutline,
    mdiPencilOutline,
    mdiPlus,
    mdiSatelliteVariant,
  } from '@mdi/js';
  import CimmichPlanSatellite from './CimmichPlanSatellite.svelte';
  import { contextPlaceMapProjection } from './context-entity-presentation';

  type DraftItem = {
    childEntityId: string;
    childName: string;
    geometry: CimmichPlacePlanGeometry;
    zIndex: number;
  };

  interface Props {
    children: CimmichContextEntity[];
    coverSourceAssetId?: string | null;
    onOpenPlace: (child: CimmichContextEntity) => void;
    onSave: (input: {
      backgroundKind: CimmichPlacePlan['backgroundKind'];
      backgroundSourceAssetId: string | null;
      displayName: string;
      expectedRevision: number;
      isDefault: boolean;
      items: Array<{ childEntityId: string; geometry: CimmichPlacePlanGeometry; zIndex: number }>;
      planId: string | null;
      planKind: CimmichPlacePlan['planKind'];
    }) => Promise<void>;
    parent: CimmichContextEntity;
    plans: CimmichPlacePlan[];
  }

  let { children, coverSourceAssetId = null, onOpenPlace, onSave, parent, plans }: Props = $props();
  let activePlanId = $state('');
  let editing = $state(false);
  let draftName = $state('');
  let draftKind = $state<CimmichPlacePlan['planKind']>('property');
  let draftBackgroundKind = $state<CimmichPlacePlan['backgroundKind']>('blank');
  let draftBackgroundSourceAssetId = $state<string | null>(null);
  let draftItems = $state<DraftItem[]>([]);
  let draftPlanId = $state<string | null>(null);
  let draftRevision = $state(0);
  let draftDefault = $state(false);
  let selectedChildId = $state('');
  let saving = $state(false);
  let saveError = $state('');
  let drag = $state<{
    childEntityId: string;
    kind: 'move' | 'resize';
    pointerX: number;
    pointerY: number;
    rect: Extract<CimmichPlacePlanGeometry, { kind: 'rect' }>;
  } | null>(null);
  let canvas = $state<HTMLDivElement>();

  const activePlan = $derived(plans.find((plan) => plan.planId === activePlanId) ?? plans[0] ?? null);
  const visibleItems = $derived(editing ? draftItems : (activePlan?.items ?? []));
  const visibleBackground = $derived(
    editing ? draftBackgroundSourceAssetId : (activePlan?.backgroundSourceAssetId ?? null),
  );
  const visibleBackgroundKind = $derived(editing ? draftBackgroundKind : (activePlan?.backgroundKind ?? 'blank'));
  const satelliteAvailable = $derived.by(() => {
    const projection = contextPlaceMapProjection([parent]);
    return projection.markers.length + projection.areas.length > 0;
  });
  const placedIds = $derived(new Set(visibleItems.map((item) => item.childEntityId)));
  const unplacedChildren = $derived(children.filter((child) => !placedIds.has(child.entityId)));

  $effect(() => {
    if (plans.length > 0 && !plans.some((plan) => plan.planId === activePlanId)) {
      activePlanId = plans.find((plan) => plan.isDefault)?.planId ?? plans[0]?.planId ?? '';
    }
  });

  const startNew = (
    kind: CimmichPlacePlan['planKind'],
    backgroundKind: CimmichPlacePlan['backgroundKind'] = 'blank',
  ) => {
    draftPlanId = null;
    draftRevision = 0;
    draftName = kind === 'floor' ? 'Ground floor' : kind === 'outdoor' ? 'Yard' : 'Property';
    draftKind = kind;
    draftBackgroundKind = backgroundKind;
    draftBackgroundSourceAssetId = backgroundKind === 'asset' ? coverSourceAssetId : null;
    draftItems = [];
    draftDefault = plans.length === 0;
    selectedChildId = '';
    saveError = '';
    editing = true;
  };

  const editPlan = () => {
    if (!activePlan) {
      return;
    }
    draftPlanId = activePlan.planId;
    draftRevision = activePlan.revision;
    draftName = activePlan.displayName;
    draftKind = activePlan.planKind;
    draftBackgroundKind = activePlan.backgroundKind;
    draftBackgroundSourceAssetId = activePlan.backgroundSourceAssetId;
    draftItems = activePlan.items.map((item) => ({
      childEntityId: item.childEntityId,
      childName: item.childName,
      geometry: structuredClone(item.geometry),
      zIndex: item.zIndex,
    }));
    draftDefault = activePlan.isDefault;
    selectedChildId = '';
    saveError = '';
    editing = true;
  };

  const cancelEdit = () => {
    editing = false;
    selectedChildId = '';
    drag = null;
    saveError = '';
  };

  const addChild = (child: CimmichContextEntity) => {
    if (placedIds.has(child.entityId)) {
      return;
    }
    const index = draftItems.length;
    const column = index % 3;
    const row = Math.floor(index / 3) % 3;
    draftItems = [
      ...draftItems,
      {
        childEntityId: child.entityId,
        childName: child.displayName,
        geometry: { h: 0.2, kind: 'rect', w: 0.26, x: 0.06 + column * 0.31, y: 0.08 + row * 0.28 },
        zIndex: index,
      },
    ];
    selectedChildId = child.entityId;
  };

  const removeSelected = () => {
    if (!selectedChildId) {
      return;
    }
    draftItems = draftItems.filter((item) => item.childEntityId !== selectedChildId);
    selectedChildId = '';
  };

  const clamp = (number: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, number));

  const beginDrag = (event: PointerEvent, item: DraftItem, kind: 'move' | 'resize') => {
    if (!editing || item.geometry.kind !== 'rect') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectedChildId = item.childEntityId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      childEntityId: item.childEntityId,
      kind,
      pointerX: event.clientX,
      pointerY: event.clientY,
      rect: { ...item.geometry },
    };
  };

  const continueDrag = (event: PointerEvent) => {
    if (!drag || !canvas) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const dx = (event.clientX - drag.pointerX) / bounds.width;
    const dy = (event.clientY - drag.pointerY) / bounds.height;
    draftItems = draftItems.map((item) => {
      if (item.childEntityId !== drag?.childEntityId || item.geometry.kind !== 'rect') {
        return item;
      }
      const geometry =
        drag.kind === 'move'
          ? {
              ...drag.rect,
              x: clamp(drag.rect.x + dx, 0, 1 - drag.rect.w),
              y: clamp(drag.rect.y + dy, 0, 1 - drag.rect.h),
            }
          : {
              ...drag.rect,
              h: clamp(drag.rect.h + dy, 0.08, 1 - drag.rect.y),
              w: clamp(drag.rect.w + dx, 0.1, 1 - drag.rect.x),
            };
      return { ...item, geometry };
    });
  };

  const finishDrag = () => (drag = null);

  const itemStyle = (geometry: CimmichPlacePlanGeometry) => {
    if (geometry.kind === 'rect') {
      return `left:${geometry.x * 100}%;top:${geometry.y * 100}%;width:${geometry.w * 100}%;height:${geometry.h * 100}%`;
    }
    if (geometry.kind === 'point') {
      return `left:${geometry.x * 100}%;top:${geometry.y * 100}%;width:2.75rem;height:2.75rem;transform:translate(-50%,-50%)`;
    }
    const xs = geometry.points.map((point) => point.x);
    const ys = geometry.points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left || 0.01;
    const height = Math.max(...ys) - top || 0.01;
    const polygon = geometry.points
      .map((point) => `${((point.x - left) / width) * 100}% ${((point.y - top) / height) * 100}%`)
      .join(',');
    return `left:${left * 100}%;top:${top * 100}%;width:${width * 100}%;height:${height * 100}%;clip-path:polygon(${polygon})`;
  };

  const save = async () => {
    if (!draftName.trim() || saving) {
      return;
    }
    saving = true;
    saveError = '';
    try {
      await onSave({
        backgroundKind: draftBackgroundKind,
        backgroundSourceAssetId: draftBackgroundSourceAssetId,
        displayName: draftName.trim(),
        expectedRevision: draftRevision,
        isDefault: draftDefault,
        items: draftItems.map(({ childEntityId, geometry, zIndex }) => ({ childEntityId, geometry, zIndex })),
        planId: draftPlanId,
        planKind: draftKind,
      });
      editing = false;
      selectedChildId = '';
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'The Plan could not be saved.';
    } finally {
      saving = false;
    }
  };
</script>

<section class="place-plan" aria-labelledby="place-plan-title">
  <header class="place-plan__header">
    <div class="place-plan__identity">
      <span><Icon icon={mdiFloorPlan} size="22" /></span>
      <div>
        <h2 id="place-plan-title">Plans</h2>
        <p>{parent.displayName}</p>
      </div>
    </div>
    {#if !editing}
      <div class="place-plan__header-actions">
        {#if activePlan}<button type="button" onclick={editPlan}><Icon icon={mdiPencilOutline} size="17" /> Edit</button
          >{/if}
        <button
          class="place-plan__primary"
          type="button"
          onclick={() =>
            startNew(satelliteAvailable ? 'property' : 'floor', satelliteAvailable ? 'satellite' : 'blank')}
        >
          <Icon icon={mdiPlus} size="18" /> New plan
        </button>
      </div>
    {/if}
  </header>

  {#if !editing && plans.length > 0}
    <div class="place-plan__tabs" role="tablist" aria-label="Plans for this Location">
      {#each plans as plan (plan.planId)}
        <button
          type="button"
          role="tab"
          aria-selected={activePlan?.planId === plan.planId}
          class:place-plan__tab--active={activePlan?.planId === plan.planId}
          onclick={() => (activePlanId = plan.planId)}>{plan.displayName}</button
        >
      {/each}
    </div>
  {/if}

  {#if !editing && plans.length === 0}
    <div class="place-plan__empty">
      <span><Icon icon={mdiFloorPlan} size="34" /></span>
      <h3>Make the first plan</h3>
      <div class="place-plan__starts">
        {#if satelliteAvailable}
          <button class="place-plan__start--primary" type="button" onclick={() => startNew('property', 'satellite')}>
            <Icon icon={mdiSatelliteVariant} size="21" /><strong>Use satellite</strong><small
              >Start from this Location</small
            >
          </button>
        {/if}
        <button type="button" onclick={() => startNew('property')}>
          <Icon icon={mdiPlus} size="20" /><strong>Blank property</strong><small>House and yard</small>
        </button>
        <button type="button" onclick={() => startNew('floor')}>
          <Icon icon={mdiFloorPlan} size="20" /><strong>Blank floor</strong><small>Rooms and spaces</small>
        </button>
        {#if coverSourceAssetId}<button type="button" onclick={() => startNew('property', 'asset')}>
            <Icon icon={mdiImageOutline} size="20" /><strong>Use cover photo</strong><small
              >Arrange over the image</small
            >
          </button>{/if}
      </div>
    </div>
  {:else}
    {#if editing}
      <div class="place-plan__editor-bar">
        <label>
          <span>Plan name</span>
          <input bind:value={draftName} maxlength="120" placeholder="Ground floor" />
        </label>
        <label>
          <span>Kind</span>
          <select bind:value={draftKind}>
            <option value="property">Property</option>
            <option value="floor">Floor</option>
            <option value="outdoor">Outdoor</option>
            <option value="other">Other</option>
          </select>
        </label>
        {#if satelliteAvailable}
          <button
            class:place-plan__background-toggle--active={draftBackgroundKind === 'satellite'}
            type="button"
            aria-pressed={draftBackgroundKind === 'satellite'}
            onclick={() => {
              draftBackgroundKind = 'satellite';
              draftBackgroundSourceAssetId = null;
            }}><Icon icon={mdiSatelliteVariant} size="17" /> Satellite</button
          >
        {/if}
        {#if coverSourceAssetId}
          <button
            class:place-plan__background-toggle--active={draftBackgroundKind === 'asset'}
            type="button"
            aria-pressed={draftBackgroundKind === 'asset'}
            onclick={() => {
              draftBackgroundKind = 'asset';
              draftBackgroundSourceAssetId = coverSourceAssetId;
            }}><Icon icon={mdiImageOutline} size="17" /> Cover photo</button
          >
        {/if}
        <button
          class:place-plan__background-toggle--active={draftBackgroundKind === 'blank'}
          type="button"
          aria-pressed={draftBackgroundKind === 'blank'}
          onclick={() => {
            draftBackgroundKind = 'blank';
            draftBackgroundSourceAssetId = null;
          }}><Icon icon={mdiPlus} size="17" /> Blank</button
        >
        <div class="place-plan__save-actions">
          <button type="button" disabled={saving} onclick={cancelEdit}><Icon icon={mdiClose} size="17" /> Cancel</button
          >
          <button
            class="place-plan__primary"
            type="button"
            disabled={!draftName.trim() || saving}
            onclick={() => void save()}
          >
            <Icon icon={mdiCheck} size="17" />
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      </div>
    {/if}

    <div class="place-plan__workspace" class:place-plan__workspace--editing={editing}>
      <div
        class="place-plan__canvas"
        class:place-plan__canvas--photo={Boolean(visibleBackground)}
        bind:this={canvas}
        aria-label={`${editing ? 'Editing' : 'Viewing'} ${editing ? draftName : activePlan?.displayName}`}
      >
        {#if visibleBackgroundKind === 'satellite'}
          <CimmichPlanSatellite location={parent} />
        {/if}
        {#if visibleBackground}
          <img src={getAssetMediaUrl({ id: visibleBackground, size: AssetMediaSize.Preview })} alt="" />
        {/if}
        <div class="place-plan__grid"></div>
        {#each visibleItems as item (item.childEntityId)}
          {@const child = children.find((candidate) => candidate.entityId === item.childEntityId)}
          <button
            class="place-plan__zone"
            class:place-plan__zone--selected={editing && selectedChildId === item.childEntityId}
            type="button"
            style={itemStyle(item.geometry)}
            aria-label={`${item.childName}${editing ? ', drag to move' : ', open Location'}`}
            onpointerdown={(event) => beginDrag(event, item, 'move')}
            onpointermove={continueDrag}
            onpointerup={finishDrag}
            onpointercancel={finishDrag}
            onclick={() => {
              if (editing) {
                selectedChildId = item.childEntityId;
              } else if (child) {
                onOpenPlace(child);
              }
            }}
          >
            <span>{item.childName}</span>
            {#if !editing}<Icon icon={mdiArrowRight} size="15" />{/if}
            {#if editing && item.geometry.kind === 'rect'}
              <i
                role="button"
                tabindex="-1"
                aria-label={`Resize ${item.childName}`}
                onpointerdown={(event) => beginDrag(event, item, 'resize')}
                onpointermove={continueDrag}
                onpointerup={finishDrag}
                onpointercancel={finishDrag}
              ></i>
            {/if}
          </button>
        {/each}
        {#if visibleItems.length === 0}
          <div class="place-plan__canvas-empty">Choose a Location to place</div>
        {/if}
      </div>

      {#if editing}
        <aside class="place-plan__tray" aria-label="Locations on this plan">
          <div>
            <strong>Locations</strong>
            <span>{draftItems.length} placed</span>
          </div>
          <ul>
            {#each children as child (child.entityId)}
              <li>
                <button
                  type="button"
                  class:place-plan__tray-item--selected={selectedChildId === child.entityId}
                  onclick={() => (placedIds.has(child.entityId) ? (selectedChildId = child.entityId) : addChild(child))}
                >
                  <span>{child.displayName}</span>
                  <small>{placedIds.has(child.entityId) ? 'Placed' : 'Add'}</small>
                </button>
              </li>
            {/each}
          </ul>
          {#if children.length === 0}<p>Add child Locations to {parent.displayName} before arranging them here.</p>{/if}
          {#if selectedChildId}
            <button class="place-plan__remove" type="button" onclick={removeSelected}>Remove from this plan</button>
          {/if}
          {#if unplacedChildren.length > 0 && draftItems.length > 0}
            <small class="place-plan__tray-count">{unplacedChildren.length} not placed</small>
          {/if}
        </aside>
      {/if}
    </div>
    {#if saveError}<p class="place-plan__error" role="alert">{saveError}</p>{/if}
  {/if}
</section>

<style>
  .place-plan {
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 1.5rem;
    background: white;
  }
  :global(.dark) .place-plan {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }
  .place-plan__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.1rem;
    border-bottom: 1px solid rgb(229 231 235);
  }
  :global(.dark) .place-plan__header {
    border-color: rgb(31 41 55);
  }
  .place-plan__identity,
  .place-plan__header-actions,
  .place-plan__save-actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }
  .place-plan__identity > span {
    display: grid;
    width: 2.65rem;
    height: 2.65rem;
    place-items: center;
    border-radius: 0.9rem;
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.1);
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 750;
  }
  h3 {
    font-weight: 750;
  }
  .place-plan__identity p {
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }
  button {
    min-height: 2.5rem;
    border-radius: 0.8rem;
    padding: 0 0.85rem;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .place-plan__header-actions button,
  .place-plan__save-actions button,
  .place-plan__editor-bar > button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .place-plan__primary {
    color: white;
    background: rgb(var(--immich-primary-color));
  }
  .place-plan__primary:disabled {
    opacity: 0.55;
  }
  .place-plan__tabs {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0.7rem 1rem 0;
  }
  .place-plan__tabs button {
    border: 1px solid transparent;
    border-radius: 999px;
  }
  .place-plan__tabs .place-plan__tab--active {
    border-color: rgb(var(--immich-primary-color) / 0.25);
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.08);
  }
  .place-plan__empty {
    display: grid;
    justify-items: center;
    gap: 0.75rem;
    padding: 3.5rem 1.25rem;
    text-align: center;
    background-image:
      linear-gradient(rgb(148 163 184/0.12) 1px, transparent 1px),
      linear-gradient(90deg, rgb(148 163 184/0.12) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .place-plan__empty > span {
    display: grid;
    width: 4rem;
    height: 4rem;
    place-items: center;
    border: 1px solid rgb(209 213 219);
    border-radius: 1.25rem;
    background: white;
  }
  :global(.dark) .place-plan__empty > span {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }
  .place-plan__starts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.65rem;
  }
  .place-plan__starts button {
    display: grid;
    min-width: 9.5rem;
    min-height: 6rem;
    place-items: center;
    gap: 0.15rem;
    border: 1px solid rgb(209 213 219);
    padding: 0.8rem;
    background: white;
  }
  :global(.dark) .place-plan__starts button {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }
  .place-plan__starts button:hover {
    border-color: rgb(var(--immich-primary-color));
  }
  .place-plan__starts .place-plan__start--primary {
    border-color: rgb(var(--immich-primary-color) / 0.45);
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.08);
  }
  .place-plan__starts small {
    color: rgb(107 114 128);
    font-weight: 500;
  }
  .place-plan__editor-bar {
    display: flex;
    align-items: end;
    gap: 0.7rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid rgb(229 231 235);
    background: rgb(249 250 251);
  }
  :global(.dark) .place-plan__editor-bar {
    border-color: rgb(31 41 55);
    background: rgb(15 23 42);
  }
  .place-plan__editor-bar label {
    display: grid;
    gap: 0.25rem;
  }
  .place-plan__editor-bar label span {
    color: rgb(107 114 128);
    font-size: 0.68rem;
    font-weight: 750;
    text-transform: uppercase;
  }
  input,
  select {
    min-height: 2.5rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.7rem;
    padding: 0 0.7rem;
    background: white;
    font-size: 0.83rem;
  }
  :global(.dark) input,
  :global(.dark) select {
    border-color: rgb(55 65 81);
    background: rgb(31 41 55);
  }
  .place-plan__background-toggle--active {
    color: rgb(var(--immich-primary-color));
    background: rgb(var(--immich-primary-color) / 0.1);
  }
  .place-plan__save-actions {
    margin-left: auto;
  }
  .place-plan__workspace {
    display: grid;
    min-height: 34rem;
    padding: 1rem;
  }
  .place-plan__workspace--editing {
    grid-template-columns: minmax(0, 1fr) 15rem;
    gap: 1rem;
  }
  .place-plan__canvas {
    position: relative;
    overflow: hidden;
    min-height: 32rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 1.1rem;
    background: rgb(248 250 252);
    touch-action: none;
  }
  :global(.dark) .place-plan__canvas {
    border-color: rgb(55 65 81);
    background: rgb(15 23 42);
  }
  .place-plan__canvas > img,
  .place-plan__grid {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .place-plan__canvas > img {
    object-fit: cover;
    opacity: 0.62;
  }
  .place-plan__grid {
    z-index: 0;
    background-image:
      linear-gradient(rgb(100 116 139/0.12) 1px, transparent 1px),
      linear-gradient(90deg, rgb(100 116 139/0.12) 1px, transparent 1px);
    background-size: 28px 28px;
  }
  .place-plan__canvas--photo .place-plan__grid {
    background-color: rgb(15 23 42/0.12);
  }
  .place-plan__zone {
    position: absolute;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    overflow: visible;
    border: 2px solid rgb(var(--immich-primary-color) / 0.8);
    border-radius: 0.75rem;
    padding: 0.4rem;
    color: rgb(30 41 59);
    background: rgb(255 255 255/0.84);
    box-shadow: 0 8px 24px rgb(15 23 42/0.12);
    backdrop-filter: blur(6px);
    user-select: none;
  }
  :global(.dark) .place-plan__zone {
    color: white;
    background: rgb(15 23 42/0.82);
  }
  .place-plan__zone:hover,
  .place-plan__zone--selected {
    border-color: rgb(var(--immich-primary-color));
    box-shadow:
      0 0 0 3px rgb(var(--immich-primary-color) / 0.18),
      0 10px 28px rgb(15 23 42/0.18);
  }
  .place-plan__zone span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
  .place-plan__zone i {
    position: absolute;
    right: -0.4rem;
    bottom: -0.4rem;
    width: 1rem;
    height: 1rem;
    border: 2px solid white;
    border-radius: 999px;
    background: rgb(var(--immich-primary-color));
    cursor: nwse-resize;
  }
  .place-plan__canvas-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgb(107 114 128);
    font-size: 0.85rem;
    font-weight: 650;
  }
  .place-plan__tray {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
  }
  .place-plan__tray > div {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .place-plan__tray > div span,
  .place-plan__tray p {
    color: rgb(107 114 128);
    font-size: 0.75rem;
  }
  .place-plan__tray ul {
    display: grid;
    max-height: 26rem;
    gap: 0.35rem;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .place-plan__tray li button {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border: 1px solid rgb(229 231 235);
    text-align: left;
  }
  :global(.dark) .place-plan__tray li button {
    border-color: rgb(55 65 81);
  }
  .place-plan__tray li button:hover,
  .place-plan__tray-item--selected {
    border-color: rgb(var(--immich-primary-color)) !important;
  }
  .place-plan__tray li small {
    color: rgb(var(--immich-primary-color));
  }
  .place-plan__remove {
    color: rgb(185 28 28);
    background: rgb(254 242 242);
  }
  .place-plan__tray-count {
    color: rgb(107 114 128);
    text-align: center;
  }
  .place-plan__error {
    margin: 0 1rem 1rem;
    border-radius: 0.8rem;
    padding: 0.75rem;
    color: rgb(153 27 27);
    background: rgb(254 242 242);
    font-size: 0.8rem;
  }
  @media (max-width: 800px) {
    .place-plan__workspace--editing {
      grid-template-columns: 1fr;
    }
    .place-plan__tray {
      order: -1;
    }
    .place-plan__tray ul {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      max-height: 10rem;
    }
    .place-plan__editor-bar {
      align-items: stretch;
      flex-wrap: wrap;
    }
    .place-plan__save-actions {
      width: 100%;
      margin-left: 0;
      justify-content: flex-end;
    }
    .place-plan__canvas {
      min-height: 25rem;
    }
    .place-plan__workspace {
      min-height: 27rem;
    }
  }
</style>
