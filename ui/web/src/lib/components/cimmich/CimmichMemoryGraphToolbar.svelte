<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiLightbulbOnOutline } from '@mdi/js';
  import type { CimmichMemoryGraphLens } from './memory-graph-analysis';

  interface Props {
    activeLens: CimmichMemoryGraphLens;
    analysisOpen: boolean;
    lensMeta: Record<CimmichMemoryGraphLens, { description: string; icon: string; label: string }>;
    onanalysis: () => void;
    onlens: (lens: CimmichMemoryGraphLens) => void;
    visibleEdges: number;
    visibleNodes: number;
  }

  let { activeLens, analysisOpen, lensMeta, onanalysis, onlens, visibleEdges, visibleNodes }: Props = $props();
  const lenses = Object.keys(lensMeta) as CimmichMemoryGraphLens[];
</script>

<section
  class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm dark:border-gray-700 dark:bg-[#11141b]"
  aria-label="Discover graph tools"
>
  <div class="flex min-w-0 flex-wrap gap-1" aria-label="Discovery lenses">
    {#each lenses as lens (lens)}
      <button
        class={[
          'inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs transition',
          activeLens === lens ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100 dark:hover:bg-white/10',
        ]}
        type="button"
        aria-pressed={activeLens === lens}
        onclick={() => onlens(lens)}
      >
        <Icon icon={lensMeta[lens].icon} size="16" />{lensMeta[lens].label}
      </button>
    {/each}
  </div>
  <div class="flex items-center gap-1">
    <span class="hidden px-2 text-[11px] text-gray-500 md:inline dark:text-gray-400">
      {visibleNodes} memories · {visibleEdges} connections
    </span>
    <button
      class={[
        'inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs transition',
        analysisOpen ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100 dark:hover:bg-white/10',
      ]}
      type="button"
      aria-expanded={analysisOpen}
      onclick={onanalysis}
    >
      <Icon icon={mdiLightbulbOnOutline} size="16" />Insights
    </button>
  </div>
</section>
