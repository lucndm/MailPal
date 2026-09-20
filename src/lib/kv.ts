import type { KVNamespace } from '@cloudflare/workers-types';
import type { AliasConfig, DestinationAddress, DomainConfig, LogEntry, Tag } from './types.js';

// ─── Domain helpers ───────────────────────────────────────────────────────────

export async function getDomain(
	kv: KVNamespace,
	domain: string
): Promise<DomainConfig | null> {
	const val = await kv.get(`domain:${domain}`);
	return val ? (JSON.parse(val) as DomainConfig) : null;
}

export async function putDomain(kv: KVNamespace, config: DomainConfig): Promise<void> {
	await kv.put(`domain:${config.domain}`, JSON.stringify(config));
}

export async function deleteDomain(kv: KVNamespace, domain: string): Promise<void> {
	await kv.delete(`domain:${domain}`);
}

export async function listDomains(kv: KVNamespace): Promise<DomainConfig[]> {
	const list = await kv.list({ prefix: 'domain:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as DomainConfig) : null;
		})
	);
	return configs.filter((c): c is DomainConfig => c !== null);
}

// ─── Alias helpers ────────────────────────────────────────────────────────────

export function aliasKey(domain: string, localPart: string): string {
	return `alias:${domain}/${localPart}`;
}

export async function getAlias(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<AliasConfig | null> {
	const val = await kv.get(aliasKey(domain, localPart));
	return val ? (JSON.parse(val) as AliasConfig) : null;
}

export async function putAlias(kv: KVNamespace, config: AliasConfig): Promise<void> {
	await kv.put(aliasKey(config.domain, config.localPart), JSON.stringify(config));
}

export async function deleteAlias(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<void> {
	await kv.delete(aliasKey(domain, localPart));
}

export async function listAliases(kv: KVNamespace, domain: string): Promise<AliasConfig[]> {
	const list = await kv.list({ prefix: `alias:${domain}/` });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as AliasConfig) : null;
		})
	);
	return configs.filter((c): c is AliasConfig => c !== null);
}

/** Lists every alias across all configured domains. */
export async function listAllAliases(kv: KVNamespace): Promise<AliasConfig[]> {
	const domains = await listDomains(kv);
	const all = await Promise.all(domains.map((d) => listAliases(kv, d.domain)));
	return all.flat();
}

// ─── Destination address helpers ──────────────────────────────────────────────

export async function listDestinations(kv: KVNamespace): Promise<DestinationAddress[]> {
	const list = await kv.list({ prefix: 'destination:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as DestinationAddress) : null;
		})
	);
	return configs.filter((c): c is DestinationAddress => c !== null);
}

export async function putDestination(kv: KVNamespace, dest: DestinationAddress): Promise<void> {
	await kv.put(`destination:${dest.email}`, JSON.stringify(dest));
}

export async function deleteDestination(kv: KVNamespace, email: string): Promise<void> {
	await kv.delete(`destination:${email}`);
}

// ─── Activity log helpers ─────────────────────────────────────────────────────

export async function getLog(
	kv: KVNamespace,
	domain: string,
	localPart: string
): Promise<LogEntry[]> {
	const val = await kv.get(`log:${domain}/${localPart}`);
	return val ? (JSON.parse(val) as LogEntry[]) : [];
}

export async function deleteLog(kv: KVNamespace, domain: string, localPart: string): Promise<void> {
	await kv.delete(`log:${domain}/${localPart}`);
}

// ─── Admin two-factor (TOTP) helpers ─────────────────────────────────────────

export interface AdminTotpConfig {
	secret: string; // base32
	enabled: boolean;
	createdAt: number;
}

export async function getAdminTotp(kv: KVNamespace): Promise<AdminTotpConfig | null> {
	const val = await kv.get('security:totp');
	return val ? (JSON.parse(val) as AdminTotpConfig) : null;
}

export async function putAdminTotp(kv: KVNamespace, config: AdminTotpConfig): Promise<void> {
	await kv.put('security:totp', JSON.stringify(config));
}

export async function deleteAdminTotp(kv: KVNamespace): Promise<void> {
	await kv.delete('security:totp');
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

export async function listTags(kv: KVNamespace): Promise<Tag[]> {
	const list = await kv.list({ prefix: 'tag:' });
	const configs = await Promise.all(
		list.keys.map(async (k) => {
			const val = await kv.get(k.name);
			return val ? (JSON.parse(val) as Tag) : null;
		})
	);
	return configs.filter((c): c is Tag => c !== null);
}

export async function putTag(kv: KVNamespace, tag: Tag): Promise<void> {
	await kv.put(`tag:${tag.name}`, JSON.stringify(tag));
}

export async function deleteTag(kv: KVNamespace, name: string): Promise<void> {
	await kv.delete(`tag:${name}`);
}
