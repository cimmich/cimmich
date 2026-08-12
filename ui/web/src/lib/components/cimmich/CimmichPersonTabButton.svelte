<script lang="ts">
  interface Props {
    active: boolean;
    count?: number;
    label: string;
    onclick: () => void;
    tabId: string;
  }

  let { active, count, label, onclick, tabId }: Props = $props();
</script>

<button
  class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${active ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
  data-person-tab={tabId}
  type="button"
  role="tab"
  aria-selected={active}
  tabindex={active ? 0 : -1}
  {onclick}
>
  {label}
  {#if count !== undefined && count > 0}
    <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-immich-dark-gray">
      {count.toLocaleString()}
    </span>
  {/if}
</button>
