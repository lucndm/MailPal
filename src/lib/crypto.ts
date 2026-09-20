// TOTP (RFC 6238 / RFC 4226) helpers for the dashboard two-factor login.
// Ported from BYWled/MailPal (GPL-3.0), trimmed to the single-admin use case:
// no PBKDF2 user-password hashing here (AUTH_PASSWORD stays env-based).

import { renderSVG } from 'uqr';

// ─── Base32 Encoding / Decoding (RFC 4648) ───────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = '';

	for (let i = 0; i < buffer.length; i++) {
		value = (value << 8) | buffer[i];
		bits += 8;
		while (bits >= 5) {
			output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}

	if (bits > 0) {
		output += BASE32_CHARS[(value << (5 - bits)) & 31];
	}

	return output;
}

export function base32Decode(input: string): Uint8Array {
	const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];

	for (let i = 0; i < cleaned.length; i++) {
		const idx = BASE32_CHARS.indexOf(cleaned[i]);
		if (idx === -1) continue; // skip invalid characters
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}

	return new Uint8Array(bytes);
}

// ─── RFC 6238 / RFC 4226 TOTP Implementation ────────────────────────────────

export function generateTotpSecret(length = 20): string {
	const buffer = crypto.getRandomValues(new Uint8Array(length));
	return base32Encode(buffer);
}

export async function generateTotp(secretBase32: string, counter: number): Promise<string> {
	const keyData = base32Decode(secretBase32);
	const key = await crypto.subtle.importKey(
		'raw',
		keyData as unknown as BufferSource,
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign']
	);

	// Counter as 8-byte big-endian buffer
	const counterBuffer = new Uint8Array(8);
	let temp = counter;
	for (let i = 7; i >= 0; i--) {
		counterBuffer[i] = temp & 0xff;
		temp = Math.floor(temp / 256);
	}

	const signature = await crypto.subtle.sign('HMAC', key, counterBuffer as unknown as BufferSource);
	const sigBytes = new Uint8Array(signature);

	// Dynamic truncation according to RFC 4226
	const offset = sigBytes[sigBytes.length - 1] & 0x0f;
	const code =
		((sigBytes[offset] & 0x7f) << 24) |
		((sigBytes[offset + 1] & 0xff) << 16) |
		((sigBytes[offset + 2] & 0xff) << 8) |
		(sigBytes[offset + 3] & 0xff);

	const otp = (code % 1_000_000).toString().padStart(6, '0');
	return otp;
}

/** Normalizes full-width digits (０-９) and strips non-digits. */
export function normalizeTotpCode(token: string): string {
	return token
		.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
		.replace(/\D/g, '');
}

export async function verifyTotp(
	token: string,
	secretBase32: string,
	window = 1
): Promise<boolean> {
	if (!token) return false;
	const cleaned = normalizeTotpCode(token);
	if (cleaned.length !== 6) return false;
	const currentStep = Math.floor(Date.now() / 1000 / 30);

	for (let i = -window; i <= window; i++) {
		const expected = await generateTotp(secretBase32, currentStep + i);
		if (expected === cleaned) {
			return true;
		}
	}
	return false;
}

export function generateTotpUri(username: string, secretBase32: string, issuer = 'MailPal'): string {
	return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateQrCodeSvg(text: string, size = 220): string {
	const svg = renderSVG(text, {
		ecc: 'M',
		border: 3,
		whiteColor: '#ffffff',
		blackColor: '#0f172a'
	});
	return svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
}
