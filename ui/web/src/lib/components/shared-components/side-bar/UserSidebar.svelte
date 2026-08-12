<script lang="ts">
  import { page } from '$app/state';
  import { isCimmichMode } from '$lib/components/cimmich/navigation-mode-switch';
  import { cimmichExperience } from '$lib/stores/cimmich-experience.store';
  import CimmichSidebar from './CimmichSidebar.svelte';
  import ImmichSidebar from './ImmichSidebar.svelte';
</script>

{#if $cimmichExperience === 'frontier' && isCimmichMode(page.url.pathname, page.url.searchParams.has('organise'))}
  <CimmichSidebar />
{:else}
  <ImmichSidebar includeCimmich={$cimmichExperience === 'companion'} />
{/if}
