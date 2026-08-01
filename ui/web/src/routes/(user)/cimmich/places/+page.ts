import { redirect } from '@sveltejs/kit';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);

  if (url.searchParams.get('family') === 'objects') {
    const next = new URL(url);
    next.pathname = '/cimmich/things';
    next.searchParams.delete('family');
    redirect(307, `${next.pathname}${next.search}`);
  }

  return {
    meta: {
      title: 'Places',
    },
  };
}) satisfies PageLoad;
