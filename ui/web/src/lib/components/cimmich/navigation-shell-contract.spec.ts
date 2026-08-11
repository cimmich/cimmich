import { readFile } from 'node:fs/promises';

describe('Cimmich navigation shell contract', () => {
  it('keeps Immich branding in Immich mode and exposes Cimmich branding as the mode switch', async () => {
    const [navigation, layout, people] = await Promise.all([
      readFile('src/lib/components/shared-components/navigation-bar/NavigationBar.svelte', 'utf8'),
      readFile('src/lib/components/layouts/UserPageLayout.svelte', 'utf8'),
      readFile('src/routes/(user)/cimmich/people/+page.svelte', 'utf8'),
    ]);

    expect(navigation).toContain('cimmichModeSwitch(page.url.pathname)');
    expect(navigation).toContain('src="/cimmich-logo.png"');
    expect(navigation).toContain("<Logo variant={showInlineBrand ? 'inline' : 'icon'}");
    expect(navigation).toContain('aria-label={modeSwitch.label}');
    expect(navigation).toContain('sidebarStore.toggle()');
    expect(navigation).not.toContain('class="sidebar:hidden"');
    expect(navigation).toContain('class:grid-cols-[--spacing(32)_auto]={!showInlineBrand}');
    expect(layout).toContain(
      'class:grid-cols-[--spacing(64)_auto]={sidebarStore.isOpen && mediaQueryManager.isFullSidebar}',
    );
    expect(people).not.toContain('initiallyExpanded');
  });
});
