<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import {
    mdiArrowRight,
    mdiCalendarBlankOutline,
    mdiFolderMultipleOutline,
    mdiImageAlbum,
    mdiShieldCheckOutline,
    mdiTagMultipleOutline,
    mdiTuneVariant,
  } from '@mdi/js';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const organiseViews = [
    {
      description: 'Move naturally through years, months and days.',
      eyebrow: 'When it happened',
      href: Route.photos(),
      icon: mdiCalendarBlankOutline,
      title: 'By Timeline',
      tone: 'organise-card--timeline',
    },
    {
      description: 'Follow the folder structure your archive already has.',
      eyebrow: 'Where it lives',
      href: Route.folders(),
      icon: mdiFolderMultipleOutline,
      title: 'By Folder',
      tone: 'organise-card--folder',
    },
    {
      description: 'Browse the labels and topics you use across the library.',
      eyebrow: 'What it is about',
      href: Route.tags(),
      icon: mdiTagMultipleOutline,
      title: 'By Tag',
      tone: 'organise-card--tag',
    },
    {
      description: 'Open the collections you have deliberately brought together.',
      eyebrow: 'What belongs together',
      href: Route.albums(),
      icon: mdiImageAlbum,
      title: 'By Album',
      tone: 'organise-card--album',
    },
  ];
</script>

<UserPageLayout title={data.meta.title}>
  <main class="organise-hub mx-auto w-full max-w-[1440px] px-4 pb-24 sm:px-6 lg:px-10">
    <section class="max-w-5xl pt-6 sm:pt-8">
      <div class="organise-mark"><Icon icon={mdiTuneVariant} size="29" /></div>
      <p class="mt-3 text-sm font-semibold tracking-[0.18em] text-primary uppercase">Organise</p>
      <h1
        class="mt-1 text-3xl font-semibold tracking-tight text-immich-primary sm:text-4xl dark:text-immich-dark-primary"
      >
        Choose how you want to see your library
      </h1>
      <p class="mt-3 max-w-2xl text-base/7 text-immich-fg/70 dark:text-immich-dark-fg/70">
        Start with the structure that already makes sense to you. Nothing changes until you choose an action.
      </p>
    </section>

    <section class="mt-7" aria-labelledby="organise-browse-heading">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.15em] text-immich-fg/50 uppercase dark:text-immich-dark-fg/50">
            Your library, four ways
          </p>
          <h2 id="organise-browse-heading" class="mt-1 text-2xl font-semibold">Browse and organise</h2>
        </div>
        <p class="max-w-xl text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
          Timeline, folders, tags and albums stay distinct—choose the one that matches the job in your head.
        </p>
      </div>

      <div class="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {#each organiseViews as view (view.title)}
          <a class={`organise-card ${view.tone}`} href={view.href} aria-label={`${view.title}: ${view.description}`}>
            <span class="organise-card__icon"><Icon icon={view.icon} size="27" /></span>
            <span class="min-w-0">
              <span class="text-[11px] font-semibold tracking-[0.13em] uppercase opacity-55">{view.eyebrow}</span>
              <strong class="mt-2 block text-xl font-semibold">{view.title}</strong>
              <span class="mt-2 block text-sm/6 opacity-70">{view.description}</span>
            </span>
            <span class="organise-card__arrow" aria-hidden="true"><Icon icon={mdiArrowRight} size="20" /></span>
          </a>
        {/each}
      </div>
    </section>

    <section class="organise-bulk mt-10" aria-labelledby="organise-bulk-heading">
      <div class="organise-bulk__icon"><Icon icon={mdiShieldCheckOutline} size="27" /></div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold tracking-[0.14em] text-primary uppercase">Power tool</p>
        <h2 id="organise-bulk-heading" class="mt-1 text-2xl font-semibold">Bulk organise</h2>
        <p class="mt-2 max-w-2xl text-sm/6 text-immich-fg/65 dark:text-immich-dark-fg/65">
          Find a precise set, inspect it, then apply one reversible change. Use this when browsing alone is not enough.
        </p>
        <div class="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-immich-fg/60 dark:text-immich-dark-fg/60">
          <span class="organise-proof">Preview first</span><span class="organise-proof">Safe batches</span><span
            class="organise-proof">Saved Undo</span
          >
        </div>
      </div>
      <a class="organise-bulk__action" href={Route.cimmichOrganiseBulk()}>
        Open bulk organise <Icon icon={mdiArrowRight} size="19" />
      </a>
    </section>
  </main>
</UserPageLayout>

<style>
  .organise-mark {
    display: grid;
    width: 3.25rem;
    height: 3.25rem;
    place-items: center;
    border-radius: 1.25rem;
    color: rgb(var(--immich-primary));
    background: color-mix(in srgb, rgb(var(--immich-primary)) 11%, transparent);
  }

  .organise-card {
    position: relative;
    display: grid;
    min-height: 14rem;
    grid-template-rows: auto 1fr auto;
    gap: 1.25rem;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
    border-radius: 1.75rem;
    padding: 1.4rem;
    color: inherit;
    background: color-mix(in srgb, var(--organise-accent) 8%, transparent);
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
    transition:
      transform 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease;
  }

  .organise-card::after {
    position: absolute;
    right: -2rem;
    bottom: -3.5rem;
    width: 9rem;
    height: 9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--organise-accent) 12%, transparent);
    content: '';
  }

  .organise-card:hover {
    z-index: 1;
    border-color: color-mix(in srgb, var(--organise-accent) 52%, transparent);
    box-shadow: 0 18px 40px rgb(0 0 0 / 10%);
    transform: translateY(-3px);
  }

  .organise-card:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--organise-accent) 55%, transparent);
    outline-offset: 3px;
  }

  .organise-card--timeline {
    --organise-accent: #6d7cff;
  }
  .organise-card--folder {
    --organise-accent: #3f9e81;
  }
  .organise-card--tag {
    --organise-accent: #b16ad8;
  }
  .organise-card--album {
    --organise-accent: #d9884f;
  }

  .organise-card__icon,
  .organise-bulk__icon {
    display: grid;
    width: 3.25rem;
    height: 3.25rem;
    place-items: center;
    border-radius: 1.1rem;
    color: var(--organise-accent);
    background: color-mix(in srgb, var(--organise-accent) 14%, transparent);
  }

  .organise-card__arrow {
    z-index: 1;
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    justify-self: end;
    border-radius: 999px;
    color: var(--organise-accent);
    background: color-mix(in srgb, var(--organise-accent) 14%, transparent);
  }

  .organise-bulk {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
    border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    border-radius: 1.75rem;
    padding: 1.4rem;
    background: color-mix(in srgb, rgb(var(--immich-primary)) 4%, transparent);
  }

  .organise-bulk__icon {
    --organise-accent: rgb(var(--immich-primary));
    flex: none;
  }

  .organise-bulk__action {
    display: inline-flex;
    min-height: 2.75rem;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    align-self: center;
    border-radius: 999px;
    padding: 0.65rem 1.1rem;
    color: white;
    background: rgb(var(--immich-primary));
    font-size: 0.875rem;
    font-weight: 700;
  }

  .organise-proof {
    border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    border-radius: 999px;
    padding: 0.35rem 0.65rem;
    background: color-mix(in srgb, currentColor 4%, transparent);
  }

  @media (max-width: 639px) {
    .organise-card {
      min-height: 12.5rem;
    }

    .organise-bulk {
      flex-wrap: wrap;
    }

    .organise-bulk__action {
      width: 100%;
    }
  }
</style>
