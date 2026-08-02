<script lang="ts">
  import CimmichBulkPhotoSorter from '$lib/components/cimmich/CimmichBulkPhotoSorter.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiArrowLeft } from '@mdi/js';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto w-full max-w-[1500px] px-4 pt-6 sm:px-6 lg:px-10">
    <a
      class="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
      href={Route.cimmichOrganise()}
    >
      <Icon icon={mdiArrowLeft} size="19" /> Back to Organise
    </a>
  </div>
  <CimmichBulkPhotoSorter />
</UserPageLayout>
