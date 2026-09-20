import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAllAliases } from '$lib/kv.js';
import { buildAliasInfo } from '$lib/sl-api.js';

const PAGE_SIZE = 20;

/** GET /api/v2/aliases — SimpleLogin-compatible paginated alias list. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const pageId = Math.max(0, Number(url.searchParams.get('page_id')) || 0);

	const aliases = (await listAllAliases(locals.kv)).sort((a, b) => b.createdAt - a.createdAt);
	const slice = aliases.slice(pageId * PAGE_SIZE, (pageId + 1) * PAGE_SIZE);
	const infos = await Promise.all(slice.map((a) => buildAliasInfo(locals.kv, a)));

	return json({
		aliases: infos,
		pagination: {
			page_id: pageId,
			is_last: (pageId + 1) * PAGE_SIZE >= aliases.length
		}
	});
};
