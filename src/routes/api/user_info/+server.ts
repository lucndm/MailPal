import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { firstEnabledDomain } from '$lib/sl-api.js';

/** GET /api/user_info — minimal SimpleLogin-compatible user info. */
export const GET: RequestHandler = async ({ locals }) => {
	const domain = await firstEnabledDomain(locals.kv);
	return json({
		name: 'MailPal',
		email: domain?.targetEmail ?? '',
		plan: 'Premium',
		in_trial: false,
		alias_quota: null
	});
};
