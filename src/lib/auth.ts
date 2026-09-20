import { sealData, unsealData } from 'iron-session';

export const COOKIE_NAME = 'mailpal_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// iron-session requires a secret of at least 32 characters. Pad short
// AUTH_PASSWORD values so a short dashboard password does not crash the
// session seal (ported from BYWled/MailPal).
const MIN_SESSION_SECRET_LENGTH = 32;

export function getSessionSecret(envSecret?: string): string {
	if (envSecret && envSecret.length >= MIN_SESSION_SECRET_LENGTH) return envSecret;
	if (envSecret && envSecret.length > 0) {
		return (envSecret + '-mailpal-session-secret-padding-must-be-32-chars').slice(
			0,
			MIN_SESSION_SECRET_LENGTH
		);
	}
	return 'mailpal-secure-default-session-encryption-key-32chars';
}

interface SessionData {
	authenticated: boolean;
}

/**
 * Seals session data into an encrypted, authenticated token string.
 * Uses iron-session (AES-256-CBC + HMAC-SHA-256) which is compatible
 * with the Web Crypto API available in Cloudflare Workers.
 */
export async function createSession(password: string): Promise<string> {
	const data: SessionData = { authenticated: true };
	return sealData(data, { password: getSessionSecret(password), ttl: COOKIE_MAX_AGE });
}

/**
 * Verifies a sealed session token and returns true if the session is valid.
 * Returns false for any invalid or tampered token.
 */
export async function verifySession(sealed: string | undefined, password: string): Promise<boolean> {
	if (!sealed) return false;
	try {
		const data = await unsealData<SessionData>(sealed, {
			password: getSessionSecret(password),
			ttl: COOKIE_MAX_AGE
		});
		return data.authenticated === true;
	} catch {
		return false;
	}
}

// ─── Two-factor login tokens ────────────────────────────────────────────────
// After a correct dashboard password, if TOTP is enabled, the login action
// hands the client a sealed short-lived token; the 6-digit code plus that
// token are required to mint the real session.
//
// Implementation note: iron-session's unseal tolerates appended/trailing
// garbage in the sealed envelope (verified empirically), so this token uses
// an explicit HMAC-SHA256 seal with strict length checks instead. The token
// carries no secrets — it only gates that step 2 happens within 5 minutes of
// a correct password.

export interface TwoFactorLoginToken {
	purpose: '2fa_login';
	createdAt: number;
}

const TWO_FACTOR_TOKEN_TTL_MS = 5 * 60 * 1000;

function base64UrlEncode(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(value: string): Uint8Array {
	const b64 = value.replaceAll('-', '+').replaceAll('_', '/');
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacSign(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
	return base64UrlEncode(new Uint8Array(sig));
}

function timingSafeEqual(provided: string, expected: string): boolean {
	if (provided.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

export async function createTwoFactorLoginToken(password: string): Promise<string> {
	const payload: TwoFactorLoginToken = {
		purpose: '2fa_login',
		createdAt: Date.now()
	};
	const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
	const signature = await hmacSign(password, body);
	return `${body}.${signature}`;
}

export async function verifyTwoFactorLoginToken(
	token: string | undefined,
	password: string
): Promise<boolean> {
	if (!token) return false;
	const dot = token.indexOf('.');
	if (dot === -1) return false;
	const body = token.slice(0, dot);
	const signature = token.slice(dot + 1);
	const expected = await hmacSign(password, body);
	if (!timingSafeEqual(signature, expected)) return false;
	try {
		const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as Partial<TwoFactorLoginToken>;
		return (
			payload.purpose === '2fa_login' &&
			typeof payload.createdAt === 'number' &&
			Date.now() - payload.createdAt <= TWO_FACTOR_TOKEN_TTL_MS
		);
	} catch {
		return false;
	}
}
