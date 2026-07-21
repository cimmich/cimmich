<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiArrowLeft, mdiFlaskEmptyOffOutline } from '@mdi/js';

  interface Props {
    capability: string;
  }

  let { capability }: Props = $props();
</script>

<UserPageLayout title={`${capability} unavailable`}>
  <main
    class="mx-auto flex min-h-[65vh] w-full max-w-3xl items-center px-5 py-12 text-immich-fg dark:text-immich-dark-fg"
  >
    <section
      class="w-full rounded-4xl border border-gray-200 bg-white p-7 text-center sm:p-12 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <span
        class="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"
      >
        <Icon icon={mdiFlaskEmptyOffOutline} size="28" />
      </span>
      <h1 class="mt-5 text-2xl font-semibold">{capability} is not enabled</h1>
      <p class="mx-auto mt-3 max-w-lg text-sm/6 text-gray-600 dark:text-gray-300">
        This installation does not expose a validated capability for this workspace. Nothing has been inferred or
        changed. Available Cimmich features remain on the five main sections.
      </p>
      <a
        class="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        href={Route.cimmichHome()}
      >
        <Icon icon={mdiArrowLeft} size="18" /> Back to Cimmich
      </a>
    </section>
  </main>
</UserPageLayout>
