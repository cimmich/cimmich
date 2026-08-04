<script lang="ts">
  import { afterNavigate, goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import CimmichOrganiseModeSwitch from '$lib/components/cimmich/CimmichOrganiseModeSwitch.svelte';
  import { isMeaningfulEventFolder } from '$lib/components/cimmich/event-folder-graph';
  import UserPageLayout, { headerId } from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import Breadcrumbs from '$lib/components/shared-components/tree/Breadcrumbs.svelte';
  import TreeItemThumbnails from '$lib/components/shared-components/tree/TreeItemThumbnails.svelte';
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import SkipLink from '$lib/elements/SkipLink.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { foldersStore } from '$lib/stores/folders.svelte';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { joinPaths } from '$lib/utils/tree-utils';
  import { ActionButton, CommandPaletteDefaultProvider, Icon, IconButton, Text } from '@immich/ui';
  import { mdiDotsVertical, mdiFolder, mdiFolderHome, mdiFolderOutline, mdiSelectAll } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const viewport: Viewport = $state({ width: 0, height: 0 });
  const isOrganiseContext = $derived(page.url.searchParams.has('organise'));
  const currentFolderIsMeaningful = $derived(
    !isOrganiseContext || !data.tree.path || isMeaningfulEventFolder(data.tree.path),
  );
  const visibleFolderChildren = $derived(
    isOrganiseContext ? data.tree.children.filter((child) => isMeaningfulEventFolder(child.path)) : data.tree.children,
  );
  const visiblePathAssets = $derived(currentFolderIsMeaningful ? data.pathAssets : null);

  const handleNavigateToFolder = (folderName: string) => navigateToView(joinPaths(data.tree.path, folderName));

  const getLinkForPath = (path: string) => Route.folders({ path, organise: isOrganiseContext ? 1 : undefined });

  afterNavigate(() => {
    assetMultiSelectManager.clear();
  });

  const navigateToView = (path: string) => {
    return goto(getLinkForPath(path), { keepFocus: true, noScroll: true });
  };

  const triggerAssetUpdate = async () => {
    assetMultiSelectManager.clear();
    if (data.tree.path) {
      await foldersStore.refreshAssetsByPath(data.tree.path);
    }
    await invalidateAll();
  };

  const handleSetVisibility = () => {
    void triggerAssetUpdate();
  };

  const handleSelectAllAssets = () => {
    if (!visiblePathAssets) {
      return;
    }

    assetMultiSelectManager.selectAssets(visiblePathAssets.map((asset) => toTimelineAsset(asset)));
  };
</script>

<UserPageLayout title={data.meta.title}>
  {#snippet sidebar()}
    <Sidebar>
      <SkipLink target={`#${headerId}`} text={$t('skip_to_folders')} breakpoint="md" />
      <section>
        <Text class="mb-4 ps-4" size="small">{$t('explorer')}</Text>
        <div class="h-full">
          {#if !isOrganiseContext}
            <TreeItems
              icons={{ default: mdiFolderOutline, active: mdiFolder }}
              tree={foldersStore.folders!}
              active={data.tree.path}
              getLink={getLinkForPath}
            />
          {/if}
        </div>
      </section>
    </Sidebar>
  {/snippet}

  <div class="flex h-full min-h-0 flex-col">
    {#if isOrganiseContext}
      <CimmichOrganiseModeSwitch />
    {/if}
    <Breadcrumbs node={data.tree} icon={mdiFolderHome} title={$t('folders')} getLink={getLinkForPath} />

    <section class="mt-2 min-h-0 flex-1 immich-scrollbar overflow-auto">
      <TreeItemThumbnails items={visibleFolderChildren} icon={mdiFolder} onClick={handleNavigateToFolder} />

      <!-- Assets -->
      {#if visiblePathAssets && visiblePathAssets.length > 0}
        <div bind:clientHeight={viewport.height} bind:clientWidth={viewport.width} class="mt-2">
          <GalleryViewer
            assets={visiblePathAssets}
            assetInteraction={assetMultiSelectManager}
            {viewport}
            showAssetName={true}
            pageHeaderOffset={54}
            onReload={triggerAssetUpdate}
          />
        </div>
      {:else if isOrganiseContext && visibleFolderChildren.length === 0}
        <div
          class="mx-auto mt-16 max-w-xl rounded-3xl border border-gray-200 bg-white p-7 text-center dark:border-gray-800 dark:bg-gray-900"
        >
          <Icon icon={mdiFolderOutline} class="mx-auto text-primary" size="42" />
          <h2 class="mt-4 text-lg font-semibold">No original folders here</h2>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Photos uploaded into Immich do not keep a human folder structure. External Library folders appear here
            automatically, while Immich's generated storage paths stay hidden.
          </p>
          {#if authManager.user.isAdmin}
            <a
              class="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-white"
              href={Route.libraries()}
            >
              Set up an External Library
            </a>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <div class="fixed inset-s-0 top-0 w-full">
    <AssetSelectControlBar>
      {@const Actions = getAssetBulkActions($t)}
      <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
      <CreateSharedLink />
      <IconButton
        shape="round"
        color="secondary"
        variant="ghost"
        aria-label={$t('select_all')}
        icon={mdiSelectAll}
        onclick={handleSelectAllAssets}
      />
      <ActionButton action={Actions.AddToAlbum} />
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={function handleFavoriteUpdate(ids, isFavorite) {
          if (visiblePathAssets && visiblePathAssets.length > 0) {
            for (const id of ids) {
              const asset = visiblePathAssets.find((asset) => asset.id === id);
              if (asset) {
                asset.isFavorite = isFavorite;
              }
            }
          }
        }}
      />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction menuItem unarchive={assetMultiSelectManager.isAllArchived} onArchive={triggerAssetUpdate} />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        {#if authManager.preferences.tags.enabled && assetMultiSelectManager.isAllUserOwned}
          <TagAction menuItem />
        {/if}
        <DeleteAssets menuItem onAssetDelete={triggerAssetUpdate} onUndoDelete={triggerAssetUpdate} />
        <hr />

        <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
        <ActionMenuItem action={Actions.RefreshMetadataJob} />
        <ActionMenuItem action={Actions.TranscodeVideoJob} />
      </ButtonContextMenu>
    </AssetSelectControlBar>
  </div>
{/if}
