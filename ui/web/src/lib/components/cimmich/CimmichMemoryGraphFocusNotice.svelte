<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiArrowLeft, mdiClose } from '@mdi/js';

  interface Props {
    focusNodeName?: string;
    lensLabel: string;
    onclearfocus: () => void;
    onresetpath: () => void;
    pathStartName?: string;
  }

  let { focusNodeName, lensLabel, onclearfocus, onresetpath, pathStartName }: Props = $props();
</script>

<div
  class="flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-2 text-sm"
>
  {#if focusNodeName}
    <span><strong>Focused on {focusNodeName}</strong> and its immediate neighbourhood.</span>
    <button
      class="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 font-semibold text-primary hover:bg-primary/10"
      type="button"
      onclick={onclearfocus}><Icon icon={mdiArrowLeft} size="18" /> Back to {lensLabel}</button
    >
  {:else}
    <span><strong>Trace from {pathStartName}:</strong> choose any other visible memory.</span>
    <button
      class="inline-flex min-h-9 items-center gap-2 rounded-xl px-3 font-semibold text-primary hover:bg-primary/10"
      type="button"
      onclick={onresetpath}><Icon icon={mdiClose} size="18" /> Cancel</button
    >
  {/if}
</div>
