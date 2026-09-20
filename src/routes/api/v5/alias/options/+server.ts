import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDomains } from '$lib/kv.js';
import { prefixSuggestion, signSuffix } from '$lib/simplelogin.js';

/** GET /api/v5/alias/options — SimpleLogin-compatible alias options. */
export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const apiKey = platform!.env.SL_API_KEY!;
	const hostname = url.searchParams.get('hostname');

	const domains = (await listDomains(locals.kv)).filter((d) => d.enabled);
	const suffixes = await Promise.all(
		domains.map(async (d) => ({
			suffix: `@${d.domain}`,
			signed_suffix: await signSuffix(`@${d.domain}`, apiKey),
			is_custom: true,
			is_premium: false
		}))
	);

	return json({
		can_create: suffixes.length > 0,
		prefix_suggestion: prefixSuggestion(hostname),
		suffixes
	});
};
