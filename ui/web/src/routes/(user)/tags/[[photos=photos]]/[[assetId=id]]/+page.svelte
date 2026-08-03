<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CimmichOrganiseModeSwitch from '$lib/components/cimmich/CimmichOrganiseModeSwitch.svelte';
  import CimmichTagBrowser from '$lib/components/cimmich/CimmichTagBrowser.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { getTagActions } from '$lib/services/tag.service';
  import { TreeNode } from '$lib/utils/tree-utils';
  import { getAllTags, type TagResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const isOrganiseContext = $derived(page.url.searchParams.has('organise'));
  let tags = $state<TagResponseDto[]>(data.tags);
  const tree = $derived(TreeNode.fromTags(tags));
  const tag = $derived(tree.traverse(data.path));

  const onRefresh = async () => {
    tags = await getAllTags();
  };

  const onTagDelete = async (deleted: TreeNode) => {
    if (deleted.path === tag.path) {
      await goto(Route.tags({ organise: isOrganiseContext ? 1 : undefined }));
    }
    await onRefresh();
  };

  const { Create, Update, Delete } = $derived(getTagActions($t, tag));
</script>

<OnEvents onTagCreate={onRefresh} onTagUpdate={onRefresh} {onTagDelete} />

<UserPageLayout title={data.meta.title} actions={[Create, Update, Delete]}>
  <div class="flex h-full min-h-0 flex-col">
    {#if isOrganiseContext}
      <CimmichOrganiseModeSwitch />
    {/if}
    <CimmichTagBrowser {tags} initialPath={data.path} />
  </div>
</UserPageLayout>
