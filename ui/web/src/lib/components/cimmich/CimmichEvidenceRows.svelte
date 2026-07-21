<script lang="ts">
  import type { CimmichStateRow } from '$lib/services/cimmich-evidence.service';

  interface Props {
    rows: CimmichStateRow[];
    title: string;
  }

  let { rows, title }: Props = $props();

  const titleCase = (value: string) => value.replaceAll('_', ' ').replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
</script>

<div class="mt-4">
  <p class="text-sm font-semibold">{title}</p>
  <div class="mt-2 grid gap-3">
    {#each rows as row (row.stateId)}
      <article class="rounded-md bg-white/70 p-3 text-sm dark:bg-black/20">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-medium">{row.personName || titleCase(row.kind)}</p>
            <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">{titleCase(row.kind)}</p>
          </div>
          <span class="rounded-full border border-immich-gray/30 px-2 py-0.5 text-xs">{row.priority}</span>
        </div>
        <p class="mt-2 text-xs text-gray-600 dark:text-gray-300">{row.reason}</p>
        {#if row.machineValue}
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{row.machineValue}</p>
        {/if}
        {#if row.visualUrl}
          <img class="mt-3 max-h-56 w-full rounded-md object-contain" src={row.visualUrl} alt="" />
        {/if}
      </article>
    {/each}
  </div>
</div>
