<script lang="ts">
  import { Icon } from '@immich/ui';
  import {
    mdiHomeOutline,
    mdiMapMarkerMultipleOutline,
    mdiMapOutline,
    mdiTuneVariant,
    mdiViewGridOutline,
  } from '@mdi/js';

  type PlaceView = 'atlas' | 'geography' | 'gps' | 'locations';
  type GroupMode = 'country' | 'duplicates' | 'none';
  type SortMode = 'name' | 'photos-asc' | 'photos-desc';

  interface Props {
    duplicateNameCount?: number;
    groupMode: GroupMode;
    onGroupModeChange: (mode: GroupMode) => void;
    onSortModeChange: (mode: SortMode) => void;
    onViewChange: (view: PlaceView) => void;
    sortMode: SortMode;
    view: PlaceView;
  }

  let {
    duplicateNameCount = 0,
    groupMode,
    onGroupModeChange,
    onSortModeChange,
    onViewChange,
    sortMode,
    view,
  }: Props = $props();
  let showDirectoryOptions = $state(false);

  const views = [
    { icon: mdiMapOutline, label: 'Map', value: 'atlas' },
    { icon: mdiHomeOutline, label: 'Locations', value: 'locations' },
    { icon: mdiViewGridOutline, label: 'Geography', value: 'geography' },
    { icon: mdiMapMarkerMultipleOutline, label: 'GPS', value: 'gps' },
  ] as const;
</script>

<div class="context-place-top-controls">
  <div class="context-place-view-switch" aria-label="Places view">
    {#each views as option (option.value)}
      <button
        class:context-place-view-active={view === option.value}
        type="button"
        aria-pressed={view === option.value}
        title={option.label}
        onclick={() => onViewChange(option.value)}
      >
        <Icon icon={option.icon} size="16" />
        <span>{option.label}</span>
      </button>
    {/each}
  </div>

  {#if view === 'locations' || view === 'geography'}
    <div class="relative">
      <button
        class="context-place-options-button"
        class:context-place-options-button-active={groupMode !== 'country' || sortMode !== 'name'}
        type="button"
        aria-label="Group and sort"
        aria-expanded={showDirectoryOptions}
        aria-haspopup="menu"
        title="Group and sort"
        onclick={() => (showDirectoryOptions = !showDirectoryOptions)}
      >
        <Icon icon={mdiTuneVariant} size="19" />
      </button>
      {#if showDirectoryOptions}
        <div class="context-place-options-menu" role="menu" aria-label="Group and sort places">
          <label>
            <span>Group</span>
            <select
              aria-label="Group places"
              value={groupMode}
              onchange={(event) => onGroupModeChange(event.currentTarget.value as GroupMode)}
            >
              <option value="country">{view === 'geography' ? 'Country' : 'Geography'}</option>
              <option value="none">No grouping</option>
              <option value="duplicates"
                >Repeated names{duplicateNameCount > 0 ? ` (${duplicateNameCount})` : ''}</option
              >
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select
              aria-label="Sort places"
              value={sortMode}
              onchange={(event) => onSortModeChange(event.currentTarget.value as SortMode)}
            >
              <option value="name">Name A–Z</option>
              <option value="photos-desc">Most photos</option>
              <option value="photos-asc">Fewest photos</option>
            </select>
          </label>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .context-place-top-controls,
  .context-place-view-switch {
    display: flex;
    min-width: 0;
    align-items: center;
  }

  .context-place-top-controls {
    gap: 0.4rem;
  }

  .context-place-view-switch {
    flex: 0 1 auto;
    border-radius: 0.85rem;
    background: rgb(243 244 246);
    padding: 0.2rem;
  }

  :global(.dark) .context-place-view-switch {
    background: rgb(31 41 55);
  }

  .context-place-view-switch button {
    display: inline-flex;
    min-height: 2.35rem;
    align-items: center;
    justify-content: center;
    gap: 0.32rem;
    border-radius: 0.68rem;
    padding: 0 0.65rem;
    color: rgb(75 85 99);
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
  }

  :global(.dark) .context-place-view-switch button {
    color: rgb(209 213 219);
  }

  .context-place-view-switch button:hover,
  .context-place-view-active {
    color: rgb(var(--immich-primary));
  }

  .context-place-view-active {
    background: white;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
  }

  :global(.dark) .context-place-view-active {
    background: rgb(55 65 81);
  }

  .context-place-options-button {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    place-items: center;
    border: 1px solid rgb(229 231 235);
    border-radius: 0.75rem;
    background: white;
    color: rgb(75 85 99);
  }

  :global(.dark) .context-place-options-button {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
    color: rgb(209 213 219);
  }

  .context-place-options-button:hover,
  .context-place-options-button-active {
    color: rgb(var(--immich-primary));
  }

  .context-place-options-menu {
    position: absolute;
    top: 3rem;
    right: 0;
    z-index: 40;
    display: grid;
    width: 15rem;
    gap: 0.85rem;
    border: 1px solid rgb(229 231 235);
    border-radius: 1rem;
    background: white;
    padding: 0.9rem;
    box-shadow: 0 16px 38px rgb(0 0 0 / 0.18);
  }

  :global(.dark) .context-place-options-menu {
    border-color: rgb(55 65 81);
    background: rgb(17 24 39);
  }

  .context-place-options-menu label {
    display: grid;
    gap: 0.35rem;
  }

  .context-place-options-menu label > span {
    color: rgb(107 114 128);
    font-size: 0.68rem;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .context-place-options-menu select {
    min-height: 2.5rem;
    border-radius: 0.7rem;
    background: rgb(243 244 246);
    padding: 0 2.2rem 0 0.75rem;
    font-size: 0.82rem;
    font-weight: 650;
    outline: none;
  }

  :global(.dark) .context-place-options-menu select {
    background: rgb(31 41 55);
  }

  @media (max-width: 760px) {
    .context-place-view-switch {
      overflow-x: auto;
    }

    .context-place-view-switch button {
      padding: 0 0.55rem;
    }
  }
</style>
