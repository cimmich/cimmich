<script lang="ts">
  import type { CimmichPersonConnection, CimmichPersonConnectionGroup } from './person-page-types';
  import CimmichPersonConnectionCard from './CimmichPersonConnectionCard.svelte';
  import { mdiAccountMultiplePlusOutline, mdiChevronRight, mdiPlus } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { SvelteSet } from 'svelte/reactivity';

  interface Props {
    gethref: (connection: CimmichPersonConnection) => string;
    groups: CimmichPersonConnectionGroup[];
    onadd: (kind: CimmichPersonConnection['entityKind']) => void;
    ondescribe: (connection: CimmichPersonConnection) => void;
    onhub: () => void;
    onremove: (connection: CimmichPersonConnection) => void;
    savingId: string;
  }

  let { gethref, groups, onadd, ondescribe, onhub, onremove, savingId }: Props = $props();
  const collapsed = new SvelteSet<string>();
  const singular = (kind: CimmichPersonConnection['entityKind']) =>
    ({ event: 'event', object: 'thing', person: 'person', place: 'place' })[kind];
</script>

<div class="grid gap-7">
  {#each groups as group (group.id)}
    <section class="grid gap-3" aria-labelledby={`person-connections-${group.id}`}>
      <div class="flex min-h-11 items-center border-b border-gray-200 dark:border-gray-800">
        <button
          class="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
          type="button"
          aria-controls={`person-connections-${group.id}-items`}
          aria-expanded={!collapsed.has(group.id)}
          onclick={() => (collapsed.has(group.id) ? collapsed.delete(group.id) : collapsed.add(group.id))}
        >
          <Icon
            class={`shrink-0 text-gray-400 transition-transform ${collapsed.has(group.id) ? '' : 'rotate-90'}`}
            icon={mdiChevronRight}
            size="20"
          />
          <h3 class="text-xs font-normal tracking-wide uppercase" id={`person-connections-${group.id}`}>
            {group.label}
          </h3>
          <span class="text-xs text-gray-400">{group.items.length.toLocaleString()}</span>
        </button>
        {#if group.id === 'person'}
          <button
            class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-normal text-primary hover:bg-primary/10"
            type="button"
            aria-label="Add several people through a shared context"
            title="Add several people to one home, employer or group"
            onclick={onhub}
          >
            <Icon icon={mdiAccountMultiplePlusOutline} size="17" />
            <span class="hidden sm:inline">Add several</span>
          </button>
        {/if}
        <button
          class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-normal text-primary hover:bg-primary/10"
          type="button"
          aria-label={`Add ${singular(group.id)} connection`}
          onclick={() => onadd(group.id)}
        >
          <Icon icon={mdiPlus} size="18" />
          <span class="hidden sm:inline">Add {singular(group.id)}</span>
        </button>
      </div>
      {#if !collapsed.has(group.id)}
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" id={`person-connections-${group.id}-items`}>
          {#each group.items as connection (connection.entityId)}
            <CimmichPersonConnectionCard
              {connection}
              href={gethref(connection)}
              ondescribe={() => ondescribe(connection)}
              onremove={() => onremove(connection)}
              saving={savingId === connection.entityId}
            />
          {:else}
            <p class="text-sm text-gray-500 sm:col-span-2 lg:col-span-3 dark:text-gray-400">
              No {group.label.toLocaleLowerCase()} connected yet.
            </p>
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>
