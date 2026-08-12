<script lang="ts">
  import { page } from '$app/state';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import CimmichOrganiseModeSwitch from '$lib/components/cimmich/CimmichOrganiseModeSwitch.svelte';
  import { shouldDeferCimmichExactPhotoTimeline } from '$lib/components/cimmich/photo-viewer-presentation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import LinkLivePhotoAction from '$lib/components/timeline/actions/LinkLivePhotoAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import StackAction from '$lib/components/timeline/actions/StackAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { AssetAction } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { memoryManager } from '$lib/managers/memory-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import {
    getCimmichPersonAssetNeighbors,
    getCimmichPersonAssets,
    getCimmichPetMedia,
    getCimmichSummary,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl, memoryLaneTitle } from '$lib/utils';
  import {
    updateStackedAssetInTimeline,
    updateUnstackedAssetInTimeline,
    type OnLink,
    type OnUnlink,
  } from '$lib/utils/actions';
  import { openFileUploadDialog } from '$lib/utils/file-uploader';
  import { getAltText } from '$lib/utils/thumbnail-util';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { AssetVisibility } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, Icon, ImageCarousel } from '@immich/ui';
  import { mdiAlertOutline, mdiDotsVertical } from '@mdi/js';
  import { t } from 'svelte-i18n';

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let cimmichSubjectAssetIds = $state<Set<string>>(new Set());
  let cimmichSubjectAssetsReady = $state(false);
  let cimmichSubjectNavigationFailed = $state(false);
  let cimmichSubjectAssetLoad = 0;
  let futureAssetCount = $state(0);
  const cimmichAssetId = $derived(page.params.assetId || '');
  const cimmichPersonId = $derived(page.url.searchParams.get('cimmichPersonId') || '');
  const cimmichPetId = $derived(page.url.searchParams.get('cimmichPetId') || '');
  const isOrganiseContext = $derived(page.url.searchParams.has('organise'));
  const cimmichSubjectId = $derived(cimmichPersonId || cimmichPetId);
  const directCimmichViewer = $derived(
    shouldDeferCimmichExactPhotoTimeline(page.url, cimmichAssetId) && !cimmichSubjectNavigationFailed,
  );
  const options = $derived({
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    withPartners: true,
    ...(directCimmichViewer ? { deferInit: true } : {}),
    ...(cimmichSubjectId && !cimmichAssetId ? { assetFilter: cimmichSubjectAssetIds } : {}),
  });

  $effect(() => {
    const personId = cimmichPersonId;
    const petId = cimmichPetId;
    const subjectId = personId || petId;
    const assetId = cimmichAssetId;
    const run = ++cimmichSubjectAssetLoad;
    cimmichSubjectAssetIds = new Set(assetId ? [assetId] : []);
    cimmichSubjectAssetsReady = !subjectId || Boolean(assetId);
    cimmichSubjectNavigationFailed = false;
    if (!subjectId) {
      return;
    }
    const request = personId
      ? assetId
        ? getCimmichPersonAssetNeighbors(personId, assetId)
        : getCimmichPersonAssets(personId)
      : getCimmichPetMedia(petId);
    void request
      .then((assets) => {
        if (run !== cimmichSubjectAssetLoad) {
          return;
        }
        cimmichSubjectAssetIds = new Set(assets.map((asset) => asset.sourceAssetId).filter(Boolean));
        cimmichSubjectAssetsReady = true;
      })
      .catch(() => {
        if (run === cimmichSubjectAssetLoad) {
          cimmichSubjectAssetsReady = true;
          cimmichSubjectNavigationFailed = true;
        }
      });
  });

  $effect(() => {
    if (!isOrganiseContext) {
      futureAssetCount = 0;
      return;
    }
    void getCimmichSummary()
      .then((summary) => {
        futureAssetCount = Number(summary.future_assets || 0);
      })
      .catch(() => {
        futureAssetCount = 0;
      });
  });

  let selectedAssets = $derived(assetMultiSelectManager.assets);
  let isAssetStackSelected = $derived(selectedAssets.length === 1 && !!selectedAssets[0].stack);
  let isLinkActionAvailable = $derived.by(() => {
    const isLivePhoto = selectedAssets.length === 1 && !!selectedAssets[0].livePhotoVideoId;
    const isLivePhotoCandidate =
      selectedAssets.length === 2 &&
      selectedAssets.some((asset) => asset.isImage) &&
      selectedAssets.some((asset) => asset.isVideo);

    return assetMultiSelectManager.isAllUserOwned && (isLivePhoto || isLivePhotoCandidate);
  });

  const handleEscape = () => {
    if (assetViewerManager.isViewing) {
      return;
    }
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }
  };

  const handleLink: OnLink = ({ still, motion }) => {
    timelineManager.removeAssets([motion.id]);
    timelineManager.upsertAssets([still]);
  };

  const handleUnlink: OnUnlink = ({ still, motion }) => {
    timelineManager.upsertAssets([motion]);
    timelineManager.upsertAssets([still]);
  };

  const handleSetVisibility = (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    assetMultiSelectManager.clear();
  };

  const items = $derived(
    memoryManager.memories.map((memory) => ({
      id: memory.id,
      title: $memoryLaneTitle(memory),
      href: Route.memories({ id: memory.assets[0].id }),
      alt: $t('memory_lane_title', { values: { title: $getAltText(toTimelineAsset(memory.assets[0])) } }),
      src: getAssetMediaUrl({ id: memory.assets[0].id }),
    })),
  );
</script>

<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} scrollbar={false}>
  <div class="flex h-full min-h-0 flex-col">
    {#if isOrganiseContext}
      <CimmichOrganiseModeSwitch />
      {#if futureAssetCount > 0}
        <aside
          class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:px-6 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          aria-label="Future photo dates need review"
        >
          <Icon icon={mdiAlertOutline} size="20" aria-hidden="true" />
          <strong>{futureAssetCount.toLocaleString()} future-dated {futureAssetCount === 1 ? 'photo' : 'photos'}</strong
          >
          <span>
            {futureAssetCount === 1 ? 'It appears' : 'They appear'} first below. Select the affected
            {futureAssetCount === 1 ? 'photo' : 'photos'}, open the More menu, then choose Change date.
          </span>
        </aside>
      {/if}
    {/if}
    <div class="min-h-0 flex-1">
      {#if cimmichSubjectAssetsReady}
        <Timeline
          enableRouting={true}
          bind:timelineManager
          {options}
          directNavigationAssetIds={directCimmichViewer ? [...cimmichSubjectAssetIds] : undefined}
          assetInteraction={assetMultiSelectManager}
          removeAction={AssetAction.ARCHIVE}
          onEscape={handleEscape}
          withStacked
        >
          {#if authManager.preferences.memories.enabled}
            <ImageCarousel {items} />
          {/if}
          {#snippet empty()}
            <EmptyPlaceholder
              text={$t('no_assets_message')}
              onClick={() => openFileUploadDialog()}
              class="mx-auto mt-10"
            />
          {/snippet}
        </Timeline>
      {/if}
    </div>
  </div>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

    <CreateSharedLink />
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
    <ActionButton action={Actions.AddToAlbum} />

    {#if assetMultiSelectManager.isAllUserOwned}
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
      />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        {#if assetMultiSelectManager.assets.length > 1 || isAssetStackSelected}
          <StackAction
            unstack={isAssetStackSelected}
            onStack={(result) => updateStackedAssetInTimeline(timelineManager, result)}
            onUnstack={(assets) => updateUnstackedAssetInTimeline(timelineManager, assets)}
          />
        {/if}
        {#if isLinkActionAvailable}
          <LinkLivePhotoAction
            menuItem
            unlink={assetMultiSelectManager.assets.length === 1}
            onLink={handleLink}
            onUnlink={handleUnlink}
          />
        {/if}
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction
          menuItem
          onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
        />
        {#if authManager.preferences.tags.enabled}
          <TagAction menuItem />
        {/if}
        <DeleteAssets
          menuItem
          onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)}
          onUndoDelete={(assets) => timelineManager.upsertAssets(assets)}
        />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <hr />
        <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
        <ActionMenuItem action={Actions.RefreshMetadataJob} />
        <ActionMenuItem action={Actions.TranscodeVideoJob} />
      </ButtonContextMenu>
    {:else}
      <DownloadAction />
    {/if}
  </AssetSelectControlBar>
{/if}
