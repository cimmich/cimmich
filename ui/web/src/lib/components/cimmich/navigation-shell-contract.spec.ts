import { readFile } from 'node:fs/promises';

describe('Cimmich navigation shell contract', () => {
  it('offers the familiar nested shell by default and the dedicated Frontier Workspace by choice', async () => {
    const [navigation, layout, people, shell, cimmichSidebar, immichSidebar] = await Promise.all([
      readFile('src/lib/components/shared-components/navigation-bar/NavigationBar.svelte', 'utf8'),
      readFile('src/lib/components/layouts/UserPageLayout.svelte', 'utf8'),
      readFile('src/routes/(user)/cimmich/people/+page.svelte', 'utf8'),
      readFile('src/lib/components/shared-components/side-bar/UserSidebar.svelte', 'utf8'),
      readFile('src/lib/components/shared-components/side-bar/CimmichSidebar.svelte', 'utf8'),
      readFile('src/lib/components/shared-components/side-bar/ImmichSidebar.svelte', 'utf8'),
    ]);

    expect(navigation).toContain("$cimmichExperience === 'frontier'");
    expect(navigation).toContain('cimmichModeSwitch(');
    expect(navigation).toContain('<CimmichTopSearch />');
    expect(navigation).toContain('modeSwitch.cimmich ? Route.cimmichSmartSearch() : Route.search()');
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
    expect(shell).toContain("$cimmichExperience === 'frontier'");
    expect(shell).toContain("isCimmichMode(page.url.pathname, page.url.searchParams.has('organise'))");
    expect(shell).toContain('<CimmichSidebar />');
    expect(shell).toContain("<ImmichSidebar includeCimmich={$cimmichExperience === 'companion'} />");
    expect(cimmichSidebar).toContain('title="Home"');
    expect(cimmichSidebar).toContain('href={Route.cimmichHome()}');
    expect(cimmichSidebar).toContain('title="Library"');
    expect(cimmichSidebar).toContain('href={Route.cimmichLibrary()}');
    expect(cimmichSidebar).not.toContain('title="Review"');
    expect(cimmichSidebar).toContain('title="Archive Health"');
    expect(cimmichSidebar).not.toContain('title="Folder Check"');
    expect(cimmichSidebar).toContain('title="Settings"');
    expect(cimmichSidebar).not.toContain('title="Smart Search"');
    expect(cimmichSidebar).not.toContain('bind:expanded');
    expect(immichSidebar).toContain('{#if includeCimmich}');
    expect(immichSidebar).toContain('title="Cimmich"');
    expect(immichSidebar).toContain('href={Route.cimmichHome()}');
    expect(immichSidebar).toContain('bind:expanded={$cimmichCompanionDropdown}');
    expect(immichSidebar).toContain("{ title: 'Smart Search', href: Route.cimmichSmartSearch()");
    expect(immichSidebar).not.toContain("title: 'Folder Check'");
    expect(immichSidebar).not.toContain("{ title: 'Review', href: Route.cimmichSteward()");
    expect(people).not.toContain('Identity checks');
    expect(people).not.toContain('Route.cimmichSteward()');
    expect(people).toContain('{#snippet actions()}');
    expect(people).toContain(
      'class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap"',
    );
    expect(people).not.toContain('class="flex w-full min-w-0 flex-wrap items-center gap-2 sm:justify-end"');
    expect(people).toContain('<Tooltip text="Thumbnail size">');
    expect(people).toContain("tooltip: 'Browse people with accepted photos'");
    expect(people).toContain("tooltip: 'People with new identity suggestions to review'");
    expect(people).toContain("tooltip: 'Review unassigned faces that may belong together'");
    expect(people).toContain("tooltip: 'People with unresolved sorting or identity work'");
    expect(people).toContain('<Tooltip text="Search names in the current People mode">');
    expect(immichSidebar).toContain("{ title: 'Settings', href: Route.cimmichSettings()");
  });
});
