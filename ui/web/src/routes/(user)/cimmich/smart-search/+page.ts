import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);

  return {
    initialLens: url.searchParams.get('lens') === 'documents' ? ('documents' as const) : ('photos' as const),
    initialQuery: (url.searchParams.get('q') ?? '').trim(),
    meta: {
      title: 'Smart Search',
    },
  };
}) satisfies PageLoad;
