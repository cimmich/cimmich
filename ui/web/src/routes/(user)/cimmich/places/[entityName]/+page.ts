import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

// One dynamic segment serves both families in this section: Places and Things
// share a page, and the id param (?placeId= / ?thingId=) says which family a
// URL means, so no ?family= is needed on a detail link.
export const load = (async ({ params, url }) => {
  await authenticate(url);
  const entityName = decodeURIComponent(params.entityName);

  return {
    meta: {
      title: entityName,
    },
    entityName,
    placeId: url.searchParams.get('placeId') || '',
    thingId: url.searchParams.get('thingId') || '',
  };
}) satisfies PageLoad;
