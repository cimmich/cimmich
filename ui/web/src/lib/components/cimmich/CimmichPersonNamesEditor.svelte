<script lang="ts">
  import {
    addCimmichPersonAlias,
    removeCimmichPersonAlias,
    setCimmichPersonDisplayName,
  } from '$lib/services/cimmich-person-names.service';
  import type { CimmichPersonSetup } from '$lib/services/cimmich.service';

  type NameKind = 'display' | 'former_name' | 'imported' | 'nickname';
  type Props = {
    disabled?: boolean;
    onchanged: (displayName?: string) => Promise<void> | void;
    personId: string;
    setup: CimmichPersonSetup;
  };

  let { disabled = false, onchanged, personId, setup }: Props = $props();
  let draft = $state('');
  let error = $state('');
  let kind = $state<NameKind>('nickname');
  let saving = $state('');

  const changeDisplayName = () => {
    kind = 'display';
    draft = setup.display_name;
  };

  const saveName = async () => {
    const label = draft.trim();
    if (!label || saving || disabled) {
      return;
    }
    saving = kind === 'display' ? 'display' : 'alias:add';
    error = '';
    try {
      if (kind === 'display') {
        const result = await setCimmichPersonDisplayName(personId, label);
        draft = '';
        kind = 'nickname';
        await onchanged(result.displayName);
      } else {
        await addCimmichPersonAlias(personId, label, kind);
        draft = '';
        await onchanged();
      }
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Unable to save name';
    } finally {
      saving = '';
    }
  };

  const removeAlias = async (aliasId: string) => {
    if (saving || disabled) {
      return;
    }
    saving = `alias:${aliasId}`;
    error = '';
    try {
      await removeCimmichPersonAlias(personId, aliasId);
      await onchanged();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Unable to remove name';
    } finally {
      saving = '';
    }
  };
</script>

<article class="rounded-lg border border-gray-200 p-4 dark:border-immich-dark-gray">
  <h2 class="text-lg font-semibold">Names</h2>
  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
    Choose the recorded display name and keep every other name this identity is known by.
  </p>

  {#if error}
    <p
      class="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {error}
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap gap-2">
    <span
      class="inline-flex items-center gap-1 rounded-full bg-gray-900 py-1 pr-1 pl-3 text-sm font-medium text-white dark:bg-gray-100 dark:text-black"
    >
      <span>{setup.display_name} · display</span>
      <button
        class="rounded-full px-2 py-0.5 text-white/75 hover:bg-white/20 disabled:opacity-50 dark:text-black/70 dark:hover:bg-black/10"
        type="button"
        aria-label="Change display name"
        disabled={disabled || Boolean(saving)}
        onclick={changeDisplayName}>Change</button
      >
    </span>
    {#each setup.alias_items as alias (alias.alias_id)}
      <span
        class="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pr-1 pl-3 text-sm dark:bg-immich-dark-gray"
      >
        <span>{alias.label} · {alias.alias_kind.replace('_', ' ')}</span>
        <button
          class="rounded-full px-2 py-0.5 text-gray-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-200"
          type="button"
          aria-label={`Remove ${alias.label}`}
          disabled={disabled || Boolean(saving)}
          onclick={() => void removeAlias(alias.alias_id)}>×</button
        >
      </span>
    {/each}
  </div>

  <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_190px_auto]">
    <input
      class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
      placeholder={kind === 'display' ? 'Recorded display name' : 'Add another name'}
      aria-label={kind === 'display' ? 'Recorded display name' : 'Another name'}
      bind:value={draft}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          void saveName();
        }
      }}
    />
    <select
      class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
      aria-label="Name type"
      bind:value={kind}
    >
      <option value="display">Display name (recorded)</option>
      <option value="nickname">Nickname</option>
      <option value="former_name">Former name</option>
      <option value="imported">Imported/source name</option>
    </select>
    <button
      class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50 dark:bg-gray-100 dark:text-black"
      type="button"
      disabled={!draft.trim() || disabled || Boolean(saving)}
      onclick={() => void saveName()}
    >
      {saving ? 'Saving…' : kind === 'display' ? 'Change' : 'Add'}
    </button>
  </div>
  {#if kind === 'display'}
    <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
      This becomes the name shown throughout Cimmich. The current display name is kept as a Former name.
    </p>
  {/if}
</article>
