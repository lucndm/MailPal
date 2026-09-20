import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAdminTotp } from '$lib/kv.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.authenticated) throw redirect(302, '/login');
	const totp = await getAdminTotp(locals.kv);
	return { enabled: totp?.enabled ?? false };
};
