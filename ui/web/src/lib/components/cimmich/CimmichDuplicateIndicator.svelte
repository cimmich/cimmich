<script lang="ts">
  import { goto } from '$app/navigation';
  import { Icon, Tooltip, TooltipProvider } from '@immich/ui';
  import { mdiContentDuplicate, mdiImageMultipleOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { getCimmichDuplicateIndicator, type CimmichDuplicateIndicator } from './duplicate-indicators';

  interface Props {
    sourceAssetId: string;
    variant?: 'grid' | 'navbar';
  }

  let { sourceAssetId, variant = 'grid' }: Props = $props();
  let indicator = $state<CimmichDuplicateIndicator | null>(null);
  let loadedFor = '';
  let sentinel = $state<HTMLSpanElement>();
  let shouldLoad = $state(variant === 'navbar');

  onMount(() => {
    if (variant === 'navbar' || !sentinel || !('IntersectionObserver' in globalThis)) {
      shouldLoad = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          shouldLoad = true;
          observer.disconnect();
        }
      },
      { rootMargin: '500px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!shouldLoad) {
      return;
    }
    const requestedId = sourceAssetId;
    indicator = null;
    loadedFor = requestedId;
    void getCimmichDuplicateIndicator(requestedId)
      .then((result) => {
        if (loadedFor === requestedId) {
          indicator = result;
        }
      })
      .catch(() => {
        if (loadedFor === requestedId) {
          indicator = null;
        }
      });
  });

  const openEvidence = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (indicator) {
      void goto(indicator.href);
    }
  };
</script>

{#snippet indicatorLink(current: CimmichDuplicateIndicator, props: Record<string, unknown>)}
  <a
    {...props}
    href={current.href}
    class={variant === 'grid'
      ? `absolute top-2 left-2 z-10 inline-flex min-h-7 max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold text-white shadow-md backdrop-blur-sm ${current.kind === 'exact' ? 'bg-violet-700/90' : 'bg-amber-600/92'}`
      : `grid size-10 place-items-center rounded-full text-white shadow-sm transition hover:brightness-110 ${current.kind === 'exact' ? 'bg-violet-700/80' : 'bg-amber-600/82'}`}
    aria-label={`${current.label}. Open the evidence comparison.`}
    title={variant === 'grid' ? `${current.label}. ${current.reason}` : undefined}
    onclick={openEvidence}
  >
    <Icon
      icon={current.kind === 'exact' ? mdiContentDuplicate : mdiImageMultipleOutline}
      size={variant === 'grid' ? '14' : '17'}
    />
    {#if variant === 'grid'}
      <span class="truncate">{current.kind === 'exact' ? 'Exact copy' : 'Possible version'}</span>
    {/if}
  </a>
{/snippet}

{#if variant === 'grid'}
  <span bind:this={sentinel} class="pointer-events-none absolute top-0 left-0 size-px" aria-hidden="true"></span>
{/if}

{#if indicator}
  {@const current = indicator}
  {#if variant === 'navbar'}
    <TooltipProvider delayDuration={120}>
      <Tooltip text={`${current.label}. ${current.reason}`}>
        {#snippet child({ props })}{@render indicatorLink(current, props)}{/snippet}
      </Tooltip>
    </TooltipProvider>
  {:else}
    {@render indicatorLink(current, {})}
  {/if}
{/if}
