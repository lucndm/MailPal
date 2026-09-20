import type { KVNamespace } from '@cloudflare/workers-types';
import { getAlias, getDomain, getLog, listAllAliases, listDomains } from './kv.js';
import { aliasId, toAliasInfo, type SimpleLoginAliasInfo } from './simplelogin.js';
import type { AliasConfig, DomainConfig } from './types.js';

/** Finds an alias by its SimpleLogin-compatible numeric ID across all domains. */
export async function findAliasById(
	kv: KVNamespace,
	id: number
): Promise<{ alias: AliasConfig; domain: DomainConfig | null } | null> {
	for (const alias of await listAllAliases(kv)) {
		if (aliasId(alias.domain, alias.localPart) === id) {
			const domain = await getDomain(kv, alias.domain);
			return { alias, domain };
		}
	}
	return null;
}

/** Builds the SimpleLogin alias info payload (including latest activity). */
export async function buildAliasInfo(
	kv: KVNamespace,
	alias: AliasConfig
): Promise<SimpleLoginAliasInfo> {
	const [domain, log] = await Promise.all([
		getDomain(kv, alias.domain),
		getLog(kv, alias.domain, alias.localPart)
	]);
	return toAliasInfo(alias, domain, log);
}

/** The first enabled domain (oldest first) — used as the default random-alias domain. */
export async function firstEnabledDomain(kv: KVNamespace): Promise<DomainConfig | null> {
	const domains = (await listDomains(kv)).filter((d) => d.enabled);
	domains.sort((a, b) => a.createdAt - b.createdAt);
	return domains[0] ?? null;
}

/** Generates a unique local part on the given domain (word slug or uuid). */
export async function generateUniqueLocalPart(
	kv: KVNamespace,
	domain: string,
	generator: () => string,
	attempts = 10
): Promise<string> {
	let localPart = generator();
	for (let i = 1; i < attempts && (await getAlias(kv, domain, localPart)); i++) {
		localPart = generator();
	}
	return localPart;
}

/** Creates an AliasConfig with MailPal defaults for a freshly created alias. */
export function newAliasConfig(
	domain: string,
	localPart: string,
	targetEmail: string | null,
	note?: string
): AliasConfig {
	return {
		localPart,
		domain,
		targetEmail,
		enabled: true,
		createdAt: Date.now(),
		forwardedCount: 0,
		blockedCount: 0,
		lastUsedAt: null,
		autoCreated: false,
		...(note && { note })
	};
}
