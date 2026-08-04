import type { Handle } from '@sveltejs/kit';

export const handle = (async ({ event, resolve }) => resolve(event)) satisfies Handle;
