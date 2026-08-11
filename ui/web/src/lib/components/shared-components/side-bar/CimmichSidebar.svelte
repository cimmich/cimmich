<script lang="ts">
  import { page } from '$app/state';
  import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
  import { Route } from '$lib/route';
  import { NavbarItem } from '@immich/ui';
  import {
    mdiAccount,
    mdiAccountOutline,
    mdiFileDocumentOutline,
    mdiHome,
    mdiHomeOutline,
    mdiImageMultiple,
    mdiImageMultipleOutline,
    mdiMagnify,
    mdiMap,
    mdiMapOutline,
    mdiPackageVariantClosed,
    mdiPawOutline,
    mdiTuneVariant,
  } from '@mdi/js';

  const isSectionActive = (href: string) => page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
</script>

<Sidebar ariaLabel="Cimmich">
  <NavbarItem
    title="Home"
    href={Route.cimmichHome()}
    icon={mdiHomeOutline}
    activeIcon={mdiHome}
    isActive={() => page.url.pathname === Route.cimmichHome()}
  />
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
    icon={mdiImageMultipleOutline}
    activeIcon={mdiImageMultiple}
    isActive={() => isSectionActive(Route.cimmichEvents())}
  />
  <NavbarItem
    title="Documents"
    href={Route.cimmichDocuments()}
    icon={mdiFileDocumentOutline}
    isActive={() => isSectionActive(Route.cimmichDocuments())}
  />
  <NavbarItem
    title="Organise"
    href={Route.cimmichOrganise()}
    icon={mdiTuneVariant}
    isActive={() => isSectionActive(Route.cimmichOrganise())}
  />
  <NavbarItem
    title="Smart Search"
    href={Route.cimmichSmartSearch()}
    icon={mdiMagnify}
    isActive={() => isSectionActive(Route.cimmichSmartSearch())}
  />
</Sidebar>
