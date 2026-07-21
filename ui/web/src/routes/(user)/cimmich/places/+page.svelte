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
    description="Record the places that matter and the durable things you want to find again. Link photos when they add context."
    families={['places', 'objects']}
  />
</UserPageLayout>
