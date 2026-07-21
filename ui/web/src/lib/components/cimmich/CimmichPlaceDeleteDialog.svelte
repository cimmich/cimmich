<script lang="ts">
  import { focusTrap } from '$lib/actions/focus-trap';
  import { Icon } from '@immich/ui';
  import { mdiAlertOutline, mdiClose, mdiTrashCanOutline } from '@mdi/js';

  interface Props {
    displayName: string;
    entityLabel?: 'Place' | 'Thing';
    error?: string;
    isDeleting?: boolean;
    oncancel: () => void;
    onconfirm: (deleteTags: boolean) => void;
    tagCount: number;
  }

  let {
    displayName,
    entityLabel = 'Place',
    error = '',
    isDeleting = false,
    oncancel,
    onconfirm,
    tagCount,
  }: Props = $props();
  let deleteTags = $state(false);
  const entityLabelLower = $derived(entityLabel.toLowerCase());
  const tagLabel = $derived(`${tagCount.toLocaleString()} Cimmich photo ${tagCount === 1 ? 'tag' : 'tags'}`);
</script>

<div
  class="place-delete-backdrop"
  role="presentation"
  onkeydown={(event) => {
    if (event.key === 'Escape' && !isDeleting) {
      oncancel();
    }
  }}
>
  <div
    class="place-delete-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="place-delete-heading"
    aria-describedby="place-delete-description"
    use:focusTrap
  >
    <button class="place-delete-close" type="button" aria-label="Close" disabled={isDeleting} onclick={oncancel}>
      <Icon icon={mdiClose} size="22" />
    </button>

    <div class="place-delete-icon" aria-hidden="true"><Icon icon={mdiTrashCanOutline} size="25" /></div>
    <p class="place-delete-eyebrow">Permanent deletion</p>
    <h2 id="place-delete-heading">Delete {displayName}?</h2>
    <p id="place-delete-description">
      This permanently removes the {entityLabel} from Cimmich. It will disappear from {entityLabel}s, search and
      connected context. Its aliases, connections and document links are removed too. This cannot be undone.
    </p>

    <label class="place-delete-choice">
      <input type="checkbox" bind:checked={deleteTags} disabled={isDeleting} />
      <span>
        <strong>Also delete {tagLabel}</strong>
        <small>
          {#if deleteTags}
            The links between this {entityLabel} and its photos will be permanently removed from Cimmich.
          {:else}
            Leave off to retain the tags against the deleted {entityLabel} record, outside the active {entityLabel}s UI.
          {/if}
        </small>
      </span>
    </label>

    <div class="place-delete-safety">
      <Icon icon={mdiAlertOutline} size="21" />
      <p>
        <strong>Your photos and videos are untouched.</strong>
        This does not alter raw media or write to the Immich database.
      </p>
    </div>

    {#if error}<p class="place-delete-error" role="alert">{error}</p>{/if}

    <div class="place-delete-actions">
      <button class="place-delete-cancel" type="button" disabled={isDeleting} onclick={oncancel}>Cancel</button>
      <button class="place-delete-confirm" type="button" disabled={isDeleting} onclick={() => onconfirm(deleteTags)}>
        <Icon icon={mdiTrashCanOutline} size="19" />
        {isDeleting ? 'Deleting…' : deleteTags ? `Delete ${entityLabelLower} and tags` : `Delete ${entityLabelLower}`}
      </button>
    </div>
  </div>
</div>

<style>
  .place-delete-backdrop {
    position: fixed;
    z-index: 1100;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(0 0 0 / 0.64);
  }

  .place-delete-dialog {
    position: relative;
    width: min(100%, 510px);
    border: 1px solid rgb(229 231 235);
    border-radius: 26px;
    padding: 28px;
    background: white;
    box-shadow: 0 28px 80px rgb(0 0 0 / 0.32);
    color: rgb(17 24 39);
  }

  .place-delete-close {
    position: absolute;
    top: 18px;
    right: 18px;
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 999px;
    color: rgb(75 85 99);
  }

  .place-delete-close:hover,
  .place-delete-close:focus-visible {
    background: rgb(243 244 246);
    outline: none;
  }

  .place-delete-icon {
    display: grid;
    width: 46px;
    height: 46px;
    place-items: center;
    border-radius: 15px;
    background: rgb(254 226 226);
    color: rgb(185 28 28);
  }

  .place-delete-eyebrow {
    margin-top: 18px;
    color: rgb(185 28 28);
    font-size: 0.72rem;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h2 {
    margin-top: 5px;
    padding-right: 42px;
    font-size: clamp(1.35rem, 3vw, 1.75rem);
    font-weight: 730;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  #place-delete-description {
    margin-top: 10px;
    color: rgb(75 85 99);
    font-size: 0.91rem;
    line-height: 1.5;
  }

  .place-delete-choice {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-top: 22px;
    border: 1px solid rgb(229 231 235);
    border-radius: 18px;
    padding: 15px;
    cursor: pointer;
  }

  .place-delete-choice:has(input:checked) {
    border-color: rgb(239 68 68 / 0.58);
    background: rgb(254 242 242);
  }

  .place-delete-choice input {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: rgb(185 28 28);
  }

  .place-delete-choice span,
  .place-delete-choice small {
    display: block;
  }

  .place-delete-choice strong {
    font-size: 0.9rem;
  }

  .place-delete-choice small {
    margin-top: 3px;
    color: rgb(75 85 99);
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .place-delete-safety {
    display: flex;
    gap: 10px;
    margin-top: 14px;
    border-radius: 16px;
    padding: 13px 14px;
    background: rgb(239 246 255);
    color: rgb(30 64 175);
    font-size: 0.78rem;
    line-height: 1.42;
  }

  .place-delete-safety :global(svg) {
    flex: none;
  }

  .place-delete-safety strong {
    display: block;
  }

  .place-delete-error {
    margin-top: 14px;
    border-radius: 14px;
    padding: 11px 13px;
    background: rgb(254 242 242);
    color: rgb(153 27 27);
    font-size: 0.82rem;
  }

  .place-delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }

  .place-delete-actions button {
    min-height: 44px;
    border-radius: 999px;
    padding: 0 18px;
    font-size: 0.86rem;
    font-weight: 700;
  }

  .place-delete-cancel {
    border: 1px solid rgb(209 213 219);
  }

  .place-delete-confirm {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    background: rgb(185 28 28);
    color: white;
  }

  .place-delete-confirm:hover,
  .place-delete-confirm:focus-visible {
    background: rgb(153 27 27);
    outline: none;
  }

  button:disabled,
  input:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  :global(.dark) .place-delete-dialog {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
    color: rgb(243 244 246);
  }

  :global(.dark) .place-delete-close:hover,
  :global(.dark) .place-delete-close:focus-visible {
    background: rgb(31 41 55);
  }

  :global(.dark) #place-delete-description,
  :global(.dark) .place-delete-choice small {
    color: rgb(156 163 175);
  }

  :global(.dark) .place-delete-choice {
    border-color: rgb(55 65 81);
  }

  :global(.dark) .place-delete-choice:has(input:checked) {
    border-color: rgb(239 68 68 / 0.5);
    background: rgb(69 10 10 / 0.34);
  }

  :global(.dark) .place-delete-safety {
    background: rgb(30 58 138 / 0.24);
    color: rgb(191 219 254);
  }

  @media (max-width: 540px) {
    .place-delete-backdrop {
      align-items: end;
      padding: 10px;
    }

    .place-delete-dialog {
      border-radius: 24px;
      padding: 22px;
    }

    .place-delete-actions {
      display: grid;
      grid-template-columns: 1fr;
    }

    .place-delete-confirm {
      justify-content: center;
      grid-row: 1;
    }
  }
</style>
