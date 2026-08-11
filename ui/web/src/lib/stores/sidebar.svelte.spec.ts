import { sidebarStore } from './sidebar.svelte';

const mocks = vi.hoisted(() => ({ mediaQueryManager: { isFullSidebar: true } }));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({ mediaQueryManager: mocks.mediaQueryManager }));

describe('sidebar store', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.mediaQueryManager.isFullSidebar = true;
    sidebarStore.desktopOpen = true;
    sidebarStore.mobileOpen = false;
  });

  it('collapses and persists the desktop sidebar', () => {
    sidebarStore.toggle();
    expect(sidebarStore.isOpen).toBe(false);
    expect(localStorage.getItem('cimmich:desktop-sidebar-open')).toBe('false');

    sidebarStore.reset();
    expect(sidebarStore.isOpen).toBe(false);
  });

  it('treats the small-screen sidebar as a temporary drawer', () => {
    mocks.mediaQueryManager.isFullSidebar = false;
    sidebarStore.toggle();
    expect(sidebarStore.isOpen).toBe(true);

    sidebarStore.reset();
    expect(sidebarStore.isOpen).toBe(false);
    expect(sidebarStore.desktopOpen).toBe(true);
  });
});
