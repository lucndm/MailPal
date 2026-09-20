import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAdminTotp } from '$lib/kv.js';
import { verifyTotp, normalizeTotpCode } from '$lib/crypto.js';
import {
	createSession,
	COOKIE_NAME,
	COOKIE_MAX_AGE,
	createTwoFactorLoginToken,
	verifyTwoFactorLoginToken
} from '$lib/auth.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.authenticated) {
		throw redirect(302, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, platform, cookies, locals }) => {
		const authPassword = platform?.env?.AUTH_PASSWORD;
		if (!authPassword) {
			return fail(400, { error: 'Password auth is not configured' });
		}

		const data = await request.formData();
		const password = data.get('password') as string;
		const twoFactorToken = (data.get('twoFactorToken') as string) || '';
		const totpCode = normalizeTotpCode((data.get('totpCode') as string) || '');

		// ── Step 2: TOTP verification (password already validated) ──────────
		if (twoFactorToken) {
			if (!(await verifyTwoFactorLoginToken(twoFactorToken, authPassword))) {
				return fail(400, { error: '2FA session expired. Please sign in again.' });
			}

			if (totpCode.length !== 6) {
				return fail(400, {
					error: 'Please enter a 6-digit verification code',
					requires2Fa: true,
					twoFactorToken
				});
			}

			const totp = await getAdminTotp(locals.kv);
			if (!totp?.enabled || !(await verifyTotp(totpCode, totp.secret))) {
				return fail(401, {
					error: 'Invalid verification code',
					requires2Fa: true,
					twoFactorToken
				});
			}

			const sealed = await createSession(authPassword);
			cookies.set(COOKIE_NAME, sealed, {
				path: '/',
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
				maxAge: COOKIE_MAX_AGE
			});
			throw redirect(302, '/');
		}

		// ── Step 1: password ────────────────────────────────────────────────
		if (!password || password !== authPassword) {
			return fail(401, { error: 'Invalid password' });
		}

		const totp = await getAdminTotp(locals.kv);
		if (totp?.enabled) {
			// Issue a sealed, 5-minute token instead of a session. The 6-digit
			// code plus this token are required to complete the login.
			const token = await createTwoFactorLoginToken(authPassword);
			return { requires2Fa: true, twoFactorToken: token };
		}

		const sealed = await createSession(authPassword);
		cookies.set(COOKIE_NAME, sealed, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: COOKIE_MAX_AGE
		});
		throw redirect(302, '/');
	}
};
