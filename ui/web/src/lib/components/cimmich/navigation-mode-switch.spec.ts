import { cimmichModeSwitch, isCimmichPath } from './navigation-mode-switch';

describe('Cimmich navigation mode switch', () => {
  it.each(['/cimmich', '/cimmich/home', '/cimmich/people/Benji%20Hart'])('recognises %s as Cimmich', (path) => {
    expect(isCimmichPath(path)).toBe(true);
    expect(cimmichModeSwitch(path)).toEqual({ cimmich: true, href: '/photos', label: 'Switch to Immich' });
  });

  it.each(['/photos', '/people/person-1', '/cimmich-api/health'])('keeps %s in Immich mode', (path) => {
    expect(isCimmichPath(path)).toBe(false);
    expect(cimmichModeSwitch(path)).toEqual({ cimmich: false, href: '/cimmich/home', label: 'Switch to Cimmich' });
  });
});
