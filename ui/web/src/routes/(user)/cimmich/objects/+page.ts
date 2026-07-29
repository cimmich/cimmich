import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import type { PageLoad } from './$types';

export const load = (({ url }) => redirect(307, `${Route.cimmichPets()}${url.search}`)) satisfies PageLoad;
