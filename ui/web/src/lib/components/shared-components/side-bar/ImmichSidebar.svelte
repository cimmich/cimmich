<script lang="ts">
  import { page } from '$app/state';
  import BottomInfo from '$lib/components/shared-components/side-bar/BottomInfo.svelte';
  import RecentAlbums from '$lib/components/shared-components/side-bar/RecentAlbums.svelte';
  import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { Route } from '$lib/route';
  import { cimmichCompanionDropdown } from '$lib/stores/cimmich-experience.store';
  import { recentAlbumsDropdown } from '$lib/stores/preferences.store';
  import { NavbarGroup, NavbarItem } from '@immich/ui';
  import {
    mdiAccount,
    mdiAccountMultiple,
    mdiAccountMultipleOutline,
    mdiAccountOutline,
    mdiArchiveArrowDown,
    mdiArchiveArrowDownOutline,
    mdiCalendarBlankOutline,
    mdiClipboardCheckOutline,
    mdiCogOutline,
    mdiFileDocumentOutline,
    mdiFolderOutline,
    mdiFolderSearchOutline,
    mdiHeart,
    mdiHeartOutline,
    mdiImageAlbum,
    mdiImageMultiple,
    mdiImageMultipleOutline,
    mdiLink,
    mdiLock,
    mdiLockOutline,
    mdiMagnify,
    mdiMap,
    mdiMapOutline,
    mdiPackageVariantClosed,
    mdiPawOutline,
    mdiShieldCheckOutline,
    mdiTextSearch,
    mdiTagMultipleOutline,
    mdiToolbox,
    mdiToolboxOutline,
    mdiTrashCan,
    mdiTrashCanOutline,
    mdiUploadOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';

  interface Props {
    includeCimmich?: boolean;
  }

  let { includeCimmich = false }: Props = $props();

  const isOrganiseContext = () => page.url.searchParams.has('organise');
</script>

<Sidebar ariaLabel={$t('primary')}>
  <NavbarItem
    title={$t('photos')}
    href={Route.photos()}
    icon={mdiImageMultipleOutline}
    activeIcon={mdiImageMultiple}
    isActive={() => !isOrganiseContext() && page.url.pathname.startsWith(Route.photos())}
  />

  {#if featureFlagsManager.value.search}
    <NavbarItem title={$t('explore')} href={Route.explore()} icon={mdiMagnify} />
  {/if}

  {#if featureFlagsManager.value.map}
    <NavbarItem title={$t('map')} href={Route.map()} icon={mdiMapOutline} activeIcon={mdiMap} />
  {/if}

  {#if authManager.preferences.people.enabled && authManager.preferences.people.sidebarWeb}
    <NavbarItem title={$t('people')} href={Route.people()} icon={mdiAccountOutline} activeIcon={mdiAccount} />
  {/if}

  {#if includeCimmich}
    <NavbarItem
      title="Cimmich"
      href={Route.cimmichHome()}
      icon={mdiAccountMultipleOutline}
      activeIcon={mdiAccountMultiple}
      isActive={() => isOrganiseContext() || page.url.pathname.startsWith(Route.cimmichHome())}
      bind:expanded={$cimmichCompanionDropdown}
      items={[
        { title: 'Library', href: Route.cimmichLibrary(), icon: mdiImageMultipleOutline },
        { title: 'People', href: Route.cimmichPeople(), icon: mdiAccountOutline, activeIcon: mdiAccount },
        { title: 'Pets', href: Route.cimmichPets(), icon: mdiPawOutline },
        { title: 'Places', href: Route.cimmichPlaces(), icon: mdiMapOutline, activeIcon: mdiMap },
        { title: 'Things', href: Route.cimmichThings(), icon: mdiPackageVariantClosed },
        { title: 'Events', href: Route.cimmichEvents(), icon: mdiCalendarBlankOutline },
        { title: 'Documents', href: Route.cimmichDocuments(), icon: mdiFileDocumentOutline },
        { title: 'Smart Search', href: Route.cimmichSmartSearch(), icon: mdiTextSearch },
        { title: 'Review', href: Route.cimmichSteward(), icon: mdiClipboardCheckOutline },
        { title: 'Archive Health', href: Route.cimmichArchiveIntegrity(), icon: mdiShieldCheckOutline },
        {
          title: 'Folder Check',
          href: Route.cimmichArchiveIntegrity({ mode: 'folder' }),
          icon: mdiFolderSearchOutline,
        },
        { title: 'Settings', href: Route.cimmichSettings(), icon: mdiCogOutline },
      ]}
    />
  {/if}

  {#if authManager.preferences.sharedLinks.enabled && authManager.preferences.sharedLinks.sidebarWeb}
    <NavbarItem title={$t('shared_links')} href={Route.sharedLinks()} icon={mdiLink} />
  {/if}

  <NavbarItem
    title={$t('sharing')}
    href={Route.sharing()}
    icon={mdiAccountMultipleOutline}
    activeIcon={mdiAccountMultiple}
  />

  <NavbarGroup title={$t('library')} size="tiny" />

  <NavbarItem title={$t('favorites')} href={Route.favorites()} icon={mdiHeartOutline} activeIcon={mdiHeart} />

  <NavbarItem
    title={$t('albums')}
    href={Route.albums()}
    icon={{ icon: mdiImageAlbum, flipped: true }}
    isActive={() => !isOrganiseContext() && page.url.pathname.startsWith(Route.albums())}
    bind:expanded={$recentAlbumsDropdown}
  >
    {#snippet items()}
      <span in:fly={{ y: -20 }} class="hidden md:block">
        <RecentAlbums />
      </span>
    {/snippet}
  </NavbarItem>

  {#if authManager.preferences.tags.enabled && authManager.preferences.tags.sidebarWeb}
    <NavbarItem
      title={$t('tags')}
      href={Route.tags()}
      icon={{ icon: mdiTagMultipleOutline, flipped: true }}
      isActive={() => !isOrganiseContext() && page.url.pathname.startsWith(Route.tags())}
    />
  {/if}

  {#if authManager.preferences.recentlyAdded.sidebarWeb}
    <NavbarItem
      title={$t('recently_added')}
      href={Route.recentlyAdded()}
      icon={{ icon: mdiUploadOutline, flipped: true }}
    />
  {/if}

  {#if authManager.preferences.folders.enabled && authManager.preferences.folders.sidebarWeb}
    <NavbarItem
      title={$t('folders')}
      href={Route.folders()}
      icon={{ icon: mdiFolderOutline, flipped: true }}
      isActive={() => !isOrganiseContext() && page.url.pathname.startsWith(Route.folders())}
    />
  {/if}

  <NavbarItem title={$t('utilities')} href={Route.utilities()} icon={mdiToolboxOutline} activeIcon={mdiToolbox} />

  <NavbarItem
    title={$t('archive')}
    href={Route.archive()}
    icon={mdiArchiveArrowDownOutline}
    activeIcon={mdiArchiveArrowDown}
  />

  <NavbarItem title={$t('locked_folder')} href={Route.locked()} icon={mdiLockOutline} activeIcon={mdiLock} />

  {#if featureFlagsManager.value.trash}
    <NavbarItem title={$t('trash')} href={Route.trash()} icon={mdiTrashCanOutline} activeIcon={mdiTrashCan} />
  {/if}

  <BottomInfo />
</Sidebar>
