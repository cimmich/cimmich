<script lang="ts">
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import {
    setCimmichVisibilityObject,
    undoCimmichVisibilityDecision,
    type CimmichVisibilityObject,
    type CimmichVisibilityTier,
  } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import { mdiUndoVariant } from '@mdi/js';
  import CimmichVisibilityTierControl from './CimmichVisibilityTierControl.svelte';

  interface Props {
    object: CimmichVisibilityObject;
    objectLabel: string;
    onChange?: (object: CimmichVisibilityObject) => void;
  }

  let { object, objectLabel, onChange = () => {} }: Props = $props();
  let busy = $state(false);
  const undoDecisionId = $derived(cimmichVisibilityManager.undoDecisions[`${object.objectScope}:${object.objectId}`]);

  const publish = (nextObject: CimmichVisibilityObject, result: unknown) => {
    onChange(nextObject);
    cimmichVisibilityManager.notify();
    globalThis.dispatchEvent(new CustomEvent('cimmich:visibility-changed', { detail: result }));
  };

  const selectTier = async (visibilityTier: CimmichVisibilityTier) => {
    busy = true;
    try {
      const result = await setCimmichVisibilityObject(object.objectScope, object.objectId, visibilityTier);
      const nextObject = result.objects[0];
      if (!nextObject) {
        return;
      }
      cimmichVisibilityManager.rememberUndo(nextObject.objectScope, nextObject.objectId, result.decisionId);
      publish(nextObject, result);
    } finally {
      busy = false;
    }
  };

  const undo = async () => {
    if (!undoDecisionId) {
      return;
    }
    busy = true;
    try {
      const result = await undoCimmichVisibilityDecision(undoDecisionId);
      const nextObject = result.objects[0];
      if (!nextObject) {
        return;
      }
      cimmichVisibilityManager.clearUndo(nextObject.objectScope, nextObject.objectId);
      publish(nextObject, result);
    } finally {
      busy = false;
    }
  };
</script>

<div class="flex items-center gap-1">
  {#if undoDecisionId}
    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-full transition hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60 dark:hover:bg-gray-800"
      aria-label={`Undo ${objectLabel.toLocaleLowerCase()} visibility change`}
      title={`Undo ${objectLabel.toLocaleLowerCase()} visibility change`}
      disabled={busy}
      onclick={() => void undo()}><Icon icon={mdiUndoVariant} size="21" /></button
    >
  {/if}
  <CimmichVisibilityTierControl
    disabled={busy}
    {objectLabel}
    onSelectTier={selectTier}
    showLabel
    tier={object.visibilityTier}
  />
</div>
