import { describe, expect, it } from 'vitest';
import { load } from './+page';

describe('Cimmich Home compatibility route', () => {
  it('redirects the historical /cimmich/home entry point to canonical Home', () => {
    let thrown: unknown;
    try {
      load();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ location: '/cimmich', status: 307 });
  });
});
