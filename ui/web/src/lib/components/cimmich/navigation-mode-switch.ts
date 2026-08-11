import { Route } from '$lib/route';

export const isCimmichPath = (pathname: string) => pathname === '/cimmich' || pathname.startsWith('/cimmich/');

export const cimmichModeSwitch = (pathname: string) => {
  const cimmich = isCimmichPath(pathname);
  return {
    cimmich,
    href: cimmich ? Route.photos() : Route.cimmichHome(),
    label: cimmich ? 'Switch to Immich' : 'Switch to Cimmich',
  };
};
