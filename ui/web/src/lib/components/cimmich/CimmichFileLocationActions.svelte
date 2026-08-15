<script lang="ts">
  import { page } from '$app/state';
  import { Route } from '$lib/route';
  import { getParentPath } from '$lib/utils/tree-utils';
  import { Icon } from '@immich/ui';
  import { mdiCheck, mdiContentCopy, mdiFolderOpenOutline } from '@mdi/js';

  interface Props {
    asset: { id: string; originalFileName: string; originalPath: string };
    variant?: 'detail' | 'overlay';
  }

  let { asset, variant = 'overlay' }: Props = $props();
  let copied = $state(false);
  const parentPath = $derived(getParentPath(asset.originalPath));
  const inFolderViewer = $derived(page.url.pathname.startsWith('/folders/photos/'));
  const folderHref = $derived(
    inFolderViewer
      ? Route.folders({ organise: 1, path: parentPath })
      : Route.viewFolderAsset({ cimmich: 1, id: asset.id, path: parentPath }),
  );
  const folderLabel = $derived(inFolderViewer ? 'Open folder' : 'Show in folder');

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

{#if asset.originalPath}
  <div
    class={variant === 'overlay'
      ? 'flex items-center gap-0.5 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]'
      : 'mt-2 flex flex-wrap items-center gap-2'}
    aria-label="File location actions"
  >
    <a
      class={variant === 'overlay'
        ? 'grid size-10 place-items-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white'
        : 'inline-flex min-h-9 items-center gap-2 rounded-full border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800'}
      href={folderHref}
      aria-label={`${folderLabel}: ${asset.originalFileName}`}
      title={folderLabel}
    >
      <Icon icon={mdiFolderOpenOutline} size={variant === 'overlay' ? '21' : '17'} />
      {#if variant === 'detail'}<span>{folderLabel}</span>{/if}
    </a>
    <button
      class={variant === 'overlay'
        ? 'grid size-10 place-items-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white'
        : 'inline-flex min-h-9 items-center gap-2 rounded-full border border-gray-300 px-3 text-xs font-semibold hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800'}
      type="button"
      aria-label={`Copy full path for ${asset.originalFileName}`}
      title={copied ? 'Path copied' : 'Copy full path'}
      onclick={() => void copyPath()}
    >
      <Icon icon={copied ? mdiCheck : mdiContentCopy} size={variant === 'overlay' ? '20' : '16'} />
      {#if variant === 'detail'}<span>{copied ? 'Path copied' : 'Copy full path'}</span>{/if}
    </button>
  </div>
{/if}
