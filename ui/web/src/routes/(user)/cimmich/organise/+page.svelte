<script lang="ts">
  import CimmichBulkPhotoSorter from '$lib/components/cimmich/CimmichBulkPhotoSorter.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title}>
  <CimmichBulkPhotoSorter />
</UserPageLayout>
