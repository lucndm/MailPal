import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAlias, putAlias } from '$lib/kv.js';
import { generateSlug } from '$lib/sluggen.js';
import { buildAliasInfo, firstEnabledDomain, generateUniqueLocalPart, newAliasConfig } from '$lib/sl-api.js';

const uuid = (): string => crypto.randomUUID();

/** POST /api/alias/random/new — SimpleLogin-compatible random alias creation. */
export const POST: RequestHandler = async ({ url, request, locals }) => {
	const mode = url.searchParams.get('mode') === 'uuid' ? uuid : generateSlug;

	const domain = await firstEnabledDomain(locals.kv);
	if (!domain) {
		return json({ error: 'No domain available' }, { status: 400 });
	}

	const body = await request.json().catch(() => ({}));
	const note =
		(typeof body.note === 'string' ? body.note.trim() : '') ||
		url.searchParams.get('hostname') ||
		undefined;

	const localPart = await generateUniqueLocalPart(locals.kv, domain.domain, mode);
	if (await getAlias(locals.kv, domain.domain, localPart)) {
		return json({ error: 'Cannot allocate a unique alias, please retry' }, { status: 500 });
	}

	const config = newAliasConfig(domain.domain, localPart, null, note);
	await putAlias(locals.kv, config);

	return json(await buildAliasInfo(locals.kv, config), { status: 201 });
};
