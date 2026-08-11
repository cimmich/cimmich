<script lang="ts">
  import CimmichViewingMode from '$lib/components/cimmich/CimmichViewingMode.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiDatabaseImportOutline, mdiEyeOutline, mdiFaceRecognition } from '@mdi/js';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const settings = [
    {
      description: 'Connect Immich, preview what Cimmich can see, and control future imports.',
      href: Route.cimmichSetup(),
      icon: mdiDatabaseImportOutline,
      label: 'Library connection',
    },
    {
      description: 'Manage local Face and Body providers, Enhanced components and Guided access.',
      href: Route.cimmichMaintenance(),
      icon: mdiFaceRecognition,
      label: 'Models & Guided',
    },
  ];
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-10">
    <header class="max-w-3xl">
      <p class="text-xs font-semibold tracking-[0.16em] text-primary uppercase">Cimmich</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
      <p class="mt-3 text-sm/6 text-gray-600 sm:text-base/7 dark:text-gray-300">
        Control Cimmich's library boundary and local intelligence without changing Immich's own settings.
      </p>
    </header>

    <section
      class="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      aria-labelledby="viewing-mode-settings-title"
    >
      <div class="flex min-w-0 items-start gap-3">
        <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon icon={mdiEyeOutline} size="22" />
        </span>
        <div>
          <h2 id="viewing-mode-settings-title" class="font-semibold">Viewing mode</h2>
          <p class="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
            Choose the visibility ceiling Cimmich uses across Library, search and review.
          </p>
        </div>
      </div>
      <CimmichViewingMode variant="dashboard" restorePreference={false} />
    </section>

    <section class="grid gap-4 sm:grid-cols-2" aria-label="Cimmich settings">
      {#each settings as setting (setting.label)}
        <a
          class="group flex min-h-44 flex-col justify-between rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg"
          href={setting.href}
        >
          <span class="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Icon icon={setting.icon} size="24" />
          </span>
          <span class="mt-6 flex items-end justify-between gap-4">
            <span>
              <strong class="block text-lg">{setting.label}</strong>
              <span class="mt-1 block text-sm/6 text-gray-600 dark:text-gray-300">{setting.description}</span>
            </span>
            <Icon
              class="shrink-0 text-gray-400 transition group-hover:translate-x-1 group-hover:text-primary"
              icon={mdiArrowRight}
              size="22"
            />
          </span>
        </a>
      {/each}
    </section>
  </div>
</UserPageLayout>
