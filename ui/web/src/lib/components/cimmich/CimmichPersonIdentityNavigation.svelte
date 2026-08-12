<script lang="ts">
  import type { CimmichIdentitySection } from './person-identity-workspace';
  import type { CimmichIdentityFilter } from './person-workspace-navigation';

  type IdentityWorkspaceGroup = {
    filters: Array<{ count: string; id: string; label: string }>;
    id: string;
    label: string;
  };

  interface Props {
    awaitingCounts: { newMatches: number; possibleMistags: number };
    filter: CimmichIdentityFilter;
    groups: IdentityWorkspaceGroup[];
    onfilter: (filter: CimmichIdentityFilter) => void;
    onsection: (section: CimmichIdentitySection) => void;
    section: CimmichIdentitySection;
    selectedGroup?: IdentityWorkspaceGroup;
  }

  let { awaitingCounts, filter, groups, onfilter, onsection, section, selectedGroup }: Props = $props();
</script>

<nav
  class="flex min-w-0 gap-1 overflow-x-auto border-b border-gray-200 dark:border-immich-dark-gray"
  aria-label="Identity sections"
>
  {#each groups as group (group.id)}
    <button
      class={[
        'relative min-h-11 shrink-0 px-3 text-sm font-semibold transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
        section === group.id
          ? 'text-primary after:bg-primary'
          : 'text-gray-500 after:bg-transparent hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
      ]}
      type="button"
      aria-pressed={section === group.id}
      onclick={() => onsection(group.id as CimmichIdentitySection)}
    >
      {group.label}
      {#if group.id === 'checks' && (awaitingCounts.newMatches || awaitingCounts.possibleMistags)}
        <span class="ml-1 text-xs font-medium opacity-70">
          {(awaitingCounts.newMatches + awaitingCounts.possibleMistags).toLocaleString()}
        </span>
      {/if}
    </button>
  {/each}
</nav>

{#if selectedGroup && selectedGroup.filters.length > 1}
  <nav class="flex min-w-0 flex-wrap gap-2" aria-label={`${selectedGroup.label} views`}>
    {#each selectedGroup.filters as option (option.id)}
      <button
        class={[
          'inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors',
          filter === option.id
            ? 'border-gray-950 bg-gray-950 text-white dark:border-white dark:bg-white dark:text-black'
            : 'border-gray-200 bg-white hover:border-gray-400 dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:hover:border-gray-500',
        ]}
        type="button"
        aria-pressed={filter === option.id}
        onclick={() => onfilter(option.id as CimmichIdentityFilter)}
      >
        {option.label}
        {#if option.count}<span class="text-xs opacity-60">{option.count}</span>{/if}
      </button>
    {/each}
  </nav>
{/if}
