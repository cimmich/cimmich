import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  const mode = url.searchParams.get('mode');
  const identityFilter = url.searchParams.get('identityFilter');
  const identityReviewCount = Number(url.searchParams.get('identityReviewCount') || 0);

  return {
    meta: {
      title: decodeURIComponent(params.personName),
    },
    personId: url.searchParams.get('personId') || '',
    personName: decodeURIComponent(params.personName),
    mode:
      mode === 'connections' || mode === 'details' || mode === 'documents' || mode === 'identity' || mode === 'setup'
        ? mode
        : 'photos',
    identityFilter:
      identityFilter === 'body' ||
      identityFilter === 'candidates' ||
      identityFilter === 'head' ||
      identityFilter === 'lq' ||
      identityFilter === 'needs_qc' ||
      identityFilter === 'presentation' ||
      identityFilter === 'presence' ||
      identityFilter === 'prime' ||
      identityFilter === 'references' ||
      identityFilter === 'secondary'
        ? identityFilter
        : 'all',
    identityReviewCount: Number.isFinite(identityReviewCount)
      ? Math.min(1_000_000, Math.max(0, Math.floor(identityReviewCount)))
      : 0,
    returnScroll: Math.max(0, Number(url.searchParams.get('returnScroll') || 0) || 0),
  };
}) satisfies PageLoad;
