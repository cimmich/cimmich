import { cimmichModeSwitch, isCimmichMode, isCimmichPath } from './navigation-mode-switch';

describe('Cimmich navigation mode switch', () => {
  it.each(['/cimmich', '/cimmich/home', '/cimmich/people/Benji%20Hart'])('recognises %s as Cimmich', (path) => {
    expect(isCimmichPath(path)).toBe(true);
    expect(cimmichModeSwitch(path)).toEqual({ cimmich: true, href: '/photos', label: 'Switch to Immich' });
  });

  it.each(['/photos', '/people/person-1', '/cimmich-api/health'])('keeps %s in Immich mode', (path) => {
    expect(isCimmichPath(path)).toBe(false);
    expect(isCimmichMode(path)).toBe(false);
    expect(cimmichModeSwitch(path)).toEqual({ cimmich: false, href: '/cimmich', label: 'Switch to Cimmich' });
  });

  it.each(['/photos', '/favorites', '/recently-added', '/albums', '/folders', '/tags'])(
    'keeps the Cimmich shell around the %s Library adapter',
    (path) => {
      expect(isCimmichMode(path, true)).toBe(true);
      expect(cimmichModeSwitch(path, true)).toEqual({
        cimmich: true,
        href: path,
        label: 'Switch to Immich',
      });
    },
  );
});
