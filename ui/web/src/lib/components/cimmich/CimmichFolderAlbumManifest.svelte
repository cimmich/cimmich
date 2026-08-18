<script lang="ts">
  import {
    checkpointCimmichBulkAlbumOperation,
    changeCimmichAssetLabelMembership,
    createCimmichAssetLabel,
    createCimmichAssetLabelCommandId,
    createCimmichBulkAlbumCommandId,
    createCimmichBulkAlbumOperation,
    getActiveCimmichBulkAlbumOperation,
    getCimmichAssetLabels,
    getCimmichVisibleMapAssetBindings,
    setCimmichBulkAlbumOperationState,
    undoCimmichBulkAlbumCheckpoint,
    undoCimmichAssetLabelDecision,
    type CimmichAssetLabel,
    type CimmichBulkAlbumOperation,
  } from '$lib/services/cimmich.service';
  import { getAssetsByOriginalPath, getUniqueOriginalPaths } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiFolderPlusOutline, mdiUndoVariant } from '@mdi/js';
  import { onMount } from 'svelte';
  import { chunkBulkPhotoSorterItems, createBulkPhotoSorterOperationId } from './bulk-photo-sorter';
  import {
    folderAlbumManifestFingerprint,
    folderAlbumManifestIssues,
    folderAlbumTitle,
    resolveFolderAlbumTitleCollisions,
    type FolderAlbumManifestRow,
  } from './folder-album-manifest';

  interface Props {
    rootPath: string;
  }

  let { rootPath }: Props = $props();
  let rows = $state<FolderAlbumManifestRow[]>([]);
  let collections = $state<CimmichAssetLabel[]>([]);
  let discoveryProgress = $state('');
  let operationProgress = $state('');
  let error = $state('');
  let discovering = $state(false);
  let applying = $state(false);
  let undoing = $state(false);
  let activeOperation = $state<CimmichBulkAlbumOperation | null>(null);

  const normalizedRoot = $derived(`/${rootPath.replaceAll('\\', '/').split('/').filter(Boolean).join('/')}`);
  const includedRows = $derived(rows.filter(({ include }) => include));
  const issues = $derived(folderAlbumManifestIssues(rows));
  const canApply = $derived(
    includedRows.length > 0 &&
      issues.emptyTitles.length === 0 &&
      issues.duplicateTitles.length === 0 &&
      !activeOperation,
  );
  const includedAssetCount = $derived(includedRows.reduce((sum, row) => sum + row.assetIds.length, 0));

  const asErrorMessage = (caught: unknown) =>
    caught instanceof Error ? caught.message : 'The folder album operation could not be completed.';

  onMount(async () => {
    try {
      activeOperation = await getActiveCimmichBulkAlbumOperation();
    } catch (error_) {
      error = asErrorMessage(error_);
    }
  });

  const discover = async () => {
    if (!normalizedRoot || normalizedRoot === '/') {
      error = 'Choose a specific archive branch before discovering folder albums.';
      return;
    }
    discovering = true;
    error = '';
    rows = [];
    try {
      const uniquePaths = await getUniqueOriginalPaths();
      const paths = uniquePaths
        .map((path) => `/${path.replaceAll('\\', '/').split('/').filter(Boolean).join('/')}`)
        .filter((path) => path === normalizedRoot || path.startsWith(`${normalizedRoot}/`))
        .sort();
      if (paths.length === 0) {
        throw new Error('No original media folders were found inside that path. Nothing has changed.');
      }
      const discovered: Array<Omit<FolderAlbumManifestRow, 'collisionSource'>> = [];
      let nextIndex = 0;
      let completed = 0;
      const worker = async () => {
        while (nextIndex < paths.length) {
          const path = paths[nextIndex++]!;
          const assets = await getAssetsByOriginalPath({ path });
          const sourceAssetIds = assets.filter((asset) => !asset.isTrashed && !asset.isOffline).map(({ id }) => id);
          const bindings = await getCimmichVisibleMapAssetBindings(sourceAssetIds);
          const assetIds = [...bindings.values()];
          if (assetIds.length > 0) {
            discovered.push({ assetIds, include: true, sourcePath: path, title: folderAlbumTitle(path) });
          }
          completed += 1;
          discoveryProgress = `Reading exact folders… ${completed.toLocaleString()} of ${paths.length.toLocaleString()}`;
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, paths.length) }, () => worker()));
      rows = resolveFolderAlbumTitleCollisions(
        discovered.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
        normalizedRoot,
      );
      collections = [...(await getCimmichAssetLabels('', 250, 'collection'))].sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      );
      discoveryProgress = `${rows.length.toLocaleString()} media-bearing folders · ${rows
        .reduce((sum, row) => sum + row.assetIds.length, 0)
        .toLocaleString()} items. Review names below; nothing has changed.`;
    } catch (error_) {
      error = `${asErrorMessage(error_)} Nothing has changed.`;
      discoveryProgress = '';
    } finally {
      discovering = false;
    }
  };

  const updateRow = (index: number, patch: Partial<Pick<FolderAlbumManifestRow, 'include' | 'title'>>) => {
    rows[index] = { ...rows[index]!, ...patch };
    rows = [...rows];
  };

  const collectionByTitle = (title: string) =>
    collections.find(
      (collection) => collection.displayName.localeCompare(title, undefined, { sensitivity: 'base' }) === 0,
    );

  const apply = async () => {
    if (!canApply) {
      return;
    }
    if (
      !globalThis.confirm(
        `Create or reuse ${includedRows.length.toLocaleString()} Cimmich collections for ${includedAssetCount.toLocaleString()} items?\n\nEvery title is shown in the manifest. Immich and the original files remain read-only.`,
      )
    ) {
      operationProgress = 'The reviewed manifest was cancelled. Nothing has changed.';
      return;
    }
    applying = true;
    error = '';
    const operationId = createBulkPhotoSorterOperationId();
    let batchSequence = 0;
    try {
      const snapshotDigest = await folderAlbumManifestFingerprint(rows);
      activeOperation = await createCimmichBulkAlbumOperation({
        manifest: includedRows.map((row) => ({
          assetCount: row.assetIds.length,
          sourcePath: row.sourcePath,
          title: row.title.trim(),
        })),
        operationId,
        snapshotDigest,
        sourcePath: normalizedRoot,
      });
      let appliedAssets = 0;
      let completedAlbums = 0;
      for (const row of includedRows) {
        const title = row.title.trim();
        let collection = collectionByTitle(title);
        if (!collection) {
          const created = await createCimmichAssetLabel(
            title,
            createCimmichAssetLabelCommandId('folder-collection'),
            'collection',
          );
          collection = created.label;
          collections = [...collections, collection];
        }
        for (const batch of chunkBulkPhotoSorterItems(row.assetIds)) {
          const result = await changeCimmichAssetLabelMembership(
            collection.labelId,
            'attach',
            batch,
            createCimmichAssetLabelCommandId('folder-collection-attach'),
          );
          const changedAssetIds = result.changedAssetIds;
          if (changedAssetIds.length > 0) {
            await checkpointCimmichBulkAlbumOperation(operationId, {
              albumCreated: false,
              albumId: collection.labelId,
              albumName: title,
              assetIds: changedAssetIds,
              batchSequence: batchSequence++,
              commandId: createCimmichBulkAlbumCommandId('collection-assets'),
              organizationDecisionId: result.decisionId,
              sourcePath: row.sourcePath,
            });
            appliedAssets += changedAssetIds.length;
          }
          operationProgress = `Building collections… ${completedAlbums.toLocaleString()} of ${includedRows.length.toLocaleString()} folders · ${appliedAssets.toLocaleString()} memberships`;
        }
        completedAlbums += 1;
      }
      await setCimmichBulkAlbumOperationState(operationId, 'applied');
      activeOperation = await getActiveCimmichBulkAlbumOperation();
      operationProgress = `${includedRows.length.toLocaleString()} collections processed · ${appliedAssets.toLocaleString()} new memberships. Exact Undo is saved.`;
    } catch (error_) {
      await setCimmichBulkAlbumOperationState(operationId, 'partial').catch(() => undefined);
      activeOperation = await getActiveCimmichBulkAlbumOperation().catch(() => activeOperation);
      error = `${asErrorMessage(error_)} The completed batches are saved for exact Undo.`;
    } finally {
      applying = false;
    }
  };

  const undo = async () => {
    if (!activeOperation) {
      return;
    }
    undoing = true;
    error = '';
    try {
      await setCimmichBulkAlbumOperationState(activeOperation.operationId, 'undoing');
      const checkpoints = [...activeOperation.checkpoints]
        .filter(({ state }) => state === 'applied')
        .sort((left, right) => right.batchSequence - left.batchSequence);
      let remaining = checkpoints.length;
      for (const checkpoint of checkpoints) {
        if (checkpoint.organizationDecisionId) {
          await undoCimmichAssetLabelDecision(
            checkpoint.organizationDecisionId,
            createCimmichAssetLabelCommandId('folder-collection-undo'),
          );
        }
        await undoCimmichBulkAlbumCheckpoint(
          checkpoint.checkpointId,
          createCimmichBulkAlbumCommandId('checkpoint-undo'),
        );
        remaining -= 1;
        operationProgress = `Undoing folder collections… ${remaining.toLocaleString()} saved batches remaining`;
      }
      await setCimmichBulkAlbumOperationState(activeOperation.operationId, 'undone');
      activeOperation = null;
      operationProgress = 'The folder-to-collection operation was undone.';
      collections = [...(await getCimmichAssetLabels('', 250, 'collection'))];
    } catch (error_) {
      activeOperation = await getActiveCimmichBulkAlbumOperation().catch(() => activeOperation);
      error = `${asErrorMessage(error_)} Completed Undo steps are saved; resume Undo to continue.`;
    } finally {
      undoing = false;
    }
  };

  const keepChanges = async () => {
    if (!activeOperation) {
      return;
    }
    applying = true;
    error = '';
    try {
      await setCimmichBulkAlbumOperationState(activeOperation.operationId, 'kept');
      activeOperation = null;
      operationProgress = 'Changes kept. The recovery receipt remains in Cimmich history.';
    } catch (error_) {
      error = asErrorMessage(error_);
    } finally {
      applying = false;
    }
  };
</script>

<section class="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5" aria-label="Folder album manifest">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <div class="flex items-center gap-2 text-primary">
        <Icon icon={mdiFolderPlusOutline} size="22" />
        <h3 class="font-semibold">Create collections from original folders</h3>
      </div>
      <p class="mt-2 max-w-3xl text-sm opacity-70">
        Root: <strong>{normalizedRoot || 'Choose a folder above'}</strong>. Discovery reads exact folders through a
        four-request queue. Titles stay editable and collisions are visibly qualified before any Cimmich collection is
        created.
      </p>
    </div>
    <button
      class="rounded-full border border-primary/25 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
      type="button"
      onclick={discover}
      disabled={discovering || applying || undoing || Boolean(activeOperation)}
      >{discovering ? 'Discovering…' : rows.length > 0 ? 'Refresh manifest' : 'Discover folders'}</button
    >
  </div>

  {#if discoveryProgress}<p class="mt-4 text-sm font-medium" aria-live="polite">{discoveryProgress}</p>{/if}
  {#if activeOperation}
    <div
      class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/35 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/25 dark:text-amber-100"
    >
      <div>
        <strong>Saved {activeOperation.state} operation</strong>
        <p class="mt-1 opacity-75">
          {activeOperation.albumCount.toLocaleString()} collections · {activeOperation.assetCount.toLocaleString()} source
          items · {activeOperation.checkpoints.filter(({ state }) => state === 'applied').length.toLocaleString()} live checkpoints
        </p>
      </div>
      <div class="flex gap-2">
        <button
          class="rounded-full border border-current/25 px-4 py-2 font-semibold"
          type="button"
          onclick={undo}
          disabled={undoing || applying}
        >
          <Icon icon={mdiUndoVariant} size="18" />
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
        <button
          class="rounded-full px-4 py-2 font-semibold"
          type="button"
          onclick={keepChanges}
          disabled={undoing || applying}>Keep changes</button
        >
      </div>
    </div>
  {/if}

  {#if rows.length > 0}
    <div class="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p>
        <strong>{includedRows.length.toLocaleString()}</strong> included folders ·
        <strong>{includedAssetCount.toLocaleString()}</strong> items
      </p>
      {#if issues.emptyTitles.length || issues.duplicateTitles.length}
        <p class="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
          <Icon icon={mdiAlertCircleOutline} size="18" /> Resolve empty or duplicate titles before applying.
        </p>
      {:else}
        <p class="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
          <Icon icon={mdiCheckCircleOutline} size="18" /> Manifest ready
        </p>
      {/if}
    </div>
    <div
      class="mt-3 max-h-136 overflow-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-black/10"
    >
      {#each rows as row, index (row.sourcePath)}
        <div
          class="grid gap-3 border-b border-black/8 p-3 last:border-b-0 sm:grid-cols-[auto_minmax(0,1.35fr)_minmax(0,1fr)_auto] sm:items-center dark:border-white/8"
        >
          <input
            class="size-4 accent-primary"
            type="checkbox"
            checked={row.include}
            aria-label={`Include ${row.sourcePath}`}
            onchange={(event) => updateRow(index, { include: event.currentTarget.checked })}
          />
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold" title={row.sourcePath}>{row.sourcePath}</p>
            <p class="mt-1 text-xs opacity-60">
              {row.assetIds.length.toLocaleString()} items{row.collisionSource
                ? ' · collision qualified'
                : ''}{collectionByTitle(row.title) ? ' · existing collection' : ''}
            </p>
          </div>
          <input
            class="min-w-0 rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/15"
            value={row.title}
            aria-label={`Collection title for ${row.sourcePath}`}
            oninput={(event) => updateRow(index, { title: event.currentTarget.value })}
          />
          <span class="text-xs font-semibold opacity-60">{collectionByTitle(row.title) ? 'Reuse' : 'Create'}</span>
        </div>
      {/each}
    </div>
    <div class="mt-4 flex justify-end">
      <button
        class="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        type="button"
        onclick={apply}
        disabled={!canApply || applying || undoing}
        >{applying ? 'Applying manifest…' : 'Review and create collections'}</button
      >
    </div>
  {/if}
  {#if operationProgress}<p
      class="mt-4 rounded-xl bg-white/70 px-4 py-3 text-sm font-medium dark:bg-black/15"
      aria-live="polite"
    >
      {operationProgress}
    </p>{/if}
  {#if error}<p
      class="mt-4 flex gap-2 rounded-xl border border-red-400/30 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/25 dark:text-red-200"
    >
      <Icon icon={mdiAlertCircleOutline} size="18" />
      {error}
    </p>{/if}
</section>
