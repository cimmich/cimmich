import { Route } from '$lib/route';

export const isCimmichPath = (pathname: string) => pathname === '/cimmich' || pathname.startsWith('/cimmich/');

export const isCimmichMode = (pathname: string, libraryContext = false) => isCimmichPath(pathname) || libraryContext;

export const cimmichModeSwitch = (pathname: string, libraryContext = false, frontierWorkspace = true) => {
  if (!frontierWorkspace) {
    return {
      cimmich: false,
      href: Route.photos(),
      label: 'Immich home',
    };
  }

  const cimmich = isCimmichMode(pathname, libraryContext);
  return {
    cimmich,
    href: cimmich ? (libraryContext ? pathname : Route.photos()) : Route.cimmichHome(),
    label: cimmich ? 'Switch to Immich' : 'Switch to Cimmich',
  };
};
