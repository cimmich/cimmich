import type { CimmichIntegrationStatus } from '$lib/services/cimmich.service';

type GuidedSetup = CimmichIntegrationStatus['guided'] | undefined;

const titleCase = (value: string) => `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

export const guidedPresentation = (setup: GuidedSetup) => ({
  authorityLabel: setup?.canonicalAuthority ? titleCase(setup.canonicalAuthority) : 'Operator configured',
  bootstrapEndpoint: setup?.bootstrapEndpoint ?? '/v1/guided/v2/bootstrap',
  ceilingLabel: setup?.visibilityCeiling ? `${titleCase(setup.visibilityCeiling)} ceiling` : 'Operator-set ceiling',
  legacyCapabilitiesEndpoint: setup?.capabilitiesEndpoint ?? '/v1/guided/v1/capabilities',
});
