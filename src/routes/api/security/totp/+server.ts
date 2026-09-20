import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminTotp, putAdminTotp, deleteAdminTotp } from '$lib/kv.js';
import {
	generateTotpSecret,
	generateTotpUri,
	generateQrCodeSvg,
	verifyTotp,
	normalizeTotpCode
} from '$lib/crypto.js';

/** GET /api/security/totp — current two-factor status. */
export const GET: RequestHandler = async ({ locals }) => {
	const totp = await getAdminTotp(locals.kv);
	return json({ enabled: totp?.enabled ?? false, createdAt: totp?.createdAt ?? null });
};

/** POST /api/security/totp — begin setup: generate a pending secret + QR. */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
	const authPassword = platform?.env?.AUTH_PASSWORD;
	if (!authPassword) return json({ error: 'Password auth is not configured' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const password = typeof body.password === 'string' ? body.password : '';
	if (!password || password !== authPassword) {
		return json({ error: 'Invalid password' }, { status: 401 });
	}

	const secret = generateTotpSecret();
	const config = { secret, enabled: false, createdAt: Date.now() };
	await putAdminTotp(locals.kv, config);
	const uri = generateTotpUri('admin', secret, 'MailPal');
	return json({ secret, uri, qrSvg: generateQrCodeSvg(uri, 200) });
};

/** PUT /api/security/totp — activate with a 6-digit code confirming the secret. */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const totp = await getAdminTotp(locals.kv);
	if (!totp?.secret) return json({ error: 'No pending setup' }, { status: 400 });
	if (totp.enabled) return json({ error: 'Two-factor is already enabled' }, { status: 409 });

	const body = await request.json().catch(() => ({}));
	const code = typeof body.code === 'string' ? normalizeTotpCode(body.code) : '';
	if (code.length !== 6 || !(await verifyTotp(code, totp.secret))) {
		return json({ error: 'Invalid verification code' }, { status: 400 });
	}

	await putAdminTotp(locals.kv, { ...totp, enabled: true });
	return json({ enabled: true });
};

/** DELETE /api/security/totp — disable, confirmed by a valid code. */
export const DELETE: RequestHandler = async ({ locals, request }) => {
	const totp = await getAdminTotp(locals.kv);
	if (!totp?.enabled) return json({ error: 'Two-factor is not enabled' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const code = typeof body.code === 'string' ? normalizeTotpCode(body.code) : '';
	if (code.length !== 6 || !(await verifyTotp(code, totp.secret))) {
		return json({ error: 'Invalid verification code' }, { status: 400 });
	}

	await deleteAdminTotp(locals.kv);
	return json({ enabled: false });
};
