<script lang="ts">
  import { Route } from '$lib/route';
  import { Icon, Tooltip, TooltipProvider } from '@immich/ui';
  import { mdiImageSearchOutline } from '@mdi/js';

  interface Props {
    sourceAssetId: string;
  }

  let { sourceAssetId }: Props = $props();
</script>

<TooltipProvider delayDuration={120}>
  <Tooltip text="Find visually similar">
    {#snippet child({ props })}
      <a
        {...props}
        class="grid size-10 place-items-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
        href={Route.cimmichSmartSearch({ lens: 'visual', queryAssetId: sourceAssetId })}
        aria-label="Find visually similar photos"
      >
        <Icon icon={mdiImageSearchOutline} size="21" />
      </a>
    {/snippet}
  </Tooltip>
</TooltipProvider>
