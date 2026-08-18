import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);

  const requestedLens = url.searchParams.get('lens');

  return {
    initialLens:
      requestedLens === 'documents'
        ? ('documents' as const)
        : requestedLens === 'visual'
          ? ('visual' as const)
          : ('photos' as const),
    initialQuery: (url.searchParams.get('q') ?? '').trim(),
    initialQueryAssetId: (url.searchParams.get('queryAssetId') ?? '').trim(),
    meta: {
      title: 'Smart Search',
    },
  };
}) satisfies PageLoad;
