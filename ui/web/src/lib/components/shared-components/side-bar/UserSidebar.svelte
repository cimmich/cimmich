<script lang="ts">
  import { page } from '$app/state';
  import { isCimmichMode } from '$lib/components/cimmich/navigation-mode-switch';
  import CimmichSidebar from './CimmichSidebar.svelte';
  import ImmichSidebar from './ImmichSidebar.svelte';
</script>

{#if isCimmichMode(page.url.pathname, page.url.searchParams.has('organise'))}
  <CimmichSidebar />
{:else}
  <ImmichSidebar />
{/if}
