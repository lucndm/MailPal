import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDestinations } from '$lib/kv.js';
import {
	getCfAccountId,
	listCfDestinationAddresses,
	createCfDestinationAddress,
	type CloudflareRequestError
} from '$lib/cloudflare.js';

interface CacheEntry {
	value: Awaited<ReturnType<typeof listCfDestinationAddresses>>;
	expiresAt: number;
}

// Small per-isolate cache: Cloudflare's destination list changes rarely and the
// dashboard probes it on every settings open.
const cfAddressesCache = new Map<string, CacheEntry>();

function getCachedAddresses(key: string) {
	const entry = cfAddressesCache.get(key);
	if (!entry) return undefined;
	if (Date.now() > entry.expiresAt) {
		cfAddressesCache.delete(key);
		return undefined;
	}
	return entry.value;
}

function setCachedAddresses(key: string, value: Awaited<ReturnType<typeof listCfDestinationAddresses>>) {
	cfAddressesCache.set(key, { value, expiresAt: Date.now() + 30_000 });
}

function errorPayload(error: unknown, token: string | null, accountId: string | null) {
	const cfError = error as CloudflareRequestError;
	return {
		tokenConfigured: Boolean(token),
		authError: Boolean(cfError?.isAuthError),
		error: cfError?.message || 'Failed to reach the Cloudflare API',
		accountId: cfError?.accountId ?? accountId,
		tokenHint: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null,
		statuses: {}
	};
}

/** GET /api/destinations/probe — Cloudflare verification status for every destination. */
export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.authenticated) return json({ error: 'Unauthorized' }, { status: 401 });

	const token = platform?.env?.CF_API_TOKEN;
	if (!token) {
		return json({
			tokenConfigured: false,
			message: 'Cloudflare API token is not configured (set CF_API_TOKEN)',
			statuses: {}
		});
	}

	let accountId: string | null = platform?.env?.CF_ACCOUNT_ID ?? null;
	try {
		accountId = await getCfAccountId(token, accountId);
		if (!accountId) {
			return json({
				tokenConfigured: true,
				error: 'Could not resolve the Cloudflare Account ID. Set CF_ACCOUNT_ID explicitly.',
				tokenHint: `${token.slice(0, 4)}...${token.slice(-4)}`,
				statuses: {}
			});
		}

		let cfAddresses = getCachedAddresses(accountId);
		if (!cfAddresses) {
			cfAddresses = await listCfDestinationAddresses(token, accountId);
			setCachedAddresses(accountId, cfAddresses);
		}

		const cfMap = new Map(
			cfAddresses.map((addr) => [
				addr.email.toLowerCase(),
				{
					id: addr.id,
					verified: Boolean(addr.verified),
					status: addr.verified ? ('verified' as const) : ('pending' as const),
					created: addr.created
				}
			])
		);

		const statuses: Record<
			string,
			{ id?: string; verified: boolean; status: 'verified' | 'pending' | 'not_in_cf'; created?: string }
		> = {};
		for (const d of await listDestinations(locals.kv)) {
			statuses[d.email] = cfMap.get(d.email.toLowerCase()) ?? {
				verified: false,
				status: 'not_in_cf'
			};
		}

		return json({ tokenConfigured: true, accountId, statuses });
	} catch (error) {
		return json(errorPayload(error, token, accountId), { status: (error as CloudflareRequestError).isAuthError ? 403 : 500 });
	}
};

/**
 * POST /api/destinations/probe — probe one address, or add it to Cloudflare
 * (which triggers the verification email) with action: 'add_to_cf'.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.authenticated) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as {
		email?: string;
		action?: 'probe' | 'add_to_cf';
	};

	const email = body.email?.toLowerCase().trim();
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'A valid email address is required' }, { status: 400 });
	}

	const token = platform?.env?.CF_API_TOKEN;
	if (!token) {
		return json(
			{ error: 'Cloudflare API token is not configured (set CF_API_TOKEN)' },
			{ status: 400 }
		);
	}

	let accountId: string | null = platform?.env?.CF_ACCOUNT_ID ?? null;
	try {
		accountId = await getCfAccountId(token, accountId);
		if (!accountId) {
			return json(
				{ error: 'Could not resolve the Cloudflare Account ID. Set CF_ACCOUNT_ID explicitly.' },
				{ status: 400 }
			);
		}

		if (body.action === 'add_to_cf') {
			const created = await createCfDestinationAddress(token, accountId, email);
			cfAddressesCache.delete(accountId);
			const verified = Boolean(created.verified);
			return json({
				success: true,
				email,
				id: created.id,
				verified,
				status: verified ? ('verified' as const) : ('pending' as const),
				created: created.created,
				message: 'Added to Cloudflare. A verification email has been sent.'
			});
		}

		let cfAddresses = getCachedAddresses(accountId);
		if (!cfAddresses) {
			cfAddresses = await listCfDestinationAddresses(token, accountId);
			setCachedAddresses(accountId, cfAddresses);
		}
		const match = cfAddresses.find((a) => a.email.toLowerCase() === email);

		if (match) {
			const verified = Boolean(match.verified);
			return json({
				success: true,
				email,
				id: match.id,
				verified,
				status: verified ? ('verified' as const) : ('pending' as const),
				created: match.created
			});
		}

		return json({ success: true, email, verified: false, status: 'not_in_cf' });
	} catch (error) {
		const cfError = error as CloudflareRequestError;
		return json(
			{
				success: false,
				error: cfError?.message || 'Failed to interact with the Cloudflare API',
				authError: Boolean(cfError?.isAuthError)
			},
			{ status: cfError?.isAuthError ? 403 : 500 }
		);
	}
};
