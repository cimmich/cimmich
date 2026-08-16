<script lang="ts">
  import { focusTrap } from '$lib/actions/focus-trap';
  import Portal from '$lib/elements/Portal.svelte';
  import { Route } from '$lib/route';
  import { getParentPath } from '$lib/utils/tree-utils';
  import { Icon, Tooltip, TooltipProvider } from '@immich/ui';
  import { mdiCheck, mdiContentCopy, mdiFolderOpenOutline } from '@mdi/js';
  import { tick } from 'svelte';

  interface Props {
    asset: { originalFileName: string; originalPath: string };
    variant?: 'detail' | 'overlay';
  }

  let { asset, variant = 'overlay' }: Props = $props();
  let copied = $state(false);
  let folderDialogOpen = $state(false);
  let folderTrigger = $state<HTMLButtonElement>();
  const parentPath = $derived(getParentPath(asset.originalPath));
  const folderHref = $derived(Route.folders({ organise: 1, path: parentPath }));
  const folderLabel = 'Open folder';

  const closeFolderDialog = () => {
    const trigger = folderTrigger;
    folderDialogOpen = false;
    void tick().then(() => trigger?.focus());
  };

  const legacyCopyPath = () => {
    const input = document.createElement('textarea');
    input.value = asset.originalPath;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  };

  const copyPath = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(asset.originalPath);
    } catch {
      legacyCopyPath();
    }
    copied = true;
    globalThis.setTimeout(() => (copied = false), 1600);
  };
</script>

{#snippet folderAction(props: Record<string, unknown>)}
  <button
    {...props}
    bind:this={folderTrigger}
    class={variant === 'overlay'
      ? 'grid size-10 place-items-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white'
      : 'inline-flex min-h-9 items-center gap-2 rounded-full border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800'}
    type="button"
    aria-label={`${folderLabel} options for ${asset.originalFileName}`}
    title={variant === 'detail' ? folderLabel : undefined}
    onclick={() => (folderDialogOpen = true)}
  >
    <Icon icon={mdiFolderOpenOutline} size={variant === 'overlay' ? '21' : '17'} />
    {#if variant === 'detail'}<span>{folderLabel}</span>{/if}
  </button>
{/snippet}

{#snippet copyAction(props: Record<string, unknown>)}
  <button
    {...props}
    class={variant === 'overlay'
      ? 'grid size-10 place-items-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white'
      : 'inline-flex min-h-9 items-center gap-2 rounded-full border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800'}
    type="button"
    aria-label={`Copy full path for ${asset.originalFileName}`}
    title={variant === 'detail' ? (copied ? 'Path copied' : 'Copy full path') : undefined}
    onclick={() => void copyPath()}
  >
    <Icon icon={copied ? mdiCheck : mdiContentCopy} size={variant === 'overlay' ? '20' : '16'} />
    {#if variant === 'detail'}<span>{copied ? 'Path copied' : 'Copy full path'}</span>{/if}
  </button>
{/snippet}

{#if asset.originalPath}
  <div
    class={variant === 'overlay'
      ? 'flex items-center gap-0.5 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]'
      : 'mt-2 flex flex-wrap items-center gap-2'}
    aria-label="File location actions"
  >
    {#if variant === 'overlay'}
      <TooltipProvider delayDuration={120}>
        <Tooltip text={folderLabel}>
          {#snippet child({ props })}{@render folderAction(props)}{/snippet}
        </Tooltip>
        <Tooltip text={copied ? 'Path copied' : 'Copy full path'}>
          {#snippet child({ props })}{@render copyAction(props)}{/snippet}
        </Tooltip>
      </TooltipProvider>
    {:else}
      {@render folderAction({})}
      {@render copyAction({})}
    {/if}
  </div>
{/if}

{#if folderDialogOpen}
  <Portal target="body">
    <div class="fixed inset-0 z-1200 grid place-items-center p-4">
      <button
        type="button"
        class="absolute inset-0 cursor-default bg-black/70"
        aria-label="Close folder dialog"
        onclick={closeFolderDialog}
      ></button>
      <div
        class="relative w-full max-w-lg rounded-3xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="cimmich-folder-dialog-title"
        aria-describedby="cimmich-folder-dialog-description"
        use:focusTrap
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closeFolderDialog();
          }
        }}
      >
        <div
          class="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary"
        >
          <Icon icon={mdiFolderOpenOutline} size="23" />
        </div>
        <p class="mt-4 text-xs font-bold tracking-[0.12em] text-gray-500 uppercase dark:text-gray-400">
          Remote library
        </p>
        <h2 id="cimmich-folder-dialog-title" class="mt-1 text-xl font-semibold">Open this location in Cimmich?</h2>
        <p id="cimmich-folder-dialog-description" class="mt-2 text-sm/6 text-gray-600 dark:text-gray-300">
          A web browser cannot open the file manager on another machine. The original is stored on your library server,
          but Cimmich can show the same location in Folder view.
        </p>
        <code
          class="mt-4 block max-h-24 overflow-auto rounded-xl bg-gray-100 px-3 py-2 text-xs break-all text-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {parentPath}
        </code>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="min-h-11 rounded-full px-4 text-sm font-semibold hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-gray-800"
            onclick={closeFolderDialog}>Close</button
          >
          <a
            class="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-immich-dark-primary dark:text-immich-dark-bg"
            href={folderHref}
            onclick={() => (folderDialogOpen = false)}
          >
            Open folder view
          </a>
        </div>
      </div>
    </div>
  </Portal>
{/if}
