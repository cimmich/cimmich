import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  const mode = url.searchParams.get('mode');
  const identityFilter = url.searchParams.get('identityFilter');
  const identityReviewCount = Number(url.searchParams.get('identityReviewCount') || 0);
  const resolvedMode = mode === 'evidence' ? 'identity' : mode;
  const resolvedIdentityFilter = mode === 'evidence' ? 'overview' : identityFilter;

  return {
    meta: {
      title: decodeURIComponent(params.personName),
    },
    personId: url.searchParams.get('personId') || '',
    personName: decodeURIComponent(params.personName),
    mode:
      resolvedMode === 'connections' ||
      resolvedMode === 'details' ||
      resolvedMode === 'documents' ||
      resolvedMode === 'identity' ||
      resolvedMode === 'setup' ||
      resolvedMode === 'split'
        ? resolvedMode
        : 'photos',
    identityFilter:
      resolvedIdentityFilter === 'all' ||
      resolvedIdentityFilter === 'body' ||
      resolvedIdentityFilter === 'candidates' ||
      resolvedIdentityFilter === 'head' ||
      resolvedIdentityFilter === 'lq' ||
      resolvedIdentityFilter === 'needs_qc' ||
      resolvedIdentityFilter === 'overview' ||
      resolvedIdentityFilter === 'presentation' ||
      resolvedIdentityFilter === 'presence' ||
      resolvedIdentityFilter === 'prime' ||
      resolvedIdentityFilter === 'references' ||
      resolvedIdentityFilter === 'secondary'
        ? resolvedIdentityFilter
        : 'overview',
    identityReviewCount: Number.isFinite(identityReviewCount)
      ? Math.min(1_000_000, Math.max(0, Math.floor(identityReviewCount)))
      : 0,
    returnScroll: Math.max(0, Number(url.searchParams.get('returnScroll') || 0) || 0),
  };
}) satisfies PageLoad;
