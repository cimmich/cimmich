<script lang="ts">
  import { page } from '$app/state';
  import { isCimmichPath } from '$lib/components/cimmich/navigation-mode-switch';
  import CimmichSidebar from './CimmichSidebar.svelte';
  import ImmichSidebar from './ImmichSidebar.svelte';
</script>

{#if isCimmichPath(page.url.pathname)}
  <CimmichSidebar />
{:else}
  <ImmichSidebar />
{/if}
