<script lang="ts">
  import {
    createCimmichPersonProfileCommandId,
    createCimmichRelationshipCategory,
    type CimmichPersonProfileProjection,
  } from '$lib/services/cimmich.service';
  import { mdiPlus } from '@mdi/js';
  import { Icon } from '@immich/ui';

  interface Props {
    onprofilechange: (value: CimmichPersonProfileProjection) => void;
    onselectedchange: (value: string[]) => void;
    ontoggle: (categoryId: string) => void;
    profile: CimmichPersonProfileProjection;
    selectedIds: string[];
  }

  let { onprofilechange, onselectedchange, ontoggle, profile, selectedIds }: Props = $props();
  let busy = $state(false);
  let errorMessage = $state('');
  let relationshipName = $state('');

  const createRelationship = async () => {
    const name = relationshipName.trim();
    if (!name) {
      errorMessage = 'Name the relationship.';
      return;
    }
    busy = true;
    errorMessage = '';
    try {
      const result = await createCimmichRelationshipCategory(
        profile.person.personId,
        createCimmichPersonProfileCommandId('relationship-create'),
        name,
      );
      onprofilechange(result.profile);
      onselectedchange(result.profile.relationships.map(({ categoryId }) => categoryId));
      relationshipName = '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to create this relationship';
    } finally {
      busy = false;
    }
  };
</script>

<fieldset class="grid gap-3">
  <legend class="text-sm font-semibold">Relationship</legend>
  <div class="flex flex-wrap gap-2">
    {#each profile.relationshipCatalog as category (category.categoryId)}
      <button
        class={`min-h-11 rounded-full border px-4 text-sm font-medium ${selectedIds.includes(category.categoryId) ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 hover:border-gray-500 dark:border-immich-dark-gray'}`}
        type="button"
        aria-pressed={selectedIds.includes(category.categoryId)}
        onclick={() => ontoggle(category.categoryId)}>{category.name}</button
      >
    {/each}
  </div>
  <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
    <label class="grid gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
      New relationship
      <input
        class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
        maxlength="80"
        bind:value={relationshipName}
        oninput={() => (errorMessage = '')}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void createRelationship();
          }
        }}
        placeholder="e.g. Cousin, Godparent, Mentor"
      />
    </label>
    <button
      class="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-semibold hover:border-primary hover:text-primary disabled:opacity-50 dark:border-immich-dark-gray"
      type="button"
      disabled={busy}
      onclick={() => void createRelationship()}
    >
      <Icon icon={mdiPlus} size="17" />
      {busy ? 'Creating…' : 'Create & add'}
    </button>
  </div>
  <p class="text-xs text-gray-500 dark:text-gray-400">
    Create your own relationship label for the People library and add it to this person.
  </p>
  {#if errorMessage}
    <p class="text-xs font-medium text-red-600 dark:text-red-300" role="alert">{errorMessage}</p>
  {/if}
</fieldset>
