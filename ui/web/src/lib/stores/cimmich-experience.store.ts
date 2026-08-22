import { persisted } from 'svelte-persisted-store';
import { env } from '$env/dynamic/public';

export type CimmichExperience = 'companion' | 'frontier';

export const CIMMICH_EXPERIENCE_PREFERENCE_KEY = 'cimmich-experience-v1';
export const CIMMICH_LOCAL_AI_EXPERIMENT_PREFERENCE_KEY = 'cimmich-local-ai-experiment-v1';
export const CIMMICH_DISCOVER_EXPERIMENT_PREFERENCE_KEY = 'cimmich-discover-experiment-v1';

export const resolveCimmichExperienceDefault = (value: string | undefined): CimmichExperience =>
  value === 'frontier' ? 'frontier' : 'companion';

export const resolveCimmichExperimentDefault = (value: string | undefined) => value === 'true';

const experienceDefault = resolveCimmichExperienceDefault(env.PUBLIC_CIMMICH_DEFAULT_EXPERIENCE);
const localAiDefault = resolveCimmichExperimentDefault(env.PUBLIC_CIMMICH_LOCAL_AI_EXPERIMENTAL_DEFAULT);
const discoverDefault = resolveCimmichExperimentDefault(env.PUBLIC_CIMMICH_DISCOVER_EXPERIMENTAL_DEFAULT);

export const cimmichExperience = persisted<CimmichExperience>(CIMMICH_EXPERIENCE_PREFERENCE_KEY, experienceDefault, {
  serializer: {
    parse: (text) => (text === 'frontier' || text === 'companion' ? text : experienceDefault),
    stringify: String,
  },
});

export const cimmichCompanionDropdown = persisted<boolean>('cimmich-companion-open-v1', true, {});

export const cimmichLocalAiExperiment = persisted<boolean>(CIMMICH_LOCAL_AI_EXPERIMENT_PREFERENCE_KEY, localAiDefault, {
  serializer: {
    parse: (text) => (text === 'true' ? true : text === 'false' ? false : localAiDefault),
    stringify: String,
  },
});

export const cimmichDiscoverExperiment = persisted<boolean>(
  CIMMICH_DISCOVER_EXPERIMENT_PREFERENCE_KEY,
  discoverDefault,
  {
    serializer: {
      parse: (text) => (text === 'true' ? true : text === 'false' ? false : discoverDefault),
      stringify: String,
    },
  },
);
