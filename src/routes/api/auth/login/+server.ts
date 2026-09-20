import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { safeEqual } from '$lib/simplelogin.js';

/**
 * POST /api/auth/login — SimpleLogin-compatible authentication.
 * Exchanges the dashboard password (AUTH_PASSWORD) for the API key,
 * so official SimpleLogin clients can log in instead of pasting a key.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	const authPassword = platform?.env?.AUTH_PASSWORD;
	const apiKey = platform?.env?.SL_API_KEY;
	if (!authPassword || !apiKey) {
		return json({ error: 'Password authentication is not enabled' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const password = typeof body.password === 'string' ? body.password : '';
	if (!password || !safeEqual(password, authPassword)) {
		return json({ error: 'Wrong email or password' }, { status: 401 });
	}

	return json({
		name: 'MailPal',
		email: '',
		mfa_enabled: false,
		mfa_key: '',
		api_key: apiKey
	});
};
