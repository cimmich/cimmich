<script lang="ts">
  import { page } from '$app/state';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import {
    mdiCalendarBlankOutline,
    mdiFolderMultipleOutline,
    mdiImageAlbum,
    mdiShieldCheckOutline,
    mdiTagMultipleOutline,
  } from '@mdi/js';

  const modes = [
    {
      href: Route.photos({ organise: 1 }),
      icon: mdiCalendarBlankOutline,
      label: 'Timeline',
      path: Route.photos(),
    },
    {
      href: Route.folders({ organise: 1 }),
      icon: mdiFolderMultipleOutline,
      label: 'Folders',
      path: Route.folders(),
    },
    {
      href: Route.tags({ organise: 1 }),
      icon: mdiTagMultipleOutline,
      label: 'Tags',
      path: Route.tags(),
    },
    {
      href: Route.albums({ organise: 1 }),
      icon: mdiImageAlbum,
      label: 'Albums',
      path: Route.albums(),
    },
  ];

  const isActive = (path: string) => page.url.pathname.startsWith(path);
</script>

<nav class="organise-switch" aria-label="Organise by">
  <span class="organise-switch__label">Organise by</span>
  <div class="organise-switch__modes">
    {#each modes as mode (mode.label)}
      <a
        class:organise-switch__mode--active={isActive(mode.path)}
        class="organise-switch__mode"
        href={mode.href}
        aria-current={isActive(mode.path) ? 'page' : undefined}
        aria-label={`Organise by ${mode.label}`}
        title={`Organise by ${mode.label}`}
      >
        <Icon icon={mode.icon} size="18" />
        <span>{mode.label}</span>
      </a>
    {/each}
  </div>
  <a class="organise-switch__bulk" href={Route.cimmichOrganiseBulk()} title="Open Bulk organise">
    <Icon icon={mdiShieldCheckOutline} size="18" />
    <span>Bulk</span>
  </a>
</nav>

<style>
  .organise-switch {
    display: flex;
    min-height: 3.5rem;
    flex: none;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid color-mix(in srgb, currentColor 9%, transparent);
    border-radius: 1.25rem;
    padding: 0.4rem;
    color: inherit;
    background: color-mix(in srgb, rgb(var(--immich-primary)) 4%, transparent);
  }

  .organise-switch__label {
    flex: none;
    padding-inline: 0.6rem 0.25rem;
    color: color-mix(in srgb, currentColor 58%, transparent);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .organise-switch__modes {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.2rem;
  }

  .organise-switch__mode,
  .organise-switch__bulk {
    display: inline-flex;
    min-height: 2.6rem;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border-radius: 0.9rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 650;
    transition:
      color 140ms ease,
      background 140ms ease,
      box-shadow 140ms ease;
  }

  .organise-switch__mode:hover,
  .organise-switch__bulk:hover {
    color: rgb(var(--immich-primary));
    background: color-mix(in srgb, rgb(var(--immich-primary)) 9%, transparent);
  }

  .organise-switch__mode:focus-visible,
  .organise-switch__bulk:focus-visible {
    outline: 2px solid rgb(var(--immich-primary));
    outline-offset: 2px;
  }

  .organise-switch__mode--active {
    color: rgb(var(--immich-primary));
    background: color-mix(in srgb, rgb(var(--immich-primary)) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(var(--immich-primary)) 20%, transparent);
  }

  .organise-switch__bulk {
    flex: none;
    border-inline-start: 1px solid color-mix(in srgb, currentColor 11%, transparent);
    border-radius: 0 0.9rem 0.9rem 0;
    color: color-mix(in srgb, currentColor 68%, transparent);
  }

  @media (max-width: 639px) {
    .organise-switch {
      gap: 0.2rem;
      border-inline: 0;
      border-radius: 0;
      margin-inline: -0.5rem;
      padding-inline: 0.45rem;
    }

    .organise-switch__label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .organise-switch__modes {
      justify-content: space-between;
    }

    .organise-switch__mode,
    .organise-switch__bulk {
      min-width: 2.65rem;
      padding-inline: 0.65rem;
    }

    .organise-switch__mode span,
    .organise-switch__bulk span {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
</style>
