<script lang="ts">
  import CimmichViewingMode from '$lib/components/cimmich/CimmichViewingMode.svelte';
  import {
    chooseCimmichHomeFeature,
    chooseCimmichHomeDistinctMedia,
    cimmichHomeEntityHref,
    cimmichHomeFaceFocus,
    cimmichHomePreviewNames,
    collectCimmichHomeHeroAssets,
  } from '$lib/components/cimmich/home-presentation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Route } from '$lib/route';
  import {
    getCimmichContextEntities,
    getCimmichDocuments,
    getCimmichImmichOnboardingStatus,
    getCimmichPeople,
    getCimmichPets,
    getCimmichSummary,
    type CimmichContextEntity,
    type CimmichDocument,
    type CimmichImmichOnboardingStatus,
    type CimmichPet,
    type CimmichPerson,
    type CimmichSummary,
  } from '$lib/services/cimmich.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import {
    mdiAccountOutline,
    mdiArrowRight,
    mdiCalendarBlankOutline,
    mdiCogOutline,
    mdiDatabaseImportOutline,
    mdiFileDocumentOutline,
    mdiMagnify,
    mdiMapOutline,
    mdiPackageVariantClosed,
    mdiPawOutline,
  } from '@mdi/js';

  type PortalCard = {
    count: number;
    href: string;
    icon: string;
    id: 'documents' | 'events' | 'objects' | 'people' | 'pets' | 'places';
    mediaId: string | null;
    mediaStyle: string | null;
    name: string;
    preview: string;
  };

  let documents = $state<CimmichDocument[]>([]);
  let events = $state<CimmichContextEntity[]>([]);
  let loadError = $state('');
  let loaded = $state(false);
  let objects = $state<CimmichContextEntity[]>([]);
  let onboardingStatus = $state<CimmichImmichOnboardingStatus>();
  let people = $state<CimmichPerson[]>([]);
  let petProfiles = $state<CimmichPet[]>([]);
  let places = $state<CimmichContextEntity[]>([]);
  let summary = $state<CimmichSummary>();
  let loadGeneration = 0;

  const namedPeople = $derived(people.filter((person) => person.subject_kind === 'person'));
  const firstRunPending = $derived(
    loaded && (summary?.assets ?? 0) === 0 && onboardingStatus?.latestRun?.state !== 'completed',
  );
  const featuredEvent = $derived(chooseCimmichHomeFeature(events));
  const heroAssetIds = $derived(collectCimmichHomeHeroAssets(events, places, objects, people));
  const assetUrl = (sourceAssetId: string, size = AssetMediaSize.Preview) =>
    getAssetMediaUrl({ id: sourceAssetId, size });
  const portalMediaIds = $derived(
    chooseCimmichHomeDistinctMedia(
      [
        namedPeople.map((person) => person.sourceAssetId),
        petProfiles.map((pet) => pet.cover?.sourceAssetId),
        places.map((place) => place.coverAssetId),
        objects.map((object) => object.coverAssetId),
        events.flatMap((event) => [...(event.previewAssetIds ?? []), event.coverAssetId]),
        documents.map((document) => (document.source.kind === 'immich_asset' ? document.source.assetId : null)),
      ],
      heroAssetIds.slice(0, 3),
    ),
  );
  const peopleCardPerson = $derived(
    namedPeople.find((person) => person.sourceAssetId === portalMediaIds[0] && cimmichHomeFaceFocus(person)) ??
      namedPeople.find((person) => cimmichHomeFaceFocus(person)),
  );
  const peopleCardFocus = $derived(cimmichHomeFaceFocus(peopleCardPerson));
  const portalCards = $derived<PortalCard[]>([
    {
      id: 'people',
      name: 'People',
      count: namedPeople.length,
      preview: cimmichHomePreviewNames(namedPeople.map((person) => person.display_name)),
      href: Route.cimmichPeople(),
      icon: mdiAccountOutline,
      mediaId: peopleCardFocus?.sourceAssetId ?? portalMediaIds[0] ?? heroAssetIds[0] ?? null,
      mediaStyle: peopleCardFocus
        ? `background-image: url("${assetUrl(peopleCardFocus.sourceAssetId)}"); background-size: ${peopleCardFocus.backgroundSize}; background-position: ${peopleCardFocus.backgroundPosition};`
        : null,
    },
    {
      id: 'pets',
      name: 'Pets',
      count: petProfiles.length,
      preview: cimmichHomePreviewNames(petProfiles.map((pet) => pet.displayName)),
      href: Route.cimmichPets(),
      icon: mdiPawOutline,
      mediaId: portalMediaIds[1],
      mediaStyle: null,
    },
    {
      id: 'places',
      name: 'Places',
      count: places.length,
      preview: cimmichHomePreviewNames(places.map((place) => place.displayName)),
      href: Route.cimmichPlaces(),
      icon: mdiMapOutline,
      mediaId: portalMediaIds[2],
      mediaStyle: null,
    },
    {
      id: 'objects',
      name: 'Things',
      count: objects.length,
      preview: cimmichHomePreviewNames(objects.map((object) => object.displayName)),
      href: Route.cimmichThings(),
      icon: mdiPackageVariantClosed,
      mediaId: portalMediaIds[3],
      mediaStyle: null,
    },
    {
      id: 'events',
      name: 'Events',
      count: events.length,
      preview: cimmichHomePreviewNames(events.map((event) => event.displayName)),
      href: Route.cimmichEvents(),
      icon: mdiCalendarBlankOutline,
      mediaId: portalMediaIds[4],
      mediaStyle: null,
    },
    {
      id: 'documents',
      name: 'Documents',
      count: documents.length,
      preview: cimmichHomePreviewNames(documents.map((document) => document.displayTitle)),
      href: Route.cimmichDocuments(),
      icon: mdiFileDocumentOutline,
      mediaId: portalMediaIds[5],
      mediaStyle: null,
    },
  ]);

  const featureHref = $derived(
    featuredEvent ? cimmichHomeEntityHref('events', featuredEvent.entityId) : Route.cimmichEvents(),
  );

  const loadHome = () => {
    const generation = ++loadGeneration;
    loaded = false;
    loadError = '';
    void Promise.all([
      getCimmichSummary(),
      getCimmichPeople(500),
      getCimmichPets(),
      getCimmichContextEntities('places'),
      getCimmichContextEntities('objects'),
      getCimmichContextEntities('events'),
      getCimmichDocuments(),
      getCimmichImmichOnboardingStatus().catch(() => undefined),
    ])
      .then(
        ([nextSummary, nextPeople, nextPets, nextPlaces, nextObjects, nextEvents, nextDocuments, nextOnboarding]) => {
          if (generation !== loadGeneration) {
            return;
          }
          summary = nextSummary;
          people = nextPeople;
          petProfiles = nextPets;
          places = nextPlaces;
          objects = nextObjects;
          events = nextEvents;
          documents = nextDocuments.items;
          onboardingStatus = nextOnboarding;
        },
      )
      .catch((error) => {
        if (generation !== loadGeneration) {
          return;
        }
        loadError = error instanceof Error ? error.message : 'Cimmich could not load the current library.';
      })
      .finally(() => {
        if (generation === loadGeneration) {
          loaded = true;
        }
      });
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    loadHome();
  });
</script>

<UserPageLayout>
  <div
    class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 text-immich-fg sm:px-6 lg:py-8 dark:text-immich-dark-fg"
  >
    <h1 class="sr-only">Cimmich home</h1>
    {#if loadError}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        role="alert"
      >
        <span>{loadError}</span>
        <button class="font-semibold underline underline-offset-4" type="button" onclick={loadHome}>Try again</button>
      </div>
    {/if}

    {#if firstRunPending}
      <section
        class="overflow-hidden rounded-4xl border border-indigo-200 bg-[radial-gradient(circle_at_10%_10%,rgba(99,102,241,0.18),transparent_38%),linear-gradient(135deg,#ffffff,#f5f7ff)] p-6 shadow-sm sm:p-8 dark:border-indigo-900 dark:bg-[radial-gradient(circle_at_10%_10%,rgba(99,102,241,0.24),transparent_38%),linear-gradient(135deg,#111827,#11131b)]"
        aria-labelledby="cimmich-first-run-home-heading"
      >
        <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 items-start gap-4">
            <span
              class="grid size-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-sm dark:bg-indigo-400 dark:text-indigo-950"
            >
              <Icon icon={mdiDatabaseImportOutline} size="24" />
            </span>
            <div>
              <p class="text-xs font-semibold tracking-[0.15em] text-indigo-700 uppercase dark:text-indigo-300">
                First run · Connect → Preview → Import
              </p>
              <h2 id="cimmich-first-run-home-heading" class="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                Bring your Immich library into Cimmich
              </h2>
              <p class="mt-2 max-w-3xl text-sm/6 text-gray-600 sm:text-base/7 dark:text-gray-300">
                Connect with a dedicated read-only key, verify the account and permissions, then preview the exact
                photos and People before importing anything. Cimmich never writes to Immich or changes your originals.
              </p>
            </div>
          </div>
          <div class="flex shrink-0 flex-col items-start gap-2 lg:items-end">
            <a
              class="inline-flex min-h-11 items-center gap-2 rounded-full bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-400 dark:text-indigo-950 dark:hover:bg-indigo-300"
              href={`${Route.cimmichMaintenance()}#cimmich-first-run-title`}
            >
              {onboardingStatus?.connection.state === 'ready' ? 'Preview your library' : 'Connect your library'}
              <Icon icon={mdiArrowRight} size="18" />
            </a>
            <p class="text-xs text-gray-500 dark:text-gray-400">Nothing is imported until you approve the preview.</p>
          </div>
        </div>
      </section>
    {/if}

    <div>
      <section
        class="relative min-h-104 overflow-hidden rounded-4xl bg-[#101715] text-white shadow-sm sm:min-h-112"
        aria-labelledby="cimmich-home-feature-heading"
      >
        {#if heroAssetIds.length > 0}
          <div class="absolute inset-0 grid grid-cols-1 sm:grid-cols-[minmax(0,1.55fr)_minmax(9rem,0.55fr)]">
            <img class="size-full object-cover" src={assetUrl(heroAssetIds[0])} alt="" />
            <div class="hidden grid-rows-2 gap-1 p-1 pl-0 sm:grid">
              {#if heroAssetIds[1]}
                <img class="size-full min-h-0 object-cover" src={assetUrl(heroAssetIds[1])} alt="" />
              {/if}
              {#if heroAssetIds[2]}
                <img class="size-full min-h-0 object-cover" src={assetUrl(heroAssetIds[2])} alt="" />
              {/if}
            </div>
          </div>
          <div class="absolute inset-0 bg-linear-to-t from-black via-black/35 to-black/5"></div>
          <div class="absolute inset-0 bg-linear-to-r from-black/55 via-transparent to-transparent"></div>
        {:else}
          <div
            class="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(79,222,154,0.19),transparent_36%),radial-gradient(circle_at_82%_82%,rgba(124,105,239,0.22),transparent_42%)]"
          ></div>
        {/if}

        <div class="relative flex min-h-104 flex-col justify-between p-6 sm:min-h-112 sm:p-9">
          <div class="flex items-start gap-3">
            <p
              class="rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold tracking-[0.14em] text-white/90 uppercase backdrop-blur-md"
            >
              Featured story
            </p>
          </div>

          <div
            class="-m-3 max-w-2xl rounded-3xl bg-black/38 p-3 backdrop-blur-[1px] sm:m-0 sm:rounded-none sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
          >
            <h2
              id="cimmich-home-feature-heading"
              class="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl"
            >
              {featuredEvent?.displayName ?? (loaded ? 'Your library' : 'Bringing your library together…')}
            </h2>
            <p class="mt-2.5 line-clamp-2 max-w-xl text-sm/6 text-white/80 sm:text-base/7">
              {featuredEvent?.description ??
                (loaded
                  ? `${summary?.assets.toLocaleString() ?? 0} visible memories across the people, places and stories that matter.`
                  : 'Loading the people, places and stories visible in this viewing mode.')}
            </p>
            {#if featuredEvent}
              <div class="mt-4 flex flex-wrap items-center gap-3">
                <a
                  class="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  href={featureHref}
                >
                  Open story
                  <Icon icon={mdiArrowRight} size="18" />
                </a>
              </div>
            {/if}
          </div>
        </div>
      </section>
    </div>

    <section id="your-world" aria-labelledby="your-world-heading" class="scroll-mt-24">
      <h2 id="your-world-heading" class="mb-3 text-2xl font-semibold tracking-tight">Your world</h2>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each portalCards as portal (portal.id)}
          <a
            class="group relative min-h-48 overflow-hidden rounded-3xl border border-gray-200 bg-[#171b20] text-white shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-immich-dark-gray"
            href={portal.href}
          >
            {#if portal.mediaId}
              {#if portal.mediaStyle}
                <div
                  class="absolute inset-0 size-full bg-cover bg-center bg-no-repeat transition duration-500 group-hover:scale-[1.025]"
                  style={portal.mediaStyle}
                ></div>
              {:else}
                <img
                  class="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-[1.025]"
                  src={assetUrl(portal.mediaId)}
                  alt=""
                />
              {/if}
            {:else}
              <div
                class="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(124,105,239,0.36),transparent_42%),radial-gradient(circle_at_82%_80%,rgba(41,181,129,0.28),transparent_45%)]"
              ></div>
            {/if}
            <div class="absolute inset-0 bg-linear-to-t from-black/95 via-black/35 to-black/5"></div>
            <div class="relative flex min-h-48 flex-col justify-between p-4">
              <span
                class="flex size-9 items-center justify-center rounded-xl border border-white/20 bg-black/30 backdrop-blur-md"
              >
                <Icon icon={portal.icon} size="19" />
              </span>
              <div>
                <div class="flex items-end justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-baseline gap-2">
                      <h3 class="truncate text-xl font-semibold tracking-[-0.02em]">{portal.name}</h3>
                      <span class="shrink-0 text-xs font-medium text-white/65">{portal.count.toLocaleString()}</span>
                    </div>
                    <p class="mt-0.5 truncate text-sm text-white/76">{portal.preview}</p>
                  </div>
                  <Icon icon={mdiArrowRight} size="20" class="shrink-0 transition group-hover:translate-x-1" />
                </div>
              </div>
            </div>
          </a>
        {/each}
      </div>
    </section>

    <aside
      class="grid gap-3 rounded-3xl border border-gray-200 bg-white p-3 shadow-sm sm:grid-cols-[auto_minmax(16rem,1fr)_auto] sm:items-center dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      aria-label="Cimmich controls"
    >
      <div class="flex min-h-11 items-center justify-center gap-3 px-1 sm:justify-start">
        <span class="text-sm font-semibold whitespace-nowrap">Viewing mode</span>
        <CimmichViewingMode variant="dashboard" />
      </div>

      <form class="relative min-w-0" action={Route.cimmichSmartSearch()} method="get" role="search">
        <label>
          <span class="sr-only">Search your Cimmich library</span>
          <Icon
            class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
            icon={mdiMagnify}
            size="20"
          />
          <input
            class="min-h-11 w-full rounded-2xl border border-gray-200 bg-gray-50 pr-20 pl-11 text-sm transition outline-none placeholder:text-gray-500 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-immich-dark-gray dark:bg-gray-900 dark:placeholder:text-gray-400 dark:focus:border-immich-dark-primary dark:focus:bg-gray-950"
            name="q"
            placeholder="Search people, places and stories…"
            minlength="2"
            maxlength="500"
            autocomplete="off"
          />
        </label>
        <button
          class="absolute top-1 right-1 min-h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-white transition hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="submit"
        >
          Search
        </button>
      </form>

      <a
        class="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 hover:text-immich-fg focus-visible:outline-2 focus-visible:outline-primary sm:justify-end dark:text-gray-300 dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-fg"
        href={Route.cimmichMaintenance()}
      >
        <Icon icon={mdiCogOutline} size="20" />
        Models & Guided
      </a>
    </aside>
  </div>
</UserPageLayout>
