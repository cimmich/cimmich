import { describe, expect, it } from 'vitest';
import { guidedPresentation } from './guided-presentation';

describe('Guided V2 owner presentation', () => {
  it('presents the configured canonical authority and visibility ceiling', () => {
    expect(
      guidedPresentation({
        bootstrapEndpoint: '/v1/guided/v2/bootstrap',
        canonicalAuthority: 'operate',
        configured: true,
        enabled: true,
        schemaVersion: 'cimmich.guided-setup.v1',
        visibilityCeiling: 'private',
      }),
    ).toMatchObject({
      authorityLabel: 'Operate',
      bootstrapEndpoint: '/v1/guided/v2/bootstrap',
      ceilingLabel: 'Private ceiling',
    });
  });

  it('defaults discovery to V2 without inventing an authority grant', () => {
    expect(guidedPresentation(undefined)).toMatchObject({
      authorityLabel: 'Operator configured',
      bootstrapEndpoint: '/v1/guided/v2/bootstrap',
      ceilingLabel: 'Operator-set ceiling',
      legacyCapabilitiesEndpoint: '/v1/guided/v1/capabilities',
    });
  });
});
