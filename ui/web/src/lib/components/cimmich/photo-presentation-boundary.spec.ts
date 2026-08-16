import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('app-wide Cimmich photo presentation boundary', () => {
  it('filters gallery and timeline assets before thumbnail components receive them', () => {
    const gallery = source('src/lib/components/shared-components/gallery-viewer/GalleryViewer.svelte');
    const timeline = source('src/lib/managers/timeline-manager/internal/load-support.svelte.ts');

    expect(gallery).toContain('cimmichAssetPresentationManager');
    expect(gallery).toContain('.presentableIds(requestedIds, visibilityVersion)');
    expect(gallery).toContain('{#each displayAssets as asset');
    expect(timeline).toContain('filterTimeBucketAssets(bucketResponse, presentableIds)');
    expect(timeline).toContain('timelineMonth.addAssets(presentedBucketResponse, true)');
  });

  it('keeps direct viewers black until the current asset is admitted', () => {
    const viewer = source('src/lib/components/asset-viewer/AssetViewer.svelte');
    expect(viewer).toContain('{:else if !presentationAllowed}');
    expect(viewer).toContain('Photo hidden in this viewing mode');
    expect(viewer).toContain("{:else if viewerKind === 'StackVideoViewer'}");
    expect(viewer).toContain('presentationAllowed && assetViewerManager.isShowCimmichOverlay');
  });

  it('keeps exact subject viewers out of the full timeline while retaining bounded adjacent navigation', () => {
    const photos = source('src/routes/(user)/photos/[[assetId=id]]/+page.svelte');
    const timeline = source('src/lib/components/timeline/Timeline.svelte');
    const timelineViewer = source('src/lib/components/timeline/TimelineAssetViewer.svelte');

    expect(photos).toContain('shouldDeferCimmichExactPhotoTimeline(page.url, cimmichAssetId)');
    expect(photos).toContain('directCimmichViewer ? { deferInit: true } : {}');
    expect(photos).toContain(
      'directNavigationAssetIds={directCimmichViewer ? [...cimmichSubjectAssetIds] : undefined}',
    );
    expect(timeline).toContain('const directViewer = $derived(options?.deferInit === true)');
    expect(timeline).toContain('<TimelineAssetViewer');
    expect(timeline).toContain('{directViewer}');
    expect(timeline).toContain('{directNavigationAssetIds}');
    expect(timelineViewer).toContain('directPhotoViewerAdjacentIds(navigationAssetIds, currentAsset.id)');
    expect(timelineViewer).toContain('loadDirectCloseAssets(asset, navigationAssetIds, generation)');
    expect(timelineViewer).toContain('onRandom={directViewer ? undefined : handleRandom}');
  });

  it('does not leave Private merely because the user opens a non-Cimmich route', () => {
    const viewingMode = source('src/lib/components/cimmich/CimmichViewingMode.svelte');
    expect(viewingMode).not.toContain('isCimmichViewingSurface(new URL(globalThis.location.href))');
    expect(viewingMode).not.toContain(
      "status = await lockCimmichPrivateMode('background');\n    }\n    await goto('/photos')",
    );
  });

  it('keeps the viewing-mode control in the global header and every photo viewer', () => {
    expect(source('src/lib/components/shared-components/navigation-bar/NavigationBar.svelte')).toContain(
      '<CimmichViewingMode />',
    );
    expect(source('src/lib/components/asset-viewer/AssetViewerNavBar.svelte')).toContain(
      '<CimmichViewingMode variant="overlay" restorePreference={false} />',
    );
  });

  it('keeps icon tooltips prompt and photo-status controls visually grouped', () => {
    expect(source('src/routes/+layout.svelte')).toContain('<TooltipProvider delayDuration={200}>');
    const navbar = source('src/lib/components/asset-viewer/AssetViewerNavBar.svelte');
    expect(navbar).toContain('data-testid="cimmich-photo-status-toolbar"');
    expect(navbar).toContain('<CimmichAssetVisibility sourceAssetId={asset.id} variant="overlay" showLabel />');
    expect(source('src/lib/components/cimmich/CimmichFileLocationActions.svelte')).toContain(
      '<TooltipProvider delayDuration={120}>',
    );
  });
});
