import type { AliasConfig, DomainConfig, LogEntry } from './types.js';

// ─── Route matching ───────────────────────────────────────────────────────────

const SL_API_EXACT_ROUTES = new Set([
	'/api/auth/login',
	'/api/user_info',
	'/api/v5/alias/options',
	'/api/v3/alias/custom/new',
	'/api/alias/random/new',
	'/api/v2/aliases'
]);

/**
 * True for every route that belongs to the SimpleLogin-compatible API.
 * These routes authenticate via the `Authentication: <api_key>` header
 * instead of the dashboard session cookie.
 */
export function isSimpleLoginApiRoute(pathname: string): boolean {
	if (SL_API_EXACT_ROUTES.has(pathname)) return true;
	return pathname.startsWith('/api/aliases/');
}

export function isSimpleLoginLoginRoute(pathname: string): boolean {
	return pathname === '/api/auth/login';
}

// ─── Secrets comparison ───────────────────────────────────────────────────────

/** Constant-time string comparison to avoid timing attacks. */
export function safeEqual(provided: string, secret: string): boolean {
	if (provided.length !== secret.length) return false;
	let diff = 0;
	for (let i = 0; i < secret.length; i++) {
		diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
	}
	return diff === 0;
}

export function verifyApiKey(header: string | null, apiKey: string): boolean {
	if (!header) return false;
	return safeEqual(header.trim(), apiKey);
}

// ─── Stable numeric IDs (SimpleLogin uses numeric alias/mailbox IDs) ─────────

/** FNV-1a 32-bit hash — stable across restarts, no KV lookup needed. */
export function stableId(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export const aliasId = (domain: string, localPart: string): number =>
	stableId(`alias:${domain}/${localPart}`);

export const mailboxId = (email: string): number => stableId(`mailbox:${email}`);

// ─── Signed suffixes (HMAC-SHA256, base64url) ────────────────────────────────
// SimpleLogin signs alias suffixes so clients cannot tamper with the domain.
// Clients never inspect the signature — they echo `signed_suffix` back — so
// the exact scheme only needs to be self-consistent between MailPal's
// `/api/v5/alias/options` and `/api/v3/alias/custom/new`.

const SIG_LENGTH = 43; // base64url of a 32-byte HMAC-SHA256 digest (unpadded)

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
	const enc = new TextEncoder();
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		enc.encode(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
	return new Uint8Array(sig);
}

function base64UrlEncode(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function signSuffix(suffix: string, apiKey: string): Promise<string> {
	const sig = base64UrlEncode(await hmacSha256(apiKey, suffix));
	return `${suffix}.${sig}`;
}

/**
 * Verifies a signed suffix and returns the bare suffix (e.g. `@example.com`),
 * or null when the signature does not match or the format is wrong.
 */
export async function verifySignedSuffix(
	signedSuffix: unknown,
	apiKey: string
): Promise<string | null> {
	if (typeof signedSuffix !== 'string') return null;
	if (signedSuffix.length <= SIG_LENGTH + 1) return null;
	if (signedSuffix.charAt(signedSuffix.length - SIG_LENGTH - 1) !== '.') return null;
	const suffix = signedSuffix.slice(0, -(SIG_LENGTH + 1));
	const sig = signedSuffix.slice(-SIG_LENGTH);
	const expected = base64UrlEncode(await hmacSha256(apiKey, suffix));
	if (!safeEqual(sig, expected)) return null;
	return suffix;
}

/**
 * Splits a bare suffix like `@example.com` (or a SimpleLogin-style
 * `.word@example.com`) into its local part (`.word` or ``) and domain.
 */
export function splitSuffix(suffix: string): { localPart: string; domain: string } {
	const at = suffix.indexOf('@');
	if (at === -1) return { localPart: suffix, domain: '' };
	return { localPart: suffix.slice(0, at), domain: suffix.slice(at + 1).toLowerCase() };
}

// ─── Hostname → alias prefix suggestion ──────────────────────────────────────

export function prefixSuggestion(hostname: string | null): string {
	if (!hostname) return '';
	const bare = hostname.replace(/^www\./i, '').split('.')[0] ?? '';
	return bare.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
}

// ─── SL alias info formatting ────────────────────────────────────────────────

export interface SimpleLoginMailbox {
	id: number;
	email: string;
}

export interface SimpleLoginAliasInfo {
	id: number;
	email: string;
	name: string | null;
	enabled: boolean;
	creation_timestamp: number;
	creation_date: string;
	note: string | null;
	nb_forward: number;
	nb_block: number;
	nb_reply: number;
	mailbox: SimpleLoginMailbox;
	mailboxes: SimpleLoginMailbox[];
	latest_activity: {
		action: 'forward' | 'block' | 'reply';
		timestamp: number;
		contact: { email: string; name: string | null; reverse_alias: string };
	} | null;
	pinned: boolean;
	support_pgp: boolean;
	disable_pgp: boolean;
}

function toSlDate(ms: number): string {
	return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00:00');
}

/**
 * Maps a MailPal AliasConfig to the SimpleLogin alias info shape
 * (same format as GET /api/aliases/:alias_id).
 */
export function toAliasInfo(
	alias: AliasConfig,
	domain: DomainConfig | null,
	log: LogEntry[] = []
): SimpleLoginAliasInfo {
	const target = alias.targetEmail ?? domain?.targetEmail ?? '';
	const mailbox: SimpleLoginMailbox = { id: mailboxId(target), email: target };
	const last = log.length > 0 ? log[log.length - 1] : null;
	return {
		id: aliasId(alias.domain, alias.localPart),
		email: `${alias.localPart}@${alias.domain}`,
		name: null,
		enabled: alias.enabled,
		creation_timestamp: Math.floor(alias.createdAt / 1000),
		creation_date: toSlDate(alias.createdAt),
		note: alias.note ?? null,
		nb_forward: alias.forwardedCount,
		nb_block: alias.blockedCount,
		nb_reply: 0,
		mailbox,
		mailboxes: [mailbox],
		latest_activity: last
			? {
					action: last.action === 'blocked' ? 'block' : 'forward',
					timestamp: Math.floor(last.at / 1000),
					contact: {
						email: last.from,
						name: null,
						reverse_alias: `"${last.from.replace('@', ' at ')}" <${alias.localPart}@${alias.domain}>`
					}
				}
			: null,
		pinned: false,
		support_pgp: false,
		disable_pgp: false
	};
}
