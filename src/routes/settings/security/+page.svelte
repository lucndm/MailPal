<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import CopyButton from '$lib/components/CopyButton.svelte';

	let { data }: { data: { enabled: boolean } } = $props();

	let password = $state('');
	let setup: { secret: string; uri: string; qrSvg: string } | null = $state(null);
	let code = $state('');
	let message = $state<{ kind: 'success' | 'error'; text: string } | null>(null);
	let busy = $state(false);

	async function call(method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>) {
		busy = true;
		message = null;
		try {
			const res = await fetch('/api/security/totp', {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				message = { kind: 'error', text: payload.error ?? `HTTP ${res.status}` };
				return null;
			}
			return payload;
		} finally {
			busy = false;
		}
	}

	async function startSetup(e: Event) {
		e.preventDefault();
		const result = await call('POST', { password });
		if (result) {
			setup = result;
			code = '';
		}
	}

	async function confirmSetup(e: Event) {
		e.preventDefault();
		const result = await call('PUT', { code });
		if (result) {
			setup = null;
			password = '';
			code = '';
			message = { kind: 'success', text: 'Two-factor authentication enabled.' };
			await invalidateAll();
		}
	}

	async function disable(e: Event) {
		e.preventDefault();
		const result = await call('DELETE', { code });
		if (result) {
			code = '';
			message = { kind: 'success', text: 'Two-factor authentication disabled.' };
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>Security — MailPal</title>
</svelte:head>

<div class="max-w-xl mx-auto space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-bold text-app-text">Security</h1>
		<a href="/" class="text-sm text-app-accent hover:underline">← Back to dashboard</a>
	</div>

	<div class="bg-app-surface border border-app-border rounded-2xl p-6 space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="font-semibold text-app-text">Two-factor authentication</h2>
				<p class="text-sm text-app-muted">
					Require a 6-digit TOTP code from an authenticator app after the dashboard password.
				</p>
			</div>
			<span
				class="text-xs font-semibold px-2.5 py-1 rounded-full {data.enabled
					? 'bg-green-500/15 text-green-400'
					: 'bg-app-hover text-app-muted'}"
			>
				{data.enabled ? 'Enabled' : 'Disabled'}
			</span>
		</div>

		{#if message}
			<p
				class="text-sm rounded-lg px-3 py-2 {message.kind === 'error'
					? 'text-red-400 bg-red-400/10'
					: 'text-green-400 bg-green-400/10'}"
			>
				{message.text}
			</p>
		{/if}

		{#if !data.enabled}
			{#if !setup}
				<form onsubmit={startSetup} class="flex gap-2 items-end">
					<label class="flex-1 block">
						<span class="block text-sm font-medium text-app-text mb-1.5">
							Dashboard password (to authorize)
						</span>
						<input
							type="password"
							bind:value={password}
							required
							autocomplete="current-password"
							class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text"
						/>
					</label>
					<button
						type="submit"
						disabled={busy}
						class="py-2 px-4 bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold rounded-lg"
					>
						Start setup
					</button>
				</form>
			{:else}
				<div class="space-y-3">
					<p class="text-sm text-app-text">
						Scan this QR code with your authenticator app (Aegis, 1Password, Google
						Authenticator, …), then confirm with a code.
					</p>
					<div class="flex flex-col sm:flex-row gap-4 items-start">
						<div class="p-2 bg-white rounded-lg shrink-0">
							<!-- eslint-disable-next-line svelte/no-at-html-tags — server-generated SVG from uqr -->
							{@html setup.qrSvg}
						</div>
						<div class="space-y-2 text-sm w-full">
							<div class="flex items-center gap-2">
								<code class="text-xs break-all text-app-muted">{setup.secret}</code>
								<CopyButton text={setup.secret} />
							</div>
							<form onsubmit={confirmSetup} class="flex gap-2 items-end">
								<label class="flex-1 block">
									<span class="block text-sm font-medium text-app-text mb-1.5">
										6-digit code
									</span>
									<input
										type="text"
										bind:value={code}
										inputmode="numeric"
										pattern="[0-9]*"
										maxlength="6"
										required
										autocomplete="one-time-code"
										class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text tracking-[0.3em]"
									/>
								</label>
								<button
									type="submit"
									disabled={busy}
									class="py-2 px-4 bg-app-accent hover:brightness-110 text-app-bg text-sm font-semibold rounded-lg"
								>
									Enable
								</button>
							</form>
						</div>
					</div>
				</div>
			{/if}
		{:else}
			<form onsubmit={disable} class="flex gap-2 items-end">
				<label class="flex-1 block">
					<span class="block text-sm font-medium text-app-text mb-1.5">
						Current 6-digit code (to disable)
					</span>
					<input
						type="text"
						bind:value={code}
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength="6"
						required
						autocomplete="one-time-code"
						class="w-full px-3 py-2 rounded-lg border border-app-border bg-app-hover text-sm text-app-text tracking-[0.3em]"
					/>
				</label>
				<button
					type="submit"
					disabled={busy}
					class="py-2 px-4 bg-red-500/90 hover:brightness-110 text-white text-sm font-semibold rounded-lg"
				>
					Disable
				</button>
			</form>
		{/if}
	</div>
</div>
