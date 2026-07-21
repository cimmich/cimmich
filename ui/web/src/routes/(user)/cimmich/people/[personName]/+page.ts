import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  return {
    meta: {
      title: decodeURIComponent(params.personName),
    },
    personId: url.searchParams.get('personId') || '',
    personName: decodeURIComponent(params.personName),
  };
}) satisfies PageLoad;
