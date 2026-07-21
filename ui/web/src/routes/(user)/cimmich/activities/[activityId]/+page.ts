import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  return {
    activityId: params.activityId,
    meta: {
      title: 'Legacy activity lab unavailable',
    },
  };
}) satisfies PageLoad;
