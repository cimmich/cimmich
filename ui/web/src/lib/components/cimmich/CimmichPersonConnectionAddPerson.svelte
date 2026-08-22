<script lang="ts">
  import { getCimmichPeople, type CimmichPerson } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { mdiAccountPlusOutline, mdiClose, mdiMagnify } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { onMount } from 'svelte';

  interface Props {
    connectedPersonIds: string[];
    onclose: () => void;
    onselect: (person: CimmichPerson) => void;
    personId: string;
    personName: string;
  }

  let { connectedPersonIds, onclose, onselect, personId, personName }: Props = $props();
  let errorMessage = $state('');
  let loading = $state(true);
  let people = $state<CimmichPerson[]>([]);
  let query = $state('');

  const connectedIds = $derived(new Set(connectedPersonIds));
  const options = $derived.by(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return people
      .filter(
        (person) =>
          person.person_id !== personId &&
          person.subject_kind === 'person' &&
          person.status === 'active' &&
          !connectedIds.has(person.person_id) &&
          (!normalized || [person.display_name, ...person.aliases].join(' ').toLocaleLowerCase().includes(normalized)),
      )
      .slice(0, 16);
  });

  onMount(async () => {
    try {
      people = await getCimmichPeople(500, '', { presentation: false });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to load People';
    } finally {
      loading = false;
    }
  });
</script>

<section
  class="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
  aria-labelledby="person-connection-add-person-heading"
>
  <header class="flex items-start gap-3">
    <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
      <Icon icon={mdiAccountPlusOutline} size="22" />
    </span>
    <div class="min-w-0 flex-1">
      <h2 class="text-lg font-semibold" id="person-connection-add-person-heading">Add a person connection</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Choose anyone in People, then describe how they are connected to {personName}.
      </p>
    </div>
    <button
      class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
      type="button"
      aria-label="Close person picker"
      onclick={onclose}><Icon icon={mdiClose} size="20" /></button
    >
  </header>

  <label class="relative block sm:max-w-xl">
    <span class="sr-only">Search People</span>
    <Icon class="pointer-events-none absolute top-3 left-3 text-gray-400" icon={mdiMagnify} size="20" />
    <input
      class="min-h-11 w-full rounded-xl border border-gray-300 bg-transparent pr-3 pl-10 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-gray-700"
      placeholder="Search People"
      bind:value={query}
    />
  </label>

  {#if loading}
    <p class="text-sm text-gray-500">Loading People…</p>
  {:else if errorMessage}
    <p class="text-sm font-medium text-red-600 dark:text-red-300" role="alert">{errorMessage}</p>
  {:else if options.length === 0}
    <p class="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-700">
      {query.trim() ? 'No unconnected People match this search.' : 'Everyone in People is already connected here.'}
    </p>
  {:else}
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="People available to connect">
      {#each options as person (person.person_id)}
        <button
          class="flex min-h-16 items-center gap-3 rounded-xl border border-gray-200 p-2 text-left transition hover:border-primary/50 hover:bg-primary/5 dark:border-gray-700"
          type="button"
          onclick={() => onselect(person)}
        >
          {#if person.sourceAssetId}
            <img
              class="size-12 shrink-0 rounded-full object-cover"
              src={getAssetMediaUrl({ id: person.sourceAssetId, size: AssetMediaSize.Thumbnail })}
              alt=""
            />
          {:else}
            <span class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon icon={mdiAccountPlusOutline} size="22" />
            </span>
          {/if}
          <span class="min-w-0">
            <span class="block truncate text-sm font-semibold">{person.display_name}</span>
            {#if person.aliases.length > 0}
              <span class="mt-0.5 block truncate text-xs text-gray-500">{person.aliases.join(', ')}</span>
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</section>
