import { beginCimmichProjection, isCurrentCimmichProjection } from './cimmich-projection-boundary';

describe('Cimmich fail-closed projection boundary', () => {
  it('clears disclosed state synchronously before advancing the generation', () => {
    const order: string[] = [];
    const generation = beginCimmichProjection(4, () => order.push('cleared'));

    order.push(`generation:${generation}`);

    expect(order).toEqual(['cleared', 'generation:5']);
  });

  it('rejects a response from the projection that was invalidated', () => {
    const oldGeneration = 8;
    const currentGeneration = beginCimmichProjection(oldGeneration, () => undefined);

    expect(isCurrentCimmichProjection(oldGeneration, currentGeneration)).toBe(false);
    expect(isCurrentCimmichProjection(currentGeneration, currentGeneration)).toBe(true);
  });

  it.each(['Home', 'Context detail', 'Visual Search', 'Organise Tags'])(
    '%s stays closed during a cross-tab reprojection and after replacement failure',
    async () => {
      let disclosedIds = ['private-asset'];
      let generation = 2;
      const pendingGeneration = (generation = beginCimmichProjection(generation, () => {
        disclosedIds = [];
      }));

      expect(disclosedIds).toEqual([]);

      const crossTabGeneration = (generation = beginCimmichProjection(generation, () => {
        disclosedIds = [];
      }));
      await Promise.reject(new Error('replacement projection unavailable')).catch(() => undefined);

      expect(isCurrentCimmichProjection(pendingGeneration, generation)).toBe(false);
      expect(isCurrentCimmichProjection(crossTabGeneration, generation)).toBe(true);
      expect(disclosedIds).toEqual([]);
    },
  );
});
