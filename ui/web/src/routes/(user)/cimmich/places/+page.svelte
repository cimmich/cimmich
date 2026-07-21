<script lang="ts">
  import CimmichContextBrowser from '$lib/components/cimmich/CimmichContextBrowser.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
</script>

<UserPageLayout>
  <CimmichContextBrowser families={['places', 'objects']} />
</UserPageLayout>
