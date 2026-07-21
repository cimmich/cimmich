<script lang="ts">
  import CimmichContextBrowser from '$lib/components/cimmich/CimmichContextBrowser.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title}>
  <CimmichContextBrowser
    description="Bring a trip, occasion, activity or life period together without changing the original photos."
    families={['events']}
  />
</UserPageLayout>
