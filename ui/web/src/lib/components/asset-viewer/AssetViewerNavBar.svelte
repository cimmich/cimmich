<script lang="ts">
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import type { OnAction, PreAction } from '$lib/components/asset-viewer/actions/action';
  import AddToStackAction from '$lib/components/asset-viewer/actions/AddToStackAction.svelte';
  import ArchiveAction from '$lib/components/asset-viewer/actions/ArchiveAction.svelte';
  import DeleteAction from '$lib/components/asset-viewer/actions/DeleteAction.svelte';
  import KeepThisDeleteOthersAction from '$lib/components/asset-viewer/actions/KeepThisDeleteOthers.svelte';
  import RatingAction from '$lib/components/asset-viewer/actions/RatingAction.svelte';
  import RemoveAssetFromStack from '$lib/components/asset-viewer/actions/RemoveAssetFromStack.svelte';
  import RestoreAction from '$lib/components/asset-viewer/actions/RestoreAction.svelte';
  import SetFeaturedPhotoAction from '$lib/components/asset-viewer/actions/SetPersonFeaturedAction.svelte';
  import SetStackPrimaryAsset from '$lib/components/asset-viewer/actions/SetStackPrimaryAsset.svelte';
  import SetVisibilityAction from '$lib/components/asset-viewer/actions/SetVisibilityAction.svelte';
  import UnstackAction from '$lib/components/asset-viewer/actions/UnstackAction.svelte';
  import LoadingDots from '$lib/components/LoadingDots.svelte';
  import CimmichAssetVisibility from '$lib/components/cimmich/CimmichAssetVisibility.svelte';
  import CimmichDuplicateIndicator from '$lib/components/cimmich/CimmichDuplicateIndicator.svelte';
  import CimmichFileLocationActions from '$lib/components/cimmich/CimmichFileLocationActions.svelte';
  import CimmichLocalAiAction from '$lib/components/cimmich/CimmichLocalAiAction.svelte';
  import CimmichViewingMode from '$lib/components/cimmich/CimmichViewingMode.svelte';
  import { isCimmichViewingSurface } from '$lib/components/cimmich/photo-viewer-presentation';
  import { page } from '$app/state';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import RemoveFromAlbumAction from '$lib/components/timeline/actions/RemoveFromAlbumAction.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { languageManager } from '$lib/managers/language-manager.svelte';
  import { getAlbumAssetActions } from '$lib/services/album.service';
  import { getGlobalActions } from '$lib/services/app.service';
  import { getAssetActions } from '$lib/services/asset.service';
  import { cimmichLocalAiExperiment } from '$lib/stores/cimmich-experience.store';
  import { getSharedLink, withoutIcons } from '$lib/utils';
  import type { OnUndoDelete } from '$lib/utils/actions';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import {
    AssetTypeEnum,
    AssetVisibility,
    type AlbumResponseDto,
    type AssetResponseDto,
    type PersonResponseDto,
    type StackResponseDto,
  } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, Tooltip, type ActionItem } from '@immich/ui';
  import { mdiArrowLeft, mdiArrowRight, mdiDotsVertical, mdiVideoOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    album?: AlbumResponseDto | null;
    person?: PersonResponseDto | null;
    stack?: StackResponseDto | null;
    preAction: PreAction;
    onAction: OnAction;
    onUndoDelete?: OnUndoDelete;
    onClose?: () => void;
    onRemoveFromAlbum?: (assetIds: string[]) => void;
    isPlayingOriginalVideo: boolean;
    setPlayOriginalVideo: (value: boolean) => void;
    photoPresentable?: boolean;
  }

  let {
    asset,
    album = null,
    person = null,
    stack = null,
    preAction,
    onAction,
    onUndoDelete = undefined,
    onClose,
    onRemoveFromAlbum,
    isPlayingOriginalVideo = false,
    setPlayOriginalVideo,
    photoPresentable = true,
  }: Props = $props();

  const isOwner = $derived(authManager.authenticated && asset.ownerId === authManager.user.id);
  const isAlbumOwner = $derived(authManager.authenticated && album?.albumUsers[0].user.id === authManager.user.id);
  const isLocked = $derived(asset.visibility === AssetVisibility.Locked);
  const isCimmichSurface = $derived(isCimmichViewingSurface(page.url));

  const { Cast } = $derived(getGlobalActions($t));

  const Close: ActionItem = $derived({
    title: $t('go_back'),
    icon: languageManager.rtl ? mdiArrowRight : mdiArrowLeft,
    $if: () => !!onClose && !assetViewerManager.isFaceEditMode && !assetViewerManager.isEditFacesPanelOpen,
    onAction: () => onClose?.(),
    shortcuts: [{ key: 'Escape' }],
  });

  const PlayOriginalVideo: ActionItem = $derived({
    title: isPlayingOriginalVideo ? $t('play_transcoded_video') : $t('play_original_video'),
    icon: mdiVideoOutline,
    $if: () => asset.type === AssetTypeEnum.Video,
    onAction: () => setPlayOriginalVideo(!isPlayingOriginalVideo),
  });

  const Actions = $derived(getAssetActions($t, { ...asset, stackPrimaryAssetId: stack?.primaryAssetId }));
  const sharedLink = getSharedLink();
</script>

<CommandPaletteDefaultProvider
  name={$t('assets')}
  actions={withoutIcons(photoPresentable ? [Close, Cast, ...Object.values(Actions)] : [Close])}
/>

<div
  class="flex h-16 place-items-center justify-between bg-linear-to-b from-black/40 px-3 drop-shadow-[0_0_1px_rgba(0,0,0,0.4)] transition-transform duration-200"
>
  <div class="dark flex items-center gap-1">
    <ActionButton action={Close} />
    <CimmichViewingMode variant="overlay" restorePreference={false} />
  </div>

  {#if photoPresentable}
    <div
      class="dark -m-1 flex items-center gap-2 overflow-x-auto p-1 *:shrink-0"
      data-testid="asset-viewer-navbar-actions"
    >
      {#if assetViewerManager.isImageLoading}
        <Tooltip text={$t('loading')}>
          {#snippet child({ props })}
            <div {...props} role="status" aria-label={$t('loading')}>
              <LoadingDots class="me-1" />
            </div>
          {/snippet}
        </Tooltip>
      {/if}
      {#if isCimmichSurface}
        <div
          class="flex h-12 items-center gap-0.5 rounded-full border border-white/15 bg-black/35 p-1 text-white shadow-[0_2px_12px_rgb(0_0_0/0.18)] backdrop-blur-md"
          data-testid="cimmich-photo-status-toolbar"
          aria-label="Cimmich photo status and file actions"
        >
          <CimmichDuplicateIndicator sourceAssetId={asset.id} variant="navbar" />
          <CimmichFileLocationActions {asset} variant="overlay" />
          <CimmichAssetVisibility sourceAssetId={asset.id} variant="overlay" showLabel />
          {#if $cimmichLocalAiExperiment && isOwner && asset.type === AssetTypeEnum.Image}
            <CimmichLocalAiAction sourceAssetIds={[asset.id]} />
          {/if}
        </div>
        <span class="h-6 w-px bg-white/20" aria-hidden="true"></span>
      {/if}
      <ActionButton action={Cast} />
      <ActionButton action={Actions.Share} />
      <ActionButton action={Actions.Offline} />
      <ActionButton action={Actions.ZoomIn} />
      <ActionButton action={Actions.ZoomOut} />
      <ActionButton action={Actions.PlayMotionPhoto} />
      <ActionButton action={Actions.StopMotionPhoto} />
      <ActionButton action={Actions.Copy} />
      <ActionButton action={Actions.SharedLinkDownload} />
      <ActionButton action={Actions.Info} />
      <ActionButton action={Actions.Favorite} />
      <ActionButton action={Actions.Unfavorite} />

      {#if isOwner}
        <RatingAction {asset} {onAction} />
      {/if}

      <ActionButton action={Actions.Edit} />

      {#if isOwner}
        <DeleteAction {asset} {onAction} {preAction} {onUndoDelete} />
      {/if}

      {#if !sharedLink}
        <ButtonContextMenu
          direction="left"
          align="top-right"
          color="secondary"
          title={$t('more')}
          icon={mdiDotsVertical}
        >
          <ActionMenuItem action={Actions.PlaySlideshow} />

          <ActionMenuItem action={Actions.Download} />
          <ActionMenuItem action={Actions.DownloadOriginal} />

          {#if !isLocked && asset.isTrashed}
            <RestoreAction {asset} {onAction} />
          {/if}
          <ActionMenuItem action={Actions.AddToAlbum} />
          {#if album && (isOwner || isAlbumOwner)}
            <RemoveFromAlbumAction {album} onRemove={onRemoveFromAlbum} assetIds={[asset.id]} menuItem />
          {/if}

          {#if isOwner}
            <AddToStackAction {asset} {stack} {onAction} />
            {#if stack}
              <UnstackAction {stack} {onAction} />
              <KeepThisDeleteOthersAction {stack} {asset} {onAction} />
              {#if stack?.primaryAssetId !== asset.id}
                <SetStackPrimaryAsset {stack} {asset} {onAction} />
                {#if stack?.assets?.length > 2}
                  <RemoveAssetFromStack {asset} {stack} {onAction} />
                {/if}
              {/if}
            {/if}
          {/if}
          {#if album}
            {@const { SetCover } = getAlbumAssetActions($t, album, asset)}
            <ActionMenuItem action={SetCover} />
          {/if}
          {#if person}
            <SetFeaturedPhotoAction {asset} {person} {onAction} />
          {/if}

          <ActionMenuItem action={Actions.SetProfilePicture} />

          {#if isOwner && !isLocked}
            <ArchiveAction {asset} {onAction} {preAction} />
          {/if}
          <ActionMenuItem action={Actions.ViewInTimeline} />
          <ActionMenuItem action={Actions.ViewSimilar} />

          {#if !asset.isTrashed && isOwner}
            <SetVisibilityAction asset={toTimelineAsset(asset)} {onAction} {preAction} />
          {/if}

          <ActionMenuItem action={PlayOriginalVideo} />

          {#if isOwner}
            <hr />
            <ActionMenuItem action={Actions.RefreshFacesJob} />
            <ActionMenuItem action={Actions.RefreshMetadataJob} />
            <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
            <ActionMenuItem action={Actions.TranscodeVideoJob} />
          {/if}
        </ButtonContextMenu>
      {/if}
    </div>
  {/if}
</div>
