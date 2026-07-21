<script lang="ts">
  import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiInformationOutline, mdiLoading } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import type { Snippet } from 'svelte';

  type Tone = 'empty' | 'error' | 'loading' | 'success';

  interface Props {
    action?: Snippet;
    description: string;
    title: string;
    tone?: Tone;
  }

  let { action, description, title, tone = 'empty' }: Props = $props();

  const toneClass: Record<Tone, string> = {
    empty:
      'border-gray-200 bg-gray-50 text-gray-700 dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-gray-200',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
    loading: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  };

  const toneIcon: Record<Tone, string> = {
    empty: mdiInformationOutline,
    error: mdiAlertCircleOutline,
    loading: mdiLoading,
    success: mdiCheckCircleOutline,
  };
</script>

<section
  class={`flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center ${toneClass[tone]}`}
  aria-live={tone === 'error' ? 'assertive' : 'polite'}
  role={tone === 'error' ? 'alert' : 'status'}
>
  <span
    class:animate-spin={tone === 'loading'}
    class="flex size-10 items-center justify-center rounded-full bg-current/10"
  >
    <Icon icon={toneIcon[tone]} size="22" />
  </span>
  <div class="max-w-lg">
    <h2 class="font-semibold">{title}</h2>
    <p class="mt-1 text-sm/6 opacity-80">{description}</p>
  </div>
  {#if action}
    <div class="mt-1">{@render action()}</div>
  {/if}
</section>
