/**
 * apiKeyCrypto.ts — AES-256-GCM helpers for encrypting API keys at rest.
 * SERVER-SIDE ONLY. Never import this in client components.
 *
 * Requires env var: ENCRYPTION_KEY (exactly 64 hex chars = 32 bytes)
 * Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN  = 12; // 96-bit IV recommended for GCM
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts plaintext and returns a base64 string:
 *   iv (12 bytes) + authTag (16 bytes) + ciphertext
 */
export function encryptApiKey(plaintext: string): string {
  const key = getKey();
  const iv  = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);

  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypts a value produced by encryptApiKey.
 */
export function decryptApiKey(encrypted: string): string {
  const key = getKey();
  const buf = Buffer.from(encrypted, 'base64');

  const iv  = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
