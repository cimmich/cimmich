<script lang="ts">
  import { goto } from '$app/navigation';
  import { Icon } from '@immich/ui';
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

{#if variant === 'grid'}
  <span bind:this={sentinel} class="pointer-events-none absolute top-0 left-0 size-px" aria-hidden="true"></span>
{/if}

{#if indicator}
  <a
    href={indicator.href}
    class={variant === 'grid'
      ? `absolute top-2 left-2 z-10 inline-flex min-h-7 max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold text-white shadow-md backdrop-blur-sm ${indicator.kind === 'exact' ? 'bg-violet-700/90' : 'bg-amber-600/92'}`
      : `inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/25 px-2.5 text-xs font-semibold text-white shadow-sm backdrop-blur-sm hover:bg-white/15 ${indicator.kind === 'exact' ? 'bg-violet-700/75' : 'bg-amber-600/75'}`}
    aria-label={`${indicator.label}. Open the evidence comparison.`}
    title={`${indicator.label}. ${indicator.reason}`}
    onclick={openEvidence}
  >
    <Icon
      icon={indicator.kind === 'exact' ? mdiContentDuplicate : mdiImageMultipleOutline}
      size={variant === 'grid' ? '14' : '17'}
    />
    <span class={variant === 'navbar' ? 'hidden lg:inline' : 'truncate'}>
      {variant === 'grid' ? (indicator.kind === 'exact' ? 'Exact copy' : 'Possible version') : indicator.label}
    </span>
  </a>
{/if}
