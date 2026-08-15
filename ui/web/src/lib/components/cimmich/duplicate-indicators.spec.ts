import { exactDuplicateIndicator, possibleVersionIndicator } from './duplicate-indicators';

describe('Cimmich duplicate indicators', () => {
  it('routes verified complete-file copies to exact evidence', () => {
    expect(exactDuplicateIndicator('asset-one', { copyCount: 3 })).toMatchObject({
      classification: 'verified_exact',
      count: 3,
      href: '/cimmich/archive-integrity?assetId=asset-one&mode=exact',
      kind: 'exact',
      label: 'Exact copy · 3 files',
    });
  });

  it('keeps digest-different local similarity honest', () => {
    expect(possibleVersionIndicator('asset-two', 'verified_variant', 2)).toMatchObject({
      classification: 'verified_variant',
      count: 2,
      href: '/cimmich/archive-integrity?assetId=asset-two&mode=variants',
      kind: 'possible_version',
      label: 'Possible version · 2 files',
    });
  });

  it('labels byte-incomplete similarity as possible rather than exact', () => {
    const indicator = possibleVersionIndicator('asset-three', 'similarity_candidate', 4);
    expect(indicator.kind).toBe('possible_version');
    expect(indicator.label).toBe('Possible duplicate · 4 files');
    expect(indicator.reason).toContain('byte evidence is not yet available');
  });
});
