import { Route } from '$lib/route';

export const isCimmichPath = (pathname: string) => pathname === '/cimmich' || pathname.startsWith('/cimmich/');

export const isCimmichMode = (pathname: string, libraryContext = false) => isCimmichPath(pathname) || libraryContext;

export const cimmichModeSwitch = (pathname: string, libraryContext = false) => {
  const cimmich = isCimmichMode(pathname, libraryContext);
  return {
    cimmich,
    href: cimmich ? (libraryContext ? pathname : Route.photos()) : Route.cimmichHome(),
    label: cimmich ? 'Switch to Immich' : 'Switch to Cimmich',
  };
};
