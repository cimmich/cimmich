<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiArrowLeft, mdiDatabaseImportOutline } from '@mdi/js';
  import CimmichImmichSetup from '../maintenance/CimmichImmichSetup.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title} scrollbar={false}>
  <div class="mx-auto w-full max-w-5xl space-y-6 px-4 pt-4 pb-16 sm:px-6 lg:px-8">
    <header class="overflow-hidden rounded-4xl bg-slate-950 px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
      <a
        class="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-slate-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        href={Route.cimmichHome()}
      >
        <Icon icon={mdiArrowLeft} size="18" /> Back to Cimmich
      </a>
      <div class="mt-4 flex items-start gap-4">
        <span class="grid size-12 shrink-0 place-items-center rounded-2xl bg-indigo-500 text-white" aria-hidden="true">
          <Icon icon={mdiDatabaseImportOutline} size="25" />
        </span>
        <div>
          <p class="text-xs font-semibold tracking-[0.16em] text-indigo-300 uppercase">Library setup</p>
          <h1 class="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Connect, preview, then import</h1>
          <p class="mt-3 max-w-2xl text-sm/6 text-slate-300 sm:text-base/7">
            One guided path for connecting Immich and choosing exactly what Cimmich should bring in. You see a preview
            before the first import or any later update.
          </p>
        </div>
      </div>
    </header>

    <CimmichImmichSetup />

    <aside class="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm dark:border-gray-700 dark:bg-gray-900">
      Looking for local models or Guided access?
      <a class="ml-1 font-semibold text-primary underline underline-offset-4" href={Route.cimmichMaintenance()}
        >Open Models & Guided</a
      >.
    </aside>
  </div>
</UserPageLayout>
