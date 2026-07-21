<script lang="ts">
  import {
    getCimmichAssetEvidence,
    getCimmichVisibilityStatus,
    getCimmichVisibilityObject,
    setCimmichVisibilityObject,
    undoCimmichVisibilityDecision,
    type CimmichVisibilityObject,
    type CimmichVisibilityTier,
  } from '$lib/services/cimmich.service';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiUndoVariant } from '@mdi/js';
  import CimmichVisibilityTierControl from './CimmichVisibilityTierControl.svelte';

  interface Props {
    sourceAssetId: string;
    variant?: 'default' | 'overlay';
  }

  let { sourceAssetId, variant = 'default' }: Props = $props();
  let object = $state<CimmichVisibilityObject>();
  let isLoading = $state(false);
  let loadedSourceAssetId = $state('');
  let loadGeneration = 0;
  const undoDecisionId = $derived(
    object ? cimmichVisibilityManager.undoDecisions[`${object.objectScope}:${object.objectId}`] : undefined,
  );

  const load = async (nextSourceAssetId: string) => {
    const generation = ++loadGeneration;
    isLoading = true;
    object = undefined;
    try {
      await getCimmichVisibilityStatus();
      const evidence = await getCimmichAssetEvidence(nextSourceAssetId);
      if (generation !== loadGeneration || nextSourceAssetId !== sourceAssetId) {
        return;
      }
      const nextObject = await getCimmichVisibilityObject('asset', evidence.asset_id);
      if (generation !== loadGeneration || nextSourceAssetId !== sourceAssetId) {
        return;
      }
      object = nextObject;
      loadedSourceAssetId = nextSourceAssetId;
    } catch {
      if (generation === loadGeneration && nextSourceAssetId === sourceAssetId) {
        loadedSourceAssetId = nextSourceAssetId;
      }
    } finally {
      if (generation === loadGeneration) {
        isLoading = false;
      }
    }
  };

  const selectTier = async (visibilityTier: CimmichVisibilityTier) => {
    if (!object) {
      return;
    }
    const result = await setCimmichVisibilityObject(object.objectScope, object.objectId, visibilityTier);
    object = result.objects[0];
    if (result.decisionId) {
      cimmichVisibilityManager.rememberUndo(object.objectScope, object.objectId, result.decisionId);
    }
    cimmichVisibilityManager.notify();
    globalThis.dispatchEvent(new CustomEvent('cimmich:visibility-changed', { detail: result }));
  };

  const undo = async () => {
    if (!object || !undoDecisionId) {
      return;
    }
    isLoading = true;
    try {
      const result = await undoCimmichVisibilityDecision(undoDecisionId);
      object = result.objects[0];
      cimmichVisibilityManager.clearUndo(object.objectScope, object.objectId);
      cimmichVisibilityManager.notify();
      globalThis.dispatchEvent(new CustomEvent('cimmich:visibility-changed', { detail: result }));
    } finally {
      isLoading = false;
    }
  };

  $effect(() => {
    if (sourceAssetId && sourceAssetId !== loadedSourceAssetId) {
      void load(sourceAssetId);
    }
  });
</script>

{#if object}
  <div class="flex items-center gap-1">
    {#if undoDecisionId}
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60 {variant ===
        'overlay'
          ? 'text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)] hover:bg-white/10'
          : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
        aria-label="Undo photo visibility change"
        title="Undo photo visibility change"
        disabled={isLoading}
        onclick={() => void undo()}><Icon icon={mdiUndoVariant} size="22" /></button
      >
    {/if}
    <CimmichVisibilityTierControl
      disabled={isLoading}
      objectLabel="Photo"
      onSelectTier={selectTier}
      tier={object.visibilityTier}
      {variant}
    />
  </div>
{/if}
