import type { KVNamespace } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Platform {
			env: {
				KV: KVNamespace;
				AUTH_PASSWORD?: string;
				SL_API_KEY?: string;
				CF_API_TOKEN?: string;
				CF_ACCOUNT_ID?: string;
				CF_API_BASE?: string;
				DEMO_MODE?: string;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
		interface Locals {
			kv: KVNamespace;
			authMode: 'password' | 'cloudflare-access';
			authenticated: boolean;
			demo?: boolean;
		}
		interface Error {}
		interface PageData {}
	}
}

export {};
