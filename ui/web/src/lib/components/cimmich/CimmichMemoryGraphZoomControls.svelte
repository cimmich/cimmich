<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiFitToScreenOutline, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from '@mdi/js';

  interface Props {
    onfit: () => void;
    onzoomin: () => void;
    onzoomout: () => void;
  }

  let { onfit, onzoomin, onzoomout }: Props = $props();
</script>

<div
  class="absolute right-4 bottom-4 z-20 flex gap-1 rounded-2xl border border-gray-200 bg-white/90 p-1.5 shadow-md backdrop-blur-sm dark:border-gray-700 dark:bg-[#11141b]/90"
>
  <button
    class="flex size-10 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10"
    type="button"
    title="Zoom in"
    aria-label="Zoom in"
    onclick={onzoomin}
  >
    <Icon icon={mdiMagnifyPlusOutline} size="21" />
  </button>
  <button
    class="flex size-10 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10"
    type="button"
    title="Zoom out"
    aria-label="Zoom out"
    onclick={onzoomout}
  >
    <Icon icon={mdiMagnifyMinusOutline} size="21" />
  </button>
  <button
    class="flex size-10 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10"
    type="button"
    title="Fit graph"
    aria-label="Fit graph"
    onclick={onfit}
  >
    <Icon icon={mdiFitToScreenOutline} size="21" />
  </button>
</div>
