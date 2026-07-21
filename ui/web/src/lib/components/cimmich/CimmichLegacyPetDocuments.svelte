<script lang="ts">
  import {
    CimmichServiceError,
    adoptCimmichLegacyPetDocument,
    createCimmichDocumentCommandId,
    getCimmichLegacyPetDocumentLinks,
    undoCimmichLegacyPetDocumentAdoption,
    type CimmichLegacyPetDocumentLink,
    type CimmichVisibilityTier,
  } from '$lib/services/cimmich.service';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiClose, mdiFileMoveOutline, mdiUndoVariant } from '@mdi/js';
  import { onMount, tick } from 'svelte';
  import { labelForDocumentKind } from './document-presentation';

  interface Props {
    onchanged?: () => void;
    petId: string;
    petName: string;
  }

  let { onchanged, petId, petName }: Props = $props();
  let candidates = $state<CimmichLegacyPetDocumentLink[]>([]);
  let error = $state<CimmichServiceError | null>(null);
  let loaded = $state(false);
  let selected = $state<CimmichLegacyPetDocumentLink | null>(null);
  let displayTitle = $state('');
  let visibilityTier = $state<CimmichVisibilityTier>('standard');
  let commandId = $state('');
  let saving = $state(false);
  let actionError = $state('');
  let undoReceipt = $state<{ decisionId: string; displayTitle: string } | null>(null);
  let undoCommandId = $state('');
  let titleInput = $state<HTMLInputElement>();

  const asError = (caught: unknown) =>
    caught instanceof CimmichServiceError
      ? caught
      : new CimmichServiceError(caught instanceof Error ? caught.message : 'The record could not be updated.', {
          code: 'CIMMICH_REQUEST_FAILED',
          status: 0,
        });

  const readableError = (caught: unknown) => {
    const typed = asError(caught);
    const copy: Record<string, string> = {
      DOCUMENT_COMMAND_CONFLICT: 'This retry belongs to different details. Close and try again.',
      DOCUMENT_LEGACY_PET_ALREADY_ADOPTED: 'This record is already available in Documents.',
      DOCUMENT_LEGACY_PET_NOT_FOUND: 'This photo-linked record is no longer available.',
      DOCUMENT_LEGACY_PET_SOURCE_CONFLICT: 'That library item is already owned by an incompatible Document.',
      DOCUMENT_UNDO_STALE: 'This Document changed after it was added, so the earlier action cannot be undone.',
    };
    return copy[typed.code] ?? typed.message;
  };

  const load = async () => {
    error = null;
    try {
      const result = await getCimmichLegacyPetDocumentLinks({ petId });
      candidates = result.items;
    } catch (error_) {
      error = asError(error_);
    } finally {
      loaded = true;
    }
  };

  const openAdoption = (candidate: CimmichLegacyPetDocumentLink) => {
    selected = candidate;
    displayTitle =
      candidate.documentLabel || `${petName} ${labelForDocumentKind(candidate.documentKind).toLowerCase()}`;
    visibilityTier = 'standard';
    commandId = createCimmichDocumentCommandId('legacy-pet-adopt');
    actionError = '';
    void tick().then(() => titleInput?.focus());
  };

  const closeAdoption = () => {
    if (saving) {
      return;
    }
    selected = null;
    commandId = '';
    actionError = '';
  };

  const adopt = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!selected) {
      return;
    }
    if (!displayTitle.trim()) {
      actionError = 'Add a title people will recognise.';
      return;
    }
    saving = true;
    actionError = '';
    try {
      const result = await adoptCimmichLegacyPetDocument(selected.legacyAssociationId, {
        commandId,
        displayTitle: displayTitle.trim(),
        visibilityTier,
      });
      undoReceipt = { decisionId: result.decisionId, displayTitle: displayTitle.trim() };
      undoCommandId = createCimmichDocumentCommandId('legacy-pet-undo');
      selected = null;
      commandId = '';
      await load();
      onchanged?.();
    } catch (error_) {
      actionError = readableError(error_);
    } finally {
      saving = false;
    }
  };

  const undo = async () => {
    if (!undoReceipt) {
      return;
    }
    saving = true;
    error = null;
    try {
      await undoCimmichLegacyPetDocumentAdoption(undoReceipt.decisionId, undoCommandId);
      undoReceipt = null;
      undoCommandId = '';
      await load();
      onchanged?.();
    } catch (error_) {
      error = asError(error_);
    } finally {
      saving = false;
    }
  };

  onMount(() => void load());
</script>

{#if undoReceipt || error || (loaded && candidates.length > 0)}
  <section class="legacy-pet-bridge" aria-labelledby="legacy-pet-documents-heading">
    {#if undoReceipt}
      <div class="legacy-status" role="status" aria-live="polite">
        <p><strong>{undoReceipt.displayTitle}</strong> is now in Documents.</p>
        <button type="button" onclick={() => void undo()} disabled={saving}>
          <Icon icon={mdiUndoVariant} size="18" /> Undo
        </button>
      </div>
    {/if}

    {#if error}
      <div class="legacy-error" role="alert">
        <p>{readableError(error)}</p>
        <button type="button" onclick={() => void load()}>Try again</button>
      </div>
    {/if}

    {#if candidates.length > 0}
      <div class="legacy-heading">
        <span class="legacy-icon"><Icon icon={mdiFileMoveOutline} size="22" /></span>
        <div>
          <h2 id="legacy-pet-documents-heading">Add photo-linked records to Documents</h2>
          <p>The original record stays photo-linked.</p>
        </div>
      </div>
      <div class="legacy-list">
        {#each candidates as candidate (candidate.legacyAssociationId)}
          <article>
            <div>
              <strong>{candidate.documentLabel || labelForDocumentKind(candidate.documentKind)}</strong>
              <span>{labelForDocumentKind(candidate.documentKind)}</span>
            </div>
            <button type="button" onclick={() => openAdoption(candidate)}>
              Add to Documents <Icon icon={mdiArrowRight} size="18" />
            </button>
          </article>
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#if selected}
  <div
    class="legacy-dialog-backdrop"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        closeAdoption();
      }
    }}
  >
    <div class="legacy-dialog" role="dialog" aria-modal="true" aria-labelledby="legacy-adoption-heading">
      <header>
        <div>
          <p>{petName}</p>
          <h2 id="legacy-adoption-heading">Add to Documents</h2>
        </div>
        <button type="button" aria-label="Close" onclick={closeAdoption} disabled={saving}>
          <Icon icon={mdiClose} size="22" />
        </button>
      </header>
      <form onsubmit={(event) => void adopt(event)}>
        <label>
          <span>Title</span>
          <input bind:this={titleInput} bind:value={displayTitle} maxlength="240" />
        </label>
        <label>
          <span>Visibility</span>
          <select bind:value={visibilityTier}>
            <option value="standard">Standard</option>
            <option value="personal">Personal</option>
            <option value="private">Private</option>
          </select>
        </label>
        <p class="legacy-dialog-note">The photo-linked record stays exactly where it is.</p>
        {#if actionError}<p class="legacy-dialog-error" role="alert">{actionError}</p>{/if}
        <footer>
          <button type="button" class="secondary" onclick={closeAdoption} disabled={saving}>Cancel</button>
          <button type="submit" class="primary" disabled={saving}>
            {saving ? 'Adding…' : 'Add to Documents'}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}

<style>
  .legacy-pet-bridge {
    border: 1px solid color-mix(in srgb, var(--immich-primary-color) 24%, transparent);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--immich-primary-color) 5%, transparent);
    padding: 1rem;
  }

  .legacy-heading,
  .legacy-status,
  .legacy-error,
  .legacy-list article,
  .legacy-dialog header,
  .legacy-dialog footer {
    display: flex;
    align-items: center;
  }

  .legacy-heading {
    gap: 0.75rem;
  }

  .legacy-icon {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    place-items: center;
    border-radius: 0.8rem;
    background: color-mix(in srgb, var(--immich-primary-color) 12%, transparent);
    color: var(--immich-primary-color);
  }

  .legacy-heading h2 {
    font-size: 1rem;
    font-weight: 700;
  }

  .legacy-heading p,
  .legacy-list span,
  .legacy-dialog-note {
    color: rgb(107 114 128);
    font-size: 0.82rem;
  }

  .legacy-list {
    display: grid;
    gap: 0.6rem;
    margin-top: 1rem;
  }

  .legacy-list article {
    justify-content: space-between;
    gap: 1rem;
    border-radius: 0.8rem;
    background: rgb(255 255 255 / 78%);
    padding: 0.75rem;
  }

  :global(.dark .legacy-list article) {
    background: rgb(20 20 20 / 58%);
  }

  .legacy-list strong,
  .legacy-list span {
    display: block;
  }

  .legacy-list button,
  .legacy-status button,
  .legacy-error button,
  .legacy-dialog button {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 0.65rem;
    padding: 0 0.85rem;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .legacy-list button,
  .legacy-dialog .primary {
    background: var(--immich-primary-color);
    color: white;
  }

  .legacy-status,
  .legacy-error {
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.8rem;
    border-radius: 0.8rem;
    padding: 0.75rem;
  }

  .legacy-status {
    background: rgb(236 253 245);
    color: rgb(6 78 59);
  }

  .legacy-error,
  .legacy-dialog-error {
    background: rgb(254 242 242);
    color: rgb(185 28 28);
  }

  :global(.dark .legacy-status) {
    background: rgb(6 78 59 / 42%);
    color: rgb(209 250 229);
  }

  :global(.dark .legacy-error),
  :global(.dark .legacy-dialog-error) {
    background: rgb(127 29 29 / 42%);
    color: rgb(254 226 226);
  }

  .legacy-dialog-backdrop {
    position: fixed;
    z-index: 100;
    display: grid;
    padding: 1rem;
    background: rgb(0 0 0 / 58%);
    inset: 0;
    place-items: center;
  }

  .legacy-dialog {
    width: min(30rem, 100%);
    max-height: calc(100vh - 2rem);
    overflow: auto;
    border-radius: 1.1rem;
    background: white;
    padding: 1.25rem;
    box-shadow: 0 24px 80px rgb(0 0 0 / 34%);
  }

  :global(.dark .legacy-dialog) {
    background: rgb(20 20 20);
  }

  .legacy-dialog header {
    justify-content: space-between;
    gap: 1rem;
  }

  .legacy-dialog header p {
    color: var(--immich-primary-color);
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .legacy-dialog h2 {
    margin-top: 0.2rem;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .legacy-dialog form {
    display: grid;
    gap: 1rem;
    margin-top: 1.25rem;
  }

  .legacy-dialog label span {
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .legacy-dialog input,
  .legacy-dialog select {
    width: 100%;
    min-height: 2.75rem;
    border: 1px solid rgb(209 213 219);
    border-radius: 0.65rem;
    background: transparent;
    padding: 0 0.75rem;
  }

  .legacy-dialog footer {
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .legacy-dialog .secondary {
    border: 1px solid rgb(209 213 219);
  }

  .legacy-list button:focus-visible,
  .legacy-status button:focus-visible,
  .legacy-error button:focus-visible,
  .legacy-dialog button:focus-visible,
  .legacy-dialog input:focus-visible,
  .legacy-dialog select:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--immich-primary-color) 38%, transparent);
    outline-offset: 2px;
  }

  @media (max-width: 480px) {
    .legacy-list article,
    .legacy-status,
    .legacy-error {
      align-items: stretch;
      flex-direction: column;
    }

    .legacy-list button,
    .legacy-status button,
    .legacy-error button {
      width: 100%;
    }
  }
</style>
