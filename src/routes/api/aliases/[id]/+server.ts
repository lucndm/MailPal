import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteAlias, deleteLog, putAlias } from '$lib/kv.js';
import { findAliasById, buildAliasInfo } from '$lib/sl-api.js';

function parseId(raw: string): number | null {
	if (!/^\d+$/.test(raw)) return null;
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** GET /api/aliases/:alias_id — SimpleLogin-compatible alias info. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = parseId(params.id);
	if (id === null) return json({ error: 'Not found' }, { status: 404 });

	const found = await findAliasById(locals.kv, id);
	if (!found) return json({ error: 'Not found' }, { status: 404 });

	return json(await buildAliasInfo(locals.kv, found.alias));
};

/** DELETE /api/aliases/:alias_id */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const id = parseId(params.id);
	if (id === null) return json({ error: 'Not found' }, { status: 404 });

	const found = await findAliasById(locals.kv, id);
	if (!found) return json({ error: 'Not found' }, { status: 404 });

	await Promise.all([
		deleteAlias(locals.kv, found.alias.domain, found.alias.localPart),
		deleteLog(locals.kv, found.alias.domain, found.alias.localPart)
	]);
	return json({ ok: true });
};

/** PATCH is not part of the SimpleLogin surface MailPal supports yet. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = parseId(params.id);
	if (id === null) return json({ error: 'Not found' }, { status: 404 });

	const found = await findAliasById(locals.kv, id);
	if (!found) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => ({}));
	if (typeof body.note === 'string') {
		found.alias.note = body.note.trim() || undefined;
		await putAlias(locals.kv, found.alias);
	}
	return json(await buildAliasInfo(locals.kv, found.alias));
};
