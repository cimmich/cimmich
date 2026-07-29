import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  return {
    meta: {
      title: decodeURIComponent(params.petName),
    },
    petId: url.searchParams.get('petId') || '',
    petName: decodeURIComponent(params.petName),
  };
}) satisfies PageLoad;
