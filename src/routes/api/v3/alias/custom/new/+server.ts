import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAlias, getDomain, putAlias } from '$lib/kv.js';
import { splitSuffix, verifySignedSuffix } from '$lib/simplelogin.js';
import { buildAliasInfo, newAliasConfig } from '$lib/sl-api.js';

const LOCAL_PART_RE = /^[a-zA-Z0-9._+-]+$/;

/** POST /api/v3/alias/custom/new — SimpleLogin-compatible custom alias creation. */
export const POST: RequestHandler = async ({ url, request, locals, platform }) => {
	const apiKey = platform!.env.SL_API_KEY!;

	const body = await request.json().catch(() => ({}));
	const aliasPrefix = typeof body.alias_prefix === 'string' ? body.alias_prefix.trim() : '';

	if (!LOCAL_PART_RE.test(aliasPrefix)) {
		return json({ error: 'Invalid alias prefix' }, { status: 400 });
	}
	if (aliasPrefix.length > 64) {
		return json({ error: 'Alias prefix must be 64 characters or fewer' }, { status: 400 });
	}

	const suffix = await verifySignedSuffix(body.signed_suffix, apiKey);
	if (!suffix) {
		return json({ error: 'Invalid signed suffix' }, { status: 400 });
	}

	const { localPart: suffixLocalPart, domain: domainName } = splitSuffix(suffix);
	const localPart = `${aliasPrefix}${suffixLocalPart}`;
	if (localPart.length > 64) {
		return json({ error: 'Local part must be 64 characters or fewer' }, { status: 400 });
	}

	const domain = await getDomain(locals.kv, domainName);
	if (!domain || !domain.enabled) {
		return json({ error: 'Domain not available' }, { status: 400 });
	}
	if (await getAlias(locals.kv, domain.domain, localPart)) {
		return json({ error: 'alias already exists' }, { status: 409 });
	}

	const note = (body.note || body.name || url.searchParams.get('hostname') || '').trim();
	const config = newAliasConfig(domain.domain, localPart, null, note || undefined);
	await putAlias(locals.kv, config);

	return json(await buildAliasInfo(locals.kv, config), { status: 201 });
};
