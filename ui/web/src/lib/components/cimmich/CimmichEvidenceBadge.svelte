<script lang="ts">
  import { mdiAccountOutline, mdiAutoFix, mdiDatabaseImportOutline, mdiShieldCheckOutline } from '@mdi/js';
  import { Icon, Tooltip } from '@immich/ui';

  type Origin = 'import' | 'model' | 'system' | 'user';

  interface Props {
    compact?: boolean;
    description?: string;
    label?: string;
    origin: Origin;
  }

  let { compact = false, description, label, origin }: Props = $props();

  const presentation: Record<Origin, { defaultLabel: string; icon: string; style: string }> = {
    import: {
      defaultLabel: 'Imported evidence',
      icon: mdiDatabaseImportOutline,
      style: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-800',
    },
    model: {
      defaultLabel: 'Model suggestion',
      icon: mdiAutoFix,
      style:
        'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-100 dark:ring-violet-800',
    },
    system: {
      defaultLabel: 'System record',
      icon: mdiShieldCheckOutline,
      style: 'bg-gray-100 text-gray-700 ring-gray-200 dark:bg-immich-dark-gray dark:text-gray-200 dark:ring-gray-700',
    },
    user: {
      defaultLabel: 'Added by you',
      icon: mdiAccountOutline,
      style:
        'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800',
    },
  };

  const accessibleDescription = $derived(
    description ||
      `${label || presentation[origin].defaultLabel}. Open this information beside the media it describes.`,
  );
</script>

{#if compact}
  <Tooltip text={accessibleDescription}>
    {#snippet child({ props })}
      <button
        {...props}
        class={`flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${presentation[origin].style}`}
        type="button"
        aria-label={accessibleDescription}
      >
        <Icon icon={presentation[origin].icon} size="17" />
      </button>
    {/snippet}
  </Tooltip>
{:else}
  <span
    class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${presentation[origin].style}`}
  >
    <Icon icon={presentation[origin].icon} size="14" />
    {label || presentation[origin].defaultLabel}
  </span>
{/if}
