<script lang="ts">
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
</script>

<form class="relative w-full" action={Route.cimmichSmartSearch()} method="get" role="search">
  <label>
    <span class="sr-only">Search your Cimmich library</span>
    <Icon
      class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
      icon={mdiMagnify}
      size="20"
    />
    <input
      class="min-h-11 w-full rounded-2xl border border-transparent bg-gray-100 pr-20 pl-11 text-sm transition outline-none placeholder:text-gray-500 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:bg-gray-800 dark:placeholder:text-gray-400 dark:focus:border-immich-dark-primary dark:focus:bg-gray-950"
      name="q"
      placeholder="Search people, places and stories…"
      minlength="2"
      maxlength="500"
      autocomplete="off"
    />
  </label>
  <button
    class="absolute top-0 right-0 min-h-11 rounded-2xl px-4 text-xs font-semibold text-primary transition hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    type="submit"
  >
    Search
  </button>
</form>
