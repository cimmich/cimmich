<script lang="ts">
  import type { CimmichPersonMode } from './person-workspace-navigation';
  import CimmichIdentityWaitingBadges from './CimmichIdentityWaitingBadges.svelte';
  import CimmichPersonTabButton from './CimmichPersonTabButton.svelte';
  import { keyboardTabs } from './keyboard-tabs';

  interface Props {
    assetCount: number;
    connectionCount: number;
    mode: CimmichPersonMode;
    newMatches: number;
    onconnections: () => void;
    ondetails: () => void;
    ondocuments: () => void;
    onevidence: () => void;
    onidentity: () => void;
    onphotos: () => void;
    possibleMistags: number;
    subjectKind: 'person' | 'pet';
    waitingHint: number;
  }

  let {
    assetCount,
    connectionCount,
    mode,
    newMatches,
    onconnections,
    ondetails,
    ondocuments,
    onevidence,
    onidentity,
    onphotos,
    possibleMistags,
    subjectKind,
    waitingHint,
  }: Props = $props();
</script>

<div class="flex shrink-0" role="tablist" aria-label="Person content" use:keyboardTabs>
  <CimmichPersonTabButton
    active={mode === 'photos'}
    count={assetCount}
    label="Photos"
    onclick={onphotos}
    tabId="photos"
  />
  {#if subjectKind === 'person'}
    <CimmichPersonTabButton active={mode === 'evidence'} label="Evidence" onclick={onevidence} tabId="evidence" />
    <CimmichPersonTabButton active={mode === 'details'} label="Details" onclick={ondetails} tabId="details" />
    <CimmichPersonTabButton
      active={mode === 'connections'}
      count={connectionCount}
      label="Connections"
      onclick={onconnections}
      tabId="connections"
    />
  {/if}
  <button
    class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${mode === 'identity' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
    data-person-tab="identity"
    type="button"
    role="tab"
    aria-selected={mode === 'identity'}
    tabindex={mode === 'identity' ? 0 : -1}
    onclick={onidentity}
  >
    Identity
    <CimmichIdentityWaitingBadges {newMatches} {possibleMistags} {waitingHint} />
  </button>
  <CimmichPersonTabButton active={mode === 'documents'} label="Documents" onclick={ondocuments} tabId="documents" />
</div>
