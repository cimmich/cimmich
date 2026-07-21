<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CimmichDocuments from '$lib/components/cimmich/CimmichDocuments.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Icon } from '@immich/ui';
  import { mdiFileDocumentOutline } from '@mdi/js';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const requestedDocumentId = $derived(page.url.searchParams.get('documentId') ?? '');

  const selectDocument = (documentId: string | null) => {
    const url = new URL(page.url);
    if (documentId) {
      url.searchParams.set('documentId', documentId);
    } else {
      url.searchParams.delete('documentId');
    }
    void goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
  };
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto w-full max-w-[1500px] px-4 pb-20 sm:px-6 lg:px-10">
    <header class="flex items-center gap-4 border-b border-gray-200 py-6 dark:border-gray-800">
      <span class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon icon={mdiFileDocumentOutline} size="26" />
      </span>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Documents</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          The records, receipts and files that belong with your library.
        </p>
      </div>
    </header>

    <div class="mt-7">
      <CimmichDocuments
        heading="All documents"
        initialDocumentId={requestedDocumentId}
        onDocumentChange={selectDocument}
      />
    </div>
  </div>
</UserPageLayout>
