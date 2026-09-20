import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { putAlias } from '$lib/kv.js';
import { findAliasById, buildAliasInfo } from '$lib/sl-api.js';

/** POST /api/aliases/:alias_id/toggle — enable/disable an alias. */
export const POST: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const found = await findAliasById(locals.kv, id);
	if (!found) return json({ error: 'Not found' }, { status: 404 });

	found.alias.enabled = !found.alias.enabled;
	await putAlias(locals.kv, found.alias);

	return json(await buildAliasInfo(locals.kv, found.alias));
};
