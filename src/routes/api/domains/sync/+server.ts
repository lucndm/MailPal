import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDomains, putDomain } from '$lib/kv.js';
import { listAllCfZones, type CloudflareRequestError } from '$lib/cloudflare.js';
import type { DomainConfig } from '$lib/types.js';

// Same RFC 1123 shape as POST /api/domains.
const DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/domains/sync — import every active Cloudflare zone that is not
 * registered in MailPal yet. Imported domains either start disabled (when no
 * default target is provided) or enabled with the chosen default target.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.authenticated) return json({ error: 'Unauthorized' }, { status: 401 });

	const token = platform?.env?.CF_API_TOKEN;
	if (!token) {
		return json(
			{ error: 'Cloudflare API token is not configured (set CF_API_TOKEN)', tokenConfigured: false },
			{ status: 400 }
		);
	}
	const baseUrl = platform?.env?.CF_API_BASE || 'https://api.cloudflare.com/client/v4';

	const body = (await request.json().catch(() => ({}))) as {
		defaultTargetEmail?: string;
		enable?: boolean;
	};
	const defaultTarget = body.defaultTargetEmail?.toLowerCase().trim() ?? '';
	const enable = body.enable === true;

	if (enable && !EMAIL_RE.test(defaultTarget)) {
		return json({ error: 'A valid defaultTargetEmail is required when enable is true' }, { status: 400 });
	}
	if (defaultTarget && !EMAIL_RE.test(defaultTarget)) {
		return json({ error: 'Invalid defaultTargetEmail' }, { status: 400 });
	}

	let zones;
	try {
		zones = await listAllCfZones(token, baseUrl);
	} catch (error) {
		const cfError = error as CloudflareRequestError;
		return json(
			{
				error: cfError?.message || 'Failed to list zones from the Cloudflare API',
				authError: Boolean(cfError?.isAuthError),
				tokenHint: `${token.slice(0, 4)}...${token.slice(-4)}`
			},
			{ status: cfError?.isAuthError ? 403 : 500 }
		);
	}

	const existing = new Set((await listDomains(locals.kv)).map((d) => d.domain.toLowerCase()));
	const imported: DomainConfig[] = [];

	for (const zone of zones) {
		const domainName = zone.name?.toLowerCase().trim().replace(/\.+$/, '');
		if (!domainName || !DOMAIN_RE.test(domainName) || existing.has(domainName)) continue;

		const config: DomainConfig = {
			domain: domainName,
			targetEmail: defaultTarget,
			wildcardEnabled: false,
			enabled: enable && Boolean(defaultTarget),
			createdAt: Date.now()
		};
		await putDomain(locals.kv, config);
		existing.add(domainName);
		imported.push(config);
	}

	return json({
		totalZones: zones.length,
		added: imported.length,
		skipped: zones.length - imported.length,
		domains: imported
	});
};
