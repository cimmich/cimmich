import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);
  const entityName = decodeURIComponent(params.entityName);

  return {
    meta: {
      title: entityName,
    },
    entityName,
    thingId: url.searchParams.get('thingId') || '',
  };
}) satisfies PageLoad;
