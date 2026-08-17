<script lang="ts">
  import { page } from '$app/state';
  import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
  import { Route } from '$lib/route';
  import { NavbarGroup, NavbarItem } from '@immich/ui';
  import {
    mdiAccount,
    mdiAccountOutline,
    mdiCalendarBlankOutline,
    mdiClipboardCheckOutline,
    mdiCogOutline,
    mdiFileDocumentOutline,
    mdiFolderSearchOutline,
    mdiHome,
    mdiHomeOutline,
    mdiImageMultipleOutline,
    mdiMap,
    mdiMapOutline,
    mdiPackageVariantClosed,
    mdiPawOutline,
    mdiShieldCheckOutline,
  } from '@mdi/js';

  const isSectionActive = (href: string) => page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  const isLibraryActive = () =>
    page.url.searchParams.has('organise') ||
    isSectionActive(Route.cimmichLibrary()) ||
    isSectionActive(Route.cimmichOrganise());
</script>

<Sidebar ariaLabel="Cimmich">
  <NavbarItem
    title="Home"
    href={Route.cimmichHome()}
    icon={mdiHomeOutline}
    activeIcon={mdiHome}
    isActive={() => page.url.pathname === Route.cimmichHome()}
  />
  <NavbarItem title="Library" href={Route.cimmichLibrary()} icon={mdiImageMultipleOutline} isActive={isLibraryActive} />

  <NavbarGroup title="Browse" size="tiny" />

  <NavbarItem
    title="People"
    href={Route.cimmichPeople()}
    icon={mdiAccountOutline}
    activeIcon={mdiAccount}
    isActive={() => isSectionActive(Route.cimmichPeople())}
  />
  <NavbarItem
    title="Pets"
    href={Route.cimmichPets()}
    icon={mdiPawOutline}
    isActive={() => isSectionActive(Route.cimmichPets())}
  />
  <NavbarItem
    title="Places"
    href={Route.cimmichPlaces()}
    icon={mdiMapOutline}
    activeIcon={mdiMap}
    isActive={() => isSectionActive(Route.cimmichPlaces())}
  />
  <NavbarItem
    title="Things"
    href={Route.cimmichThings()}
    icon={mdiPackageVariantClosed}
    isActive={() => isSectionActive(Route.cimmichThings())}
  />
  <NavbarItem
    title="Events"
    href={Route.cimmichEvents()}
    icon={mdiCalendarBlankOutline}
    isActive={() => isSectionActive(Route.cimmichEvents())}
  />
  <NavbarItem
    title="Documents"
    href={Route.cimmichDocuments()}
    icon={mdiFileDocumentOutline}
    isActive={() => isSectionActive(Route.cimmichDocuments())}
  />
  <NavbarItem
    title="Review"
    href={Route.cimmichSteward()}
    icon={mdiClipboardCheckOutline}
    isActive={() => isSectionActive(Route.cimmichSteward())}
  />

  <NavbarGroup title="Manage" size="tiny" />

  <NavbarItem
    title="Archive Health"
    href={Route.cimmichArchiveIntegrity()}
    icon={mdiShieldCheckOutline}
    isActive={() => isSectionActive(Route.cimmichArchiveIntegrity()) && page.url.searchParams.get('mode') !== 'folder'}
  />
  <NavbarItem
    title="Folder Check"
    href={Route.cimmichArchiveIntegrity({ mode: 'folder' })}
    icon={mdiFolderSearchOutline}
    isActive={() => isSectionActive(Route.cimmichArchiveIntegrity()) && page.url.searchParams.get('mode') === 'folder'}
  />
  <NavbarItem
    title="Settings"
    href={Route.cimmichSettings()}
    icon={mdiCogOutline}
    isActive={() =>
      isSectionActive(Route.cimmichSettings()) ||
      isSectionActive(Route.cimmichSetup()) ||
      isSectionActive(Route.cimmichMaintenance())}
  />
</Sidebar>
