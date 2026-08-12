import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';

const desktopSidebarPreferenceKey = 'cimmich:desktop-sidebar-open';

const readDesktopSidebarPreference = () => {
  try {
    return globalThis.localStorage?.getItem(desktopSidebarPreferenceKey) !== 'false';
  } catch {
    return true;
  }
};

const writeDesktopSidebarPreference = (isOpen: boolean) => {
  try {
    globalThis.localStorage?.setItem(desktopSidebarPreferenceKey, String(isOpen));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
};

class SidebarStore {
  desktopOpen = $state(readDesktopSidebarPreference());
  mobileOpen = $state(false);

  get isOpen() {
    return mediaQueryManager.isFullSidebar ? this.desktopOpen : this.mobileOpen;
  }

  set isOpen(isOpen: boolean) {
    if (mediaQueryManager.isFullSidebar) {
      this.desktopOpen = isOpen;
      writeDesktopSidebarPreference(isOpen);
    } else {
      this.mobileOpen = isOpen;
    }
  }

  /**
   * Close the temporary small-screen drawer without discarding the desktop preference.
   */
  reset() {
    if (!mediaQueryManager.isFullSidebar) {
      this.mobileOpen = false;
    }
  }

  /**
   * Toggle either the persistent desktop sidebar or the temporary small-screen drawer.
   */
  toggle() {
    this.isOpen = !this.isOpen;
  }
}

export const sidebarStore = new SidebarStore();
