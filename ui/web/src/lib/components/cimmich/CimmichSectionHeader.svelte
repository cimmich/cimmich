<script lang="ts">
  import { Icon } from '@immich/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    actions?: Snippet;
    description?: string;
    eyebrow?: string;
    icon: string;
    meta?: string;
    onTitleClick?: () => void;
    title: string;
  }

  let { actions, description, eyebrow, icon, meta, onTitleClick, title }: Props = $props();
</script>

<header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
  <div class="flex min-w-0 items-start gap-3">
    <span
      class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary"
    >
      <Icon {icon} size="22" />
    </span>
    <div class="min-w-0">
      {#if eyebrow}
        <p class="mb-1 text-xs font-semibold tracking-[0.14em] text-primary uppercase dark:text-immich-dark-primary">
          {eyebrow}
        </p>
      {/if}
      <h1 class="text-2xl font-semibold tracking-tight">
        {#if onTitleClick}
          <button
            class="rounded-sm text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            type="button"
            onclick={onTitleClick}
            aria-label={`Back to ${title}`}
          >
            {title}
          </button>
        {:else}
          {title}
        {/if}
      </h1>
      {#if description}
        <p class="mt-1 max-w-2xl text-sm/6 text-gray-600 dark:text-gray-300">{description}</p>
      {/if}
      {#if meta}
        <p class="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">{meta}</p>
      {/if}
    </div>
  </div>

  {#if actions}
    <div class="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
      {@render actions()}
    </div>
  {/if}
</header>
