import { describe, expect, it } from 'vitest';
import { load } from './+page';

describe('Cimmich root route', () => {
  it('redirects the historical entry point to Cimmich Home', () => {
    let thrown: unknown;
    try {
      load();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ location: '/cimmich/home', status: 307 });
  });
});
