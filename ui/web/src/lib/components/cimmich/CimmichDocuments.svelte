<script lang="ts">
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { focusTrap } from '$lib/actions/focus-trap';
  import {
    CimmichServiceError,
    attachCimmichDocumentLinks,
    createCimmichDocumentCommandId,
    detachCimmichDocumentLinks,
    getCimmichAssetEvidence,
    getCimmichDocument,
    getCimmichDocumentContent,
    getCimmichDocuments,
    importCimmichDocument,
    referenceCimmichDocument,
    setCimmichVisibilityObject,
    undoCimmichDocumentDecision,
    undoCimmichVisibilityDecision,
    updateCimmichDocument,
    type CimmichDocument,
    type CimmichDocumentKind,
    type CimmichDocumentRelationKind,
    type CimmichDocumentSubjectKind,
    type CimmichVisibilityTier,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, searchAssets, type AssetResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiArchiveArrowDownOutline,
    mdiArrowLeft,
    mdiClose,
    mdiDownload,
    mdiFileDocumentOutline,
    mdiFileUploadOutline,
    mdiFolderImage,
    mdiLinkPlus,
    mdiMagnify,
    mdiOpenInNew,
    mdiPencilOutline,
    mdiPlus,
    mdiRestore,
    mdiUndoVariant,
  } from '@mdi/js';
  import { onDestroy, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    documentKindOptions,
    documentRelationOptions,
    documentSubjectHref,
    formatDocumentBytes,
    formatDocumentDate,
    labelForDocumentKind,
  } from './document-presentation';
  import { filterVisibleCimmichAssets } from './asset-picker-visibility';

  type Subject = { id: string; kind: CimmichDocumentSubjectKind; name: string };
  type UndoReceipt = { decisionId: string; kind: 'document' | 'visibility'; message: string };
  interface Props {
    heading?: string;
    initialDocumentId?: string;
    initialQuery?: string;
    onDocumentChange?: (documentId: string | null) => void;
    subject?: Subject;
  }

  let { heading = 'Documents', initialDocumentId = '', initialQuery = '', onDocumentChange, subject }: Props = $props();
  let documents = $state<CimmichDocument[]>([]);
  let loaded = $state(false);
  let error = $state<CimmichServiceError | null>(null);
  let query = $state(untrack(() => initialQuery));
  let kindFilter = $state<CimmichDocumentKind | ''>('');
  let showArchived = $state(false);
  let selected = $state<CimmichDocument | null>(null);
  let selectedLoading = $state(false);
  let showEditor = $state(false);
  let editorMode = $state<'create' | 'edit'>('create');
  let sourceMode = $state<'import' | 'reference'>('import');
  let title = $state('');
  let kind = $state<CimmichDocumentKind>('certificate');
  let customKind = $state('');
  let issuedOn = $state('');
  let expiresOn = $state('');
  let tier = $state<CimmichVisibilityTier>('standard');
  let relationKind = $state<CimmichDocumentRelationKind>('about');
  let selectedFile = $state<File | null>(null);
  let selectedAsset = $state<AssetResponseDto | null>(null);
  let editTarget = $state<{ documentId: string; visibilityTier: CimmichVisibilityTier } | null>(null);
  let libraryAssets = $state<AssetResponseDto[]>([]);
  let libraryLoaded = $state(false);
  let libraryQuery = $state('');
  let saving = $state(false);
  let editorError = $state('');
  let commandId = $state('');
  let showLinkExisting = $state(false);
  let availableDocuments = $state<CimmichDocument[]>([]);
  let availableLoading = $state(false);
  let linkCommandId = $state('');
  let undoReceipt = $state<UndoReceipt | null>(null);
  let undoCommandId = $state('');
  let previewUrl = $state('');
  let previewMime = $state('');
  let previewLoading = $state(false);
  let contentError = $state('');
  let titleInput = $state<HTMLInputElement>();
  const objectUrls = new SvelteSet<string>();

  const asError = (caught: unknown) =>
    caught instanceof CimmichServiceError
      ? caught
      : new CimmichServiceError(
          caught instanceof Error ? caught.message : 'The Document request could not be completed.',
          {
            code: 'CIMMICH_REQUEST_FAILED',
            status: 0,
          },
        );

  const readableError = (caught: unknown) => {
    const typed = asError(caught);
    const copy: Record<string, string> = {
      DOCUMENT_COMMAND_CONFLICT: 'This retry belongs to different Document details. Close and try again.',
      DOCUMENT_CONTENT_INTEGRITY_FAILED: 'The stored file failed its integrity check and was not opened.',
      DOCUMENT_CONTENT_MISSING: 'The stored file is missing. Its Document record is unchanged.',
      DOCUMENT_DATE_INVALID: 'Check the issue and expiry dates. Expiry cannot be earlier than issue.',
      DOCUMENT_FIELD_INVALID: 'Check the title and Document details.',
      DOCUMENT_KIND_INVALID: 'Choose a Document type and name Other types.',
      DOCUMENT_NOT_FOUND: 'This Document is unavailable in the current viewing mode.',
      DOCUMENT_SOURCE_ALREADY_REFERENCED: 'That library item already has a Document record.',
      DOCUMENT_STORE_NOT_CONFIGURED: 'Local Document import is not configured. You can still reference library items.',
      DOCUMENT_STORE_QUOTA_EXCEEDED: 'The local Document store does not have enough available space.',
      DOCUMENT_TOO_LARGE: 'This file is larger than the configured Document limit.',
    };
    return copy[typed.code] ?? typed.message;
  };

  let listRequestGeneration = 0;
  let detailRequestGeneration = 0;
  let appliedInitialDocumentId = '';

  const load = async () => {
    const generation = ++listRequestGeneration;
    loaded = false;
    error = null;
    if (!initialDocumentId) {
      selected = null;
    }
    try {
      const result = await getCimmichDocuments({
        documentKind: kindFilter,
        includeArchived: showArchived,
        limit: 200,
        query,
        ...(subject ? { subjectId: subject.id, subjectKind: subject.kind } : {}),
      });
      if (generation === listRequestGeneration) {
        documents = result.items;
        if (initialDocumentId && selected?.documentId !== initialDocumentId) {
          void openDetail({ documentId: initialDocumentId }, false);
        }
      }
    } catch (error_) {
      if (generation === listRequestGeneration) {
        error = asError(error_);
      }
    } finally {
      if (generation === listRequestGeneration) {
        loaded = true;
      }
    }
  };

  const openDetail = async (document: Pick<CimmichDocument, 'documentId'>, notify = true) => {
    const generation = ++detailRequestGeneration;
    selectedLoading = true;
    error = null;
    clearPreview();
    try {
      const next = await getCimmichDocument(document.documentId);
      if (generation === detailRequestGeneration) {
        selected = next;
        if (notify) {
          onDocumentChange?.(next.documentId);
        }
      }
    } catch (error_) {
      if (generation === detailRequestGeneration) {
        error = asError(error_);
      }
    } finally {
      if (generation === detailRequestGeneration) {
        selectedLoading = false;
      }
    }
  };

  const resetEditor = () => {
    title = '';
    kind = 'certificate';
    customKind = '';
    issuedOn = '';
    expiresOn = '';
    tier = 'standard';
    relationKind = 'about';
    selectedFile = null;
    selectedAsset = null;
    editTarget = null;
    libraryQuery = '';
    editorError = '';
  };

  const openCreate = () => {
    editorMode = 'create';
    sourceMode = 'import';
    resetEditor();
    commandId = createCimmichDocumentCommandId('create');
    showEditor = true;
    void tick().then(() => titleInput?.focus());
  };

  const openEdit = () => {
    if (!selected) {
      return;
    }
    editorMode = 'edit';
    editTarget = {
      documentId: selected.documentId,
      visibilityTier: selected.visibilityTier,
    };
    title = selected.displayTitle;
    kind = selected.documentKind;
    customKind = selected.documentLabel ?? '';
    issuedOn = selected.issuedOn ?? '';
    expiresOn = selected.expiresOn ?? '';
    tier = selected.visibilityTier;
    editorError = '';
    commandId = createCimmichDocumentCommandId('update');
    showEditor = true;
    void tick().then(() => titleInput?.focus());
  };

  const loadLibrary = async () => {
    try {
      const result = await searchAssets({ metadataSearchDto: { size: 80, withExif: true } });
      const recent = result.assets.items.filter((asset) => !asset.isTrashed && !asset.isOffline);
      libraryAssets = await filterVisibleCimmichAssets(recent, getCimmichAssetEvidence);
      libraryLoaded = true;
    } catch (error_) {
      editorError = error_ instanceof Error ? error_.message : 'Your recent library could not be loaded.';
    }
  };

  const chooseSourceMode = (mode: 'import' | 'reference') => {
    sourceMode = mode;
    editorError = '';
    if (mode === 'reference' && !libraryLoaded) {
      void loadLibrary();
    }
  };

  const metadata = () => ({
    displayTitle: title.trim(),
    documentKind: kind,
    documentLabel: kind === 'other' ? customKind.trim() || null : null,
    expiresOn: expiresOn || null,
    issuedOn: issuedOn || null,
  });

  const createMetadata = () => ({ ...metadata(), visibilityTier: tier });

  const attachToSubject = async (documentId: string) => {
    if (!subject) {
      return null;
    }
    return attachCimmichDocumentLinks(documentId, createCimmichDocumentCommandId('link-subject'), [
      { relationKind, subjectId: subject.id, subjectKind: subject.kind },
    ]);
  };

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    editorError = '';
    if (!title.trim()) {
      editorError = 'Add a title people will recognise.';
      return;
    }
    if (kind === 'other' && !customKind.trim()) {
      editorError = 'Name this type of Document.';
      return;
    }
    if (expiresOn && issuedOn && expiresOn < issuedOn) {
      editorError = 'Expiry cannot be earlier than issue.';
      return;
    }
    saving = true;
    try {
      if (editorMode === 'edit' && editTarget) {
        const { documentId, visibilityTier: oldTier } = editTarget;
        const result = await updateCimmichDocument(documentId, { commandId, ...metadata() });
        let receipt: UndoReceipt | null = result.decisionId
          ? { decisionId: result.decisionId, kind: 'document', message: 'Document updated.' }
          : null;
        if (tier !== oldTier) {
          const visibility = await setCimmichVisibilityObject(
            'document',
            documentId,
            tier,
            createCimmichDocumentCommandId('visibility'),
          );
          receipt = {
            decisionId: visibility.decisionId,
            kind: 'visibility',
            message: 'Document visibility updated.',
          };
        }
        if (receipt) {
          undoReceipt = receipt;
          undoCommandId = createCimmichDocumentCommandId('undo');
        }
        commandId = '';
        showEditor = false;
        editTarget = null;
        await load();
        await openDetail({ documentId });
      } else {
        if (sourceMode === 'import' && !selectedFile) {
          editorError = 'Choose a file to import.';
          return;
        }
        if (sourceMode === 'reference' && !selectedAsset) {
          editorError = 'Choose a library item to reference.';
          return;
        }
        const result =
          sourceMode === 'import'
            ? await importCimmichDocument(selectedFile!, { commandId, ...createMetadata() })
            : await (async () => {
                const evidence = await getCimmichAssetEvidence(selectedAsset!.id);
                return referenceCimmichDocument({
                  assetId: evidence.asset_id,
                  commandId,
                  sourceFilename: selectedAsset!.originalFileName,
                  ...createMetadata(),
                });
              })();
        const linkResult = await attachToSubject(result.documentId);
        const decisionId = linkResult?.decisionId ?? result.decisionId;
        if (decisionId) {
          undoReceipt = {
            decisionId,
            kind: 'document',
            message: subject ? `Document linked to ${subject.name}.` : 'Document added.',
          };
          undoCommandId = createCimmichDocumentCommandId('undo');
        }
        commandId = '';
        showEditor = false;
        await load();
        await openDetail({ documentId: result.documentId });
      }
    } catch (error_) {
      editorError = readableError(error_);
    } finally {
      saving = false;
    }
  };

  const openExisting = async () => {
    if (!subject) {
      return;
    }
    showLinkExisting = true;
    availableLoading = true;
    editorError = '';
    linkCommandId = createCimmichDocumentCommandId('link-existing');
    try {
      const result = await getCimmichDocuments({ includeArchived: false, limit: 200 });
      const linked = new Set(documents.map((document) => document.documentId));
      availableDocuments = result.items.filter((document) => !linked.has(document.documentId));
    } catch (error_) {
      editorError = readableError(error_);
    } finally {
      availableLoading = false;
    }
  };

  const linkExisting = async (document: CimmichDocument) => {
    if (!subject) {
      return;
    }
    saving = true;
    editorError = '';
    try {
      const result = await attachCimmichDocumentLinks(document.documentId, linkCommandId, [
        { relationKind, subjectId: subject.id, subjectKind: subject.kind },
      ]);
      if (result.decisionId) {
        undoReceipt = {
          decisionId: result.decisionId,
          kind: 'document',
          message: `Document linked to ${subject.name}.`,
        };
        undoCommandId = createCimmichDocumentCommandId('undo');
      }
      showLinkExisting = false;
      await load();
    } catch (error_) {
      editorError = readableError(error_);
    } finally {
      saving = false;
    }
  };

  const unlinkFromSubject = async () => {
    if (!subject || !selected) {
      return;
    }
    const link = selected.links?.find((item) => item.subjectKind === subject.kind && item.subjectId === subject.id);
    if (!link) {
      return;
    }
    saving = true;
    try {
      const result = await detachCimmichDocumentLinks(
        selected.documentId,
        createCimmichDocumentCommandId('unlink-subject'),
        [{ relationKind: link.relationKind, subjectId: link.subjectId, subjectKind: link.subjectKind }],
      );
      if (result.decisionId) {
        undoReceipt = {
          decisionId: result.decisionId,
          kind: 'document',
          message: `Document removed from ${subject.name}.`,
        };
        undoCommandId = createCimmichDocumentCommandId('undo');
      }
      selected = null;
      onDocumentChange?.(null);
      await load();
    } catch (error_) {
      error = asError(error_);
    } finally {
      saving = false;
    }
  };

  const changeArchive = async () => {
    if (!selected) {
      return;
    }
    const documentId = selected.documentId;
    const archive = selected.status === 'active';
    if (archive && !globalThis.confirm(`Archive ${selected.displayTitle}? You can restore it later.`)) {
      return;
    }
    saving = true;
    try {
      const result = await updateCimmichDocument(selected.documentId, {
        commandId: createCimmichDocumentCommandId(archive ? 'archive' : 'restore'),
        status: archive ? 'archived' : 'active',
      });
      if (result.decisionId) {
        undoReceipt = {
          decisionId: result.decisionId,
          kind: 'document',
          message: archive ? 'Document archived.' : 'Document restored.',
        };
        undoCommandId = createCimmichDocumentCommandId('undo');
      }
      if (archive) {
        onDocumentChange?.(null);
      }
      await load();
      if (!archive) {
        await openDetail({ documentId });
      }
    } catch (error_) {
      error = asError(error_);
    } finally {
      saving = false;
    }
  };

  const undo = async () => {
    if (!undoReceipt) {
      return;
    }
    saving = true;
    try {
      await (undoReceipt.kind === 'visibility'
        ? undoCimmichVisibilityDecision(undoReceipt.decisionId, undoCommandId)
        : undoCimmichDocumentDecision(undoReceipt.decisionId, undoCommandId));
      undoReceipt = null;
      undoCommandId = '';
      selected = null;
      onDocumentChange?.(null);
      await load();
    } catch (error_) {
      error = asError(error_);
    } finally {
      saving = false;
    }
  };

  const clearPreview = () => {
    previewUrl = '';
    previewMime = '';
    contentError = '';
  };

  const loadContent = async (download = false) => {
    if (!selected) {
      return;
    }
    previewLoading = true;
    contentError = '';
    try {
      const content = await getCimmichDocumentContent(selected.documentId, { download });
      if (content.kind === 'immich_asset') {
        previewUrl = getAssetMediaUrl({ id: content.assetId, size: AssetMediaSize.Preview });
        previewMime = selected.source.mimeType || 'image/*';
        return;
      }
      const url = URL.createObjectURL(content.blob);
      objectUrls.add(url);
      if (download || content.disposition === 'attachment') {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = content.filename;
        anchor.click();
        return;
      }
      previewUrl = url;
      previewMime = content.mimeType;
    } catch (error_) {
      contentError = readableError(error_);
    } finally {
      previewLoading = false;
    }
  };

  const openExternal = async () => {
    if (!selected) {
      return;
    }
    if (selected.source.kind === 'immich_asset' && selected.source.assetId) {
      window.open(`/photos/${encodeURIComponent(selected.source.assetId)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    const target = window.open('', '_blank', 'noopener,noreferrer');
    try {
      const content = await getCimmichDocumentContent(selected.documentId);
      if (content.kind === 'immich_asset') {
        if (target) {
          target.location.href = `/photos/${encodeURIComponent(content.assetId)}`;
        }
        return;
      }
      const url = URL.createObjectURL(content.blob);
      objectUrls.add(url);
      if (target) {
        target.location.href = url;
      }
    } catch (error_) {
      target?.close();
      contentError = readableError(error_);
    }
  };

  $effect(() => {
    if (cimmichVisibilityManager.version >= 0) {
      untrack(() => {
        detailRequestGeneration += 1;
        documents = [];
        if (!initialDocumentId) {
          selected = null;
        }
        selectedAsset = null;
        libraryAssets = [];
        libraryLoaded = false;
        if (showEditor && sourceMode === 'reference') {
          void loadLibrary();
        }
        void load();
      });
    }
  });

  $effect(() => {
    const requestedDocumentId = initialDocumentId;
    if (requestedDocumentId === appliedInitialDocumentId) {
      return;
    }
    appliedInitialDocumentId = requestedDocumentId;
    untrack(() => {
      if (requestedDocumentId) {
        void openDetail({ documentId: requestedDocumentId }, false);
      } else {
        detailRequestGeneration += 1;
        selected = null;
        clearPreview();
      }
    });
  });

  onDestroy(() => {
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
  });
</script>

<section
  class="documents-shell"
  aria-label={heading ? undefined : subject ? `${subject.name} documents` : 'Documents'}
  aria-labelledby={heading ? 'documents-heading' : undefined}
>
  <div class:without-heading={!heading} class="document-toolbar">
    {#if heading}<h2 class="text-xl font-semibold whitespace-nowrap" id="documents-heading">{heading}</h2>{/if}
    {#if loaded && (documents.length > 0 || query || kindFilter || showArchived)}
      <form
        class="document-toolbar-search"
        role="search"
        onsubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label class="document-search">
          <Icon icon={mdiMagnify} size="20" />
          <span class="sr-only">Search documents</span>
          <input bind:value={query} placeholder="Search title or filename" maxlength="200" />
        </label>
        <label class="document-field compact"
          ><span class="sr-only">Document type</span><select bind:value={kindFilter} aria-label="Document type">
            <option value="">All types</option>
            {#each documentKindOptions as option (option.value)}<option value={option.value}>{option.label}</option
              >{/each}
          </select></label
        >
        <button class="document-secondary-button document-search-submit" type="submit" aria-label="Search">
          <Icon icon={mdiMagnify} size="18" /><span class="sr-only">Search</span>
        </button>
        <label class:active={showArchived} class="document-archive-toggle" title="Include archived">
          <input class="sr-only" type="checkbox" bind:checked={showArchived} onchange={() => void load()} />
          <Icon icon={mdiArchiveArrowDownOutline} size="18" /><span class="sr-only">Include archived</span>
        </label>
      </form>
    {/if}
    <div class="document-toolbar-actions">
      {#if subject}<button class="document-secondary-button" type="button" onclick={() => void openExisting()}
          ><Icon icon={mdiLinkPlus} size="19" /> Link existing</button
        >{/if}
      <button class="document-primary-button" type="button" onclick={openCreate}
        ><Icon icon={mdiPlus} size="19" /> Add document</button
      >
    </div>
  </div>

  {#if undoReceipt}
    <div
      class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary/10 px-4 py-3 text-sm"
      role="status"
    >
      <p class="font-semibold">{undoReceipt.message}</p>
      <button class="document-secondary-button" disabled={saving} type="button" onclick={() => void undo()}
        ><Icon icon={mdiUndoVariant} size="18" /> Undo</button
      >
    </div>
  {/if}

  {#if error}
    <div
      class="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
      role="alert"
    >
      <p class="font-semibold">{readableError(error)}</p>
      <button
        class="mt-3 min-h-11 rounded-full px-4 font-semibold ring-1 ring-current"
        type="button"
        onclick={() => void load()}>Try again</button
      >
    </div>
  {/if}

  {#if selectedLoading}
    <p class="py-14 text-center text-sm text-gray-500" role="status">Loading document…</p>
  {:else if selected}
    <article
      class="mt-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 dark:border-gray-800 dark:bg-gray-900"
    >
      <button
        class="document-secondary-button"
        type="button"
        onclick={() => {
          selected = null;
          clearPreview();
          onDocumentChange?.(null);
        }}><Icon icon={mdiArrowLeft} size="18" /> Back</button
      >
      <div class="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs font-bold tracking-[0.14em] text-primary uppercase">
            {labelForDocumentKind(selected.documentKind, selected.documentLabel)}
          </p>
          <h3 class="mt-2 max-w-full text-2xl font-semibold wrap-anywhere">{selected.displayTitle}</h3>
          <p class="mt-2 text-sm break-all text-gray-500">{selected.source.filename}</p>
        </div>
        <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold capitalize dark:bg-gray-800"
          >{selected.effectiveVisibilityTier}</span
        >
      </div>
      <dl class="mt-5 grid gap-3 sm:grid-cols-3">
        <div class="document-fact">
          <dt>Issued</dt>
          <dd>{formatDocumentDate(selected.issuedOn) || 'Not set'}</dd>
        </div>
        <div class="document-fact">
          <dt>Expires</dt>
          <dd>{formatDocumentDate(selected.expiresOn) || 'Not set'}</dd>
        </div>
        <div class="document-fact">
          <dt>Source</dt>
          <dd>
            {selected.source.kind === 'cimmich_file'
              ? `Imported${formatDocumentBytes(selected.source.byteSize) ? ` · ${formatDocumentBytes(selected.source.byteSize)}` : ''}`
              : 'Photo library'}
          </dd>
        </div>
      </dl>
      <div class="mt-5 flex flex-wrap gap-2">
        {#if selected.preview.available}<button
            class="document-primary-button"
            disabled={previewLoading}
            type="button"
            onclick={() => void loadContent(false)}>{previewLoading ? 'Opening…' : 'Preview'}</button
          >{/if}
        <button class="document-secondary-button" type="button" onclick={() => void openExternal()}
          ><Icon icon={mdiOpenInNew} size="18" /> Open in new tab</button
        >
        {#if selected.source.kind === 'cimmich_file'}<button
            class="document-secondary-button"
            type="button"
            onclick={() => void loadContent(true)}><Icon icon={mdiDownload} size="18" /> Download</button
          >{/if}
        <button class="document-secondary-button" type="button" onclick={openEdit}
          ><Icon icon={mdiPencilOutline} size="18" /> Edit</button
        >
        {#if subject}<button
            class="document-secondary-button danger"
            disabled={saving}
            type="button"
            onclick={() => void unlinkFromSubject()}>Remove link</button
          >{/if}
        <button class="document-secondary-button" disabled={saving} type="button" onclick={() => void changeArchive()}>
          <Icon icon={selected.status === 'archived' ? mdiRestore : mdiArchiveArrowDownOutline} size="18" />
          {selected.status === 'archived' ? 'Restore' : 'Archive'}
        </button>
      </div>
      {#if contentError}<p class="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">{contentError}</p>{/if}
      {#if previewUrl}
        <div
          class="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950"
        >
          {#if previewMime.startsWith('image/')}<img
              class="mx-auto max-h-[65vh] object-contain"
              src={previewUrl}
              alt={`Preview of ${selected.displayTitle}`}
            />
          {:else}<iframe
              class="h-[65vh] w-full"
              src={previewUrl}
              sandbox=""
              title={`Preview of ${selected.displayTitle}`}
            ></iframe>{/if}
        </div>
      {/if}
      <div class="mt-6">
        <h4 class="text-sm font-semibold">Linked to</h4>
        {#if selected.links?.length}<ul class="mt-3 flex flex-wrap gap-2">
            {#each selected.links as link (`${link.subjectKind}:${link.subjectId}:${link.relationKind}`)}<li>
                <a class="document-link-card" href={documentSubjectHref(link)}>
                  <span>{link.displayName}</span>
                  <small>
                    {link.subjectKind === 'object'
                      ? 'Thing'
                      : `${link.subjectKind[0].toUpperCase()}${link.subjectKind.slice(1)}`}
                    · {documentRelationOptions.find((item) => item.value === link.relationKind)?.label}
                  </small>
                </a>
              </li>{/each}
          </ul>
        {:else}<p class="mt-2 text-sm text-gray-500">Not linked to a person, pet, place, thing or event.</p>{/if}
      </div>
    </article>
  {:else if !loaded}
    <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading documents" aria-busy="true">
      {#each Array.from({ length: 3 }) as _, index (index)}<div
          class="h-36 animate-pulse rounded-3xl bg-gray-100 dark:bg-gray-800"
        ></div>{/each}
    </div>
  {:else if documents.length === 0}
    <div class="mt-5 rounded-3xl border border-dashed border-gray-300 px-6 py-14 text-center dark:border-gray-700">
      <Icon class="mx-auto text-gray-400" icon={mdiFileDocumentOutline} size="34" />
      <p class="mt-4 font-semibold">
        {query || kindFilter
          ? 'No documents match'
          : subject
            ? `No documents linked to ${subject.name}`
            : 'No documents yet'}
      </p>
      <p class="mx-auto mt-2 max-w-md text-sm/6 text-gray-500">
        {subject
          ? 'Add a new document or link an existing Cimmich record using the actions above.'
          : 'Import a local file or reference an existing item from your photo library.'}
      </p>
    </div>
  {:else}
    <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each documents as document (document.documentId)}
        <button class="document-visual-card" type="button" onclick={() => void openDetail(document)}>
          <span class="document-card-preview">
            {#if document.source.kind === 'immich_asset' && document.source.assetId}
              <img
                src={getAssetMediaUrl({ id: document.source.assetId, size: AssetMediaSize.Thumbnail })}
                alt={`Preview of ${document.displayTitle}`}
              />
            {:else}
              <span class="document-card-fallback">
                <Icon icon={mdiFileDocumentOutline} size="34" />
                <span>{labelForDocumentKind(document.documentKind, document.documentLabel)}</span>
              </span>
            {/if}
            <span class="document-card-tier">{document.effectiveVisibilityTier}</span>
          </span>
          <span class="document-card-copy">
            <span class="line-clamp-2 block text-base/5 font-semibold">{document.displayTitle}</span>
            <span class="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
              {labelForDocumentKind(document.documentKind, document.documentLabel)}
              {#if document.issuedOn}
                · {formatDocumentDate(document.issuedOn)}{/if}
            </span>
            <span class="mt-2 block truncate text-xs text-gray-400">{document.source.filename}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</section>

{#if showEditor}
  <div
    class="document-dialog-backdrop"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape' && !saving) {
        showEditor = false;
      }
    }}
  >
    <div
      class="document-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-editor-heading"
      use:focusTrap
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-xs font-bold tracking-[0.14em] text-primary uppercase">Document</p>
          <h2 class="mt-1 text-2xl font-semibold" id="document-editor-heading">
            {editorMode === 'create' ? 'Add a document' : `Edit ${selected?.displayTitle}`}
          </h2>
        </div>
        <button
          class="document-icon-button"
          disabled={saving}
          type="button"
          aria-label="Close"
          onclick={() => (showEditor = false)}><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      {#if editorMode === 'create'}
        <div class="mt-6 grid grid-cols-2 gap-2" role="group" aria-label="Document source">
          <button
            class:active={sourceMode === 'import'}
            class="document-source-button"
            type="button"
            onclick={() => chooseSourceMode('import')}
            ><Icon icon={mdiFileUploadOutline} size="21" /> Import file</button
          >
          <button
            class:active={sourceMode === 'reference'}
            class="document-source-button"
            type="button"
            onclick={() => chooseSourceMode('reference')}><Icon icon={mdiFolderImage} size="21" /> Photo library</button
          >
        </div>
      {/if}
      <form class="mt-6 grid gap-4" onsubmit={(event) => void save(event)}>
        <label class="document-field"
          ><span>Title</span><input
            bind:this={titleInput}
            bind:value={title}
            maxlength="240"
            placeholder="For example, Home insurance policy"
          /></label
        >
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="document-field"
            ><span>Type</span><select bind:value={kind}
              >{#each documentKindOptions as option (option.value)}<option value={option.value}>{option.label}</option
                >{/each}</select
            ></label
          >
          {#if kind === 'other'}<label class="document-field"
              ><span>Type name</span><input
                bind:value={customKind}
                maxlength="120"
                placeholder="For example, School record"
              /></label
            >{/if}
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="document-field"><span>Issued</span><input type="date" bind:value={issuedOn} /></label><label
            class="document-field"><span>Expires</span><input type="date" bind:value={expiresOn} /></label
          >
        </div>
        <label class="document-field"
          ><span>Visibility</span><select
            value={tier}
            onchange={(event) => (tier = event.currentTarget.value as CimmichVisibilityTier)}
            ><option value="standard">Standard</option><option value="personal">Personal</option><option value="private"
              >Private</option
            ></select
          ></label
        >
        {#if editorMode === 'create' && sourceMode === 'import'}
          <label class="document-file"
            ><Icon icon={mdiFileUploadOutline} size="25" /><span
              ><strong>{selectedFile?.name ?? 'Choose a file'}</strong><small
                >{selectedFile ? formatDocumentBytes(selectedFile.size) : 'Up to the configured local limit'}</small
              ></span
            ><input
              class="sr-only"
              type="file"
              onchange={(event) => (selectedFile = event.currentTarget.files?.[0] ?? null)}
            /></label
          >
        {:else if editorMode === 'create'}
          <div>
            {#if !libraryLoaded}<p class="py-6 text-center text-sm text-gray-500">Loading recent library items…</p>
            {:else}<label class="document-search"
                ><Icon icon={mdiMagnify} size="19" /><span class="sr-only">Filter library items</span><input
                  bind:value={libraryQuery}
                  placeholder="Filter recent items"
                /></label
              >
              <div class="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                {#each libraryAssets.filter((asset) => asset.originalFileName
                    .toLowerCase()
                    .includes(libraryQuery.toLowerCase())) as asset (asset.id)}<button
                    class:selected={selectedAsset?.id === asset.id}
                    class="document-asset"
                    type="button"
                    aria-label={`Use ${asset.originalFileName}`}
                    aria-pressed={selectedAsset?.id === asset.id}
                    onclick={() => (selectedAsset = asset)}
                    ><img src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail })} alt="" /><span
                      class="sr-only">{asset.originalFileName}</span
                    ></button
                  >{/each}
              </div>{/if}
          </div>
        {/if}
        {#if editorMode === 'create' && subject}<label class="document-field"
            ><span>Link to {subject.name} as</span><select bind:value={relationKind}
              >{#each documentRelationOptions as option (option.value)}<option value={option.value}
                  >{option.label}</option
                >{/each}</select
            ></label
          >{/if}
        {#if editorError}<p
            class="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {editorError}
          </p>{/if}
        <div class="flex justify-end gap-2">
          <button class="document-secondary-button" disabled={saving} type="button" onclick={() => (showEditor = false)}
            >Cancel</button
          ><button class="document-primary-button" disabled={saving} type="submit"
            >{saving ? 'Saving…' : editorMode === 'create' ? 'Add document' : 'Save'}</button
          >
        </div>
      </form>
    </div>
  </div>
{/if}

{#if showLinkExisting && subject}
  <div
    class="document-dialog-backdrop"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape' && !saving) {
        showLinkExisting = false;
      }
    }}
  >
    <div class="document-dialog" role="dialog" aria-modal="true" aria-labelledby="link-document-heading" use:focusTrap>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-xs font-bold tracking-[0.14em] text-primary uppercase">{subject.name}</p>
          <h2 class="mt-1 text-2xl font-semibold" id="link-document-heading">Link an existing document</h2>
        </div>
        <button class="document-icon-button" type="button" aria-label="Close" onclick={() => (showLinkExisting = false)}
          ><Icon icon={mdiClose} size="22" /></button
        >
      </div>
      <label class="document-field mt-5"
        ><span>Relationship</span><select bind:value={relationKind}
          >{#each documentRelationOptions as option (option.value)}<option value={option.value}>{option.label}</option
            >{/each}</select
        ></label
      >
      {#if editorError}<p class="mt-4 text-sm text-red-700" role="alert">{editorError}</p>{/if}
      {#if availableLoading}<p class="py-10 text-center text-sm text-gray-500">Loading documents…</p>
      {:else if availableDocuments.length === 0}<p class="py-10 text-center text-sm text-gray-500">
          Every available document is already linked.
        </p>
      {:else}<div class="mt-4 grid max-h-[55vh] gap-2 overflow-y-auto">
          {#each availableDocuments as document (document.documentId)}<button
              class="document-card"
              disabled={saving}
              type="button"
              onclick={() => void linkExisting(document)}
              ><span class="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"
                ><Icon icon={mdiFileDocumentOutline} size="21" /></span
              ><span class="min-w-0 flex-1 text-left"
                ><span class="block truncate font-semibold">{document.displayTitle}</span><span
                  class="mt-1 block truncate text-xs text-gray-500"
                  >{labelForDocumentKind(document.documentKind, document.documentLabel)} · {document.source
                    .filename}</span
                ></span
              ><Icon icon={mdiLinkPlus} size="20" /></button
            >{/each}
        </div>{/if}
    </div>
  </div>
{/if}

<style>
  :global(.documents-shell) {
    width: 100%;
  }
  :global(.document-toolbar) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  :global(.document-toolbar-actions),
  :global(.document-toolbar-search) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  :global(.document-toolbar-search) {
    min-width: min(100%, 22rem);
    flex: 1 1 22rem;
  }
  :global(.document-toolbar-search .document-search) {
    min-width: 7.5rem;
    flex: 1 1 9rem;
  }
  :global(.document-toolbar-search .document-field) {
    width: 7.5rem;
    flex: 0 0 7.5rem;
  }
  :global(.document-search-submit) {
    width: 2.75rem;
    flex: 0 0 2.75rem;
    padding-inline: 0;
  }
  :global(.document-archive-toggle) {
    display: inline-flex;
    width: 2.75rem;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    flex: 0 0 2.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 9999px;
    white-space: nowrap;
    font-size: 0.75rem;
    font-weight: 650;
    cursor: pointer;
  }
  :global(.dark .document-archive-toggle) {
    border-color: rgb(75 85 99);
  }
  :global(.document-archive-toggle.active) {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }
  :global(.document-primary-button),
  :global(.document-secondary-button),
  :global(.document-icon-button) {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border-radius: 9999px;
    padding: 0.55rem 1rem;
    font-size: 0.875rem;
    font-weight: 650;
    transition: 150ms;
  }
  :global(.document-primary-button) {
    background: var(--color-primary);
    color: white;
  }
  :global(.document-primary-button:hover) {
    filter: brightness(0.94);
  }
  :global(.document-secondary-button) {
    border: 1px solid rgb(209 213 219);
    background: transparent;
  }
  :global(.dark .document-secondary-button) {
    border-color: rgb(75 85 99);
  }
  :global(.document-secondary-button:hover),
  :global(.document-icon-button:hover) {
    background: rgb(243 244 246);
  }
  :global(.dark .document-secondary-button:hover),
  :global(.dark .document-icon-button:hover) {
    background: rgb(31 41 55);
  }
  :global(.document-secondary-button.danger) {
    color: rgb(185 28 28);
  }
  :global(.document-icon-button) {
    width: 2.75rem;
    padding: 0;
    border-radius: 9999px;
  }
  :global(.document-primary-button:focus-visible),
  :global(.document-secondary-button:focus-visible),
  :global(.document-icon-button:focus-visible),
  :global(.document-card:focus-visible),
  :global(.document-source-button:focus-visible),
  :global(.document-asset:focus-visible) {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  :global(.document-search) {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.6rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 9999px;
    padding: 0 0.9rem;
  }
  :global(.dark .document-search) {
    border-color: rgb(75 85 99);
  }
  :global(.document-search input) {
    min-width: 0;
    width: 100%;
    background: transparent;
    outline: none;
  }
  :global(.document-field) {
    display: grid;
    gap: 0.35rem;
    font-size: 0.875rem;
    font-weight: 600;
  }
  :global(.document-field input),
  :global(.document-field select) {
    min-height: 2.75rem;
    width: 100%;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.8rem;
    background: transparent;
    padding: 0.65rem 0.8rem;
    font-weight: 400;
    outline: none;
  }
  :global(.dark .document-field input),
  :global(.dark .document-field select) {
    border-color: rgb(75 85 99);
  }
  :global(.document-field input:focus),
  :global(.document-field select:focus) {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 15%, transparent);
  }
  :global(.document-field.compact span) {
    display: none;
  }
  :global(.document-card) {
    display: flex;
    min-height: 7.5rem;
    width: 100%;
    align-items: flex-start;
    gap: 0.85rem;
    border: 1px solid rgb(229 231 235);
    border-radius: 1.25rem;
    background: white;
    padding: 1rem;
    text-align: left;
    transition: 150ms;
  }
  :global(.dark .document-card) {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }
  :global(.document-card:hover) {
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
    transform: translateY(-1px);
  }
  :global(.document-visual-card) {
    display: grid;
    width: 100%;
    overflow: hidden;
    border: 1px solid rgb(229 231 235);
    border-radius: 1.25rem;
    background: white;
    text-align: left;
    transition: 150ms;
  }
  :global(.dark .document-visual-card) {
    border-color: rgb(31 41 55);
    background: rgb(17 24 39);
  }
  :global(.document-visual-card:hover) {
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
    box-shadow: 0 12px 28px rgb(15 23 42 / 0.1);
    transform: translateY(-2px);
  }
  :global(.document-visual-card:focus-visible) {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  :global(.document-card-preview) {
    position: relative;
    display: block;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: rgb(243 244 246);
  }
  :global(.dark .document-card-preview) {
    background: rgb(31 41 55);
  }
  :global(.document-card-preview > img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 200ms;
  }
  :global(.document-visual-card:hover .document-card-preview > img) {
    transform: scale(1.025);
  }
  :global(.document-card-fallback) {
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 0.55rem;
    color: var(--color-primary);
  }
  :global(.document-card-fallback > span) {
    font-size: 0.7rem;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  :global(.document-card-tier) {
    position: absolute;
    top: 0.65rem;
    right: 0.65rem;
    border-radius: 9999px;
    background: rgb(17 24 39 / 0.78);
    padding: 0.3rem 0.55rem;
    color: white;
    font-size: 0.65rem;
    font-weight: 750;
    text-transform: capitalize;
    backdrop-filter: blur(8px);
  }
  :global(.document-card-copy) {
    display: block;
    min-width: 0;
    padding: 0.9rem 1rem 1rem;
  }
  :global(.document-fact) {
    border-radius: 1rem;
    background: rgb(249 250 251);
    padding: 1rem;
  }
  :global(.dark .document-fact) {
    background: rgb(31 41 55);
  }
  :global(.document-fact dt) {
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }
  :global(.document-fact dd) {
    margin-top: 0.3rem;
    font-size: 0.875rem;
    font-weight: 650;
  }
  :global(.document-link-card) {
    display: grid;
    min-width: 10rem;
    gap: 0.15rem;
    border: 1px solid rgb(229 231 235);
    border-radius: 1rem;
    padding: 0.65rem 0.85rem;
    transition: 150ms;
  }
  :global(.dark .document-link-card) {
    border-color: rgb(55 65 81);
    background: rgb(31 41 55 / 0.55);
  }
  :global(.document-link-card:hover) {
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
    color: var(--color-primary);
  }
  :global(.document-link-card:focus-visible) {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  :global(.document-link-card span) {
    font-size: 0.82rem;
    font-weight: 700;
  }
  :global(.document-link-card small) {
    color: rgb(107 114 128);
    font-size: 0.7rem;
  }
  :global(.document-dialog-backdrop) {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgb(0 0 0 / 0.58);
  }
  :global(.document-dialog) {
    max-height: 94vh;
    width: 100%;
    overflow-y: auto;
    border-radius: 2rem 2rem 0 0;
    background: white;
    padding: 1.5rem;
    color: var(--color-immich-fg);
    box-shadow: 0 24px 70px rgb(0 0 0 / 0.35);
  }
  :global(.dark .document-dialog) {
    background: rgb(17 24 39);
    color: var(--color-immich-dark-fg);
  }
  :global(.document-source-button) {
    display: flex;
    min-height: 3.25rem;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 1rem;
    font-size: 0.875rem;
    font-weight: 650;
  }
  :global(.document-source-button.active) {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
  }
  :global(.document-file) {
    display: flex;
    min-height: 5rem;
    cursor: pointer;
    align-items: center;
    gap: 0.8rem;
    border: 1px dashed rgb(156 163 175);
    border-radius: 1rem;
    padding: 1rem;
  }
  :global(.document-file span) {
    display: grid;
    gap: 0.2rem;
  }
  :global(.document-file small) {
    color: rgb(107 114 128);
  }
  :global(.document-asset) {
    aspect-ratio: 1;
    overflow: hidden;
    border: 3px solid transparent;
    border-radius: 0.8rem;
    background: rgb(229 231 235);
  }
  :global(.document-asset.selected) {
    border-color: var(--color-primary);
  }
  :global(.document-asset img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  @media (min-width: 640px) {
    :global(.document-dialog-backdrop) {
      align-items: center;
      padding: 1.5rem;
    }
    :global(.document-dialog) {
      max-width: 44rem;
      border-radius: 2rem;
      padding: 2rem;
    }
  }
  @media (min-width: 1024px) {
    :global(.document-toolbar) {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr) max-content;
      flex-wrap: nowrap;
    }
    :global(.document-toolbar.without-heading) {
      grid-template-columns: minmax(0, 1fr) max-content;
    }
    :global(.document-toolbar-actions .document-primary-button),
    :global(.document-toolbar-actions .document-secondary-button) {
      min-height: 2.5rem;
      padding: 0.45rem 0.75rem;
    }
    :global(.document-toolbar-search) {
      min-width: 0;
      flex-wrap: nowrap;
    }
  }
  @media (max-width: 767px) {
    :global(.document-toolbar),
    :global(.document-toolbar-actions),
    :global(.document-toolbar-search) {
      width: 100%;
    }
    :global(.document-toolbar-actions > button) {
      flex: 1;
    }
    :global(.document-toolbar-search) {
      flex-wrap: wrap;
    }
    :global(.document-toolbar-search .document-search) {
      flex-basis: 100%;
    }
  }
</style>
