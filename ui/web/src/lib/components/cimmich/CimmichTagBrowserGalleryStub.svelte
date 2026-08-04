<script lang="ts">
  import type { AssetResponseDto } from '@immich/sdk';

  interface Props {
    assets: AssetResponseDto[];
  }

  let { assets }: Props = $props();
</script>

<div data-testid="tag-result-gallery">{assets.map((asset) => asset.id).join(',')}</div>
