// Minimal Cloudflare API client for destination-address verification.
// Ported from BYWled/MailPal (GPL-3.0), trimmed to the single-admin model:
// the token/account come from environment variables instead of KV settings.

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export interface CloudflareDestinationAddress {
	id: string;
	email: string;
	verified: string | null; // ISO timestamp if verified, null if pending
	created: string;
	modified?: string;
}

export interface CloudflareRequestError extends Error {
	isAuthError: boolean;
	status?: number;
	accountId?: string | null;
}

export interface CloudflareZoneInfo {
	id: string;
	name: string;
	status: string;
}

/** Lists all active zones (domains) under the token's account (paginated). */
export async function listAllCfZones(
	token: string,
	baseUrl = 'https://api.cloudflare.com/client/v4'
): Promise<CloudflareZoneInfo[]> {
	let page = 1;
	const perPage = 50;
	const allZones: CloudflareZoneInfo[] = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${baseUrl}/zones?status=active&per_page=${perPage}&page=${page}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' }
		});
		const body = (await res.json().catch(() => ({}))) as {
			success?: boolean;
			result?: CloudflareZoneInfo[];
			result_info?: { page?: number; total_pages?: number };
			errors?: Array<{ code?: number; message?: string }>;
		};

		if (!res.ok) throw parseCfError(res, body, null);
		if (!body.success) {
			throw authError('Failed to list zones from the Cloudflare API', res.status, null);
		}

		allZones.push(...(body.result ?? []));
		if (body.result_info && page < (body.result_info.total_pages ?? page)) page++;
		else hasMore = false;
	}

	return allZones;
}

function authError(message: string, status: number, accountId: string | null): CloudflareRequestError {
	const error = new Error(message) as CloudflareRequestError;
	error.isAuthError = status === 401 || status === 403;
	error.status = status;
	error.accountId = accountId;
	return error;
}

function parseCfError(res: Response, body: unknown, accountId: string | null): CloudflareRequestError {
	const errBody = body as { errors?: Array<{ code?: number; message?: string }> } | null;
	const firstErr = errBody?.errors?.[0];
	const isAuth =
		res.status === 401 ||
		res.status === 403 ||
		firstErr?.code === 10000 ||
		Boolean(firstErr?.message?.includes('Authentication error'));
	const rawMsg = firstErr?.message || `Cloudflare API error (${res.status})`;
	const errCode = firstErr?.code ? ` [Code ${firstErr.code}]` : '';
	const message = isAuth
		? `Cloudflare API authentication failed (${res.status})${errCode}: ${rawMsg}. ` +
			'Check that the API token has "Account -> Email Routing Addresses: Read/Edit" ' +
			'and covers the correct account.'
		: `Cloudflare API error (${res.status})${errCode}: ${rawMsg}`;
	return authError(message, res.status, accountId);
}

/**
 * Resolves the Cloudflare Account ID: explicit value first, then GET /accounts,
 * then falls back to extracting account.id from GET /zones.
 */
export async function getCfAccountId(
	token: string,
	preferredAccountId?: string | null
): Promise<string | null> {
	if (preferredAccountId?.trim()) return preferredAccountId.trim();
	const cleanToken = token.trim();
	if (!cleanToken) return null;

	const headers = { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json' };

	try {
		const res = await fetch(`${CF_API_BASE}/accounts?per_page=20`, { headers });
		if (res.ok) {
			const body = (await res.json().catch(() => ({}))) as {
				success?: boolean;
				result?: Array<{ id?: string }>;
			};
			if (body.success && Array.isArray(body.result) && body.result.length > 0 && body.result[0].id) {
				return body.result[0].id;
			}
		}
	} catch {
		// fall through to zones
	}

	try {
		const res = await fetch(`${CF_API_BASE}/zones?status=active&per_page=20`, { headers });
		if (res.ok) {
			const body = (await res.json().catch(() => ({}))) as {
				success?: boolean;
				result?: Array<{ account?: { id?: string } }>;
			};
			if (body.success && Array.isArray(body.result) && body.result.length > 0 && body.result[0].account?.id) {
				return body.result[0].account.id;
			}
		}
	} catch {
		// ignore
	}

	return null;
}

/** Lists all destination addresses in Cloudflare Email Routing (paginated). */
export async function listCfDestinationAddresses(
	token: string,
	accountId: string
): Promise<CloudflareDestinationAddress[]> {
	let page = 1;
	const perPage = 50;
	const all: CloudflareDestinationAddress[] = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/email/routing/addresses?per_page=${perPage}&page=${page}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' }
		});
		const body = (await res.json().catch(() => ({}))) as {
			success?: boolean;
			result?: CloudflareDestinationAddress[];
			result_info?: { page?: number; total_pages?: number };
			errors?: Array<{ code?: number; message?: string }>;
		};

		if (!res.ok) throw parseCfError(res, body, accountId);
		if (!body.success) {
			throw authError('Failed to retrieve destination addresses from Cloudflare API', res.status, accountId);
		}

		all.push(...(body.result ?? []));
		if (body.result_info && page < (body.result_info.total_pages ?? page)) page++;
		else hasMore = false;
	}

	return all;
}

/**
 * Submits a destination address to Cloudflare Email Routing; Cloudflare then
 * emails a verification link to that address.
 */
export async function createCfDestinationAddress(
	token: string,
	accountId: string,
	email: string
): Promise<CloudflareDestinationAddress> {
	const cleanEmail = email.toLowerCase().trim();
	const url = `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/email/routing/addresses`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: cleanEmail })
	});
	const body = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		result?: CloudflareDestinationAddress;
		errors?: Array<{ code?: number; message?: string }>;
	};

	if (!res.ok || !body.success || !body.result) {
		throw parseCfError(res, body, accountId);
	}
	return body.result;
}
