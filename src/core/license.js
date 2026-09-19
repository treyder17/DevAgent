// src/core/license.js — simple activation gate.
//
// DevAgent is locked until activated with one of a fixed set of keys. Only the
// SHA-256 hashes of the keys live here, so the plaintext keys are not in the
// repo. Activation is stored in ~/.devagent/config.json.
//
// NOTE: this is a client-side gate on open-source code — it keeps honest users
// honest, it is not tamper-proof DRM. A real paywall needs a license server
// (see the project notes).

import { createHash } from 'crypto';

// Hashes of the 3 activation keys currently issued.
const KEY_HASHES = new Set([
  'bf78033744514a86d6054fb7366c3b86a5a74828e5d317a5955b3c8e34e1e1d4',
  '42265ef3d809d6b36d15317c6a98ca957ef92773cac3c02b14fb745d811e515f',
  '98eb2b9a80f0c34780159575cc34d43f0663eee37e8d86297d2e625999a21bf9',
]);

function hashKey(key) {
  return createHash('sha256').update(String(key || '').trim().toUpperCase()).digest('hex');
}

/** Is this key one of the valid activation keys? */
export function isValidKey(key) {
  return KEY_HASHES.has(hashKey(key));
}

/** Has DevAgent been activated (a valid key hash is stored)? */
export function isActivated(config = {}) {
  return typeof config.activationKeyHash === 'string' && KEY_HASHES.has(config.activationKeyHash);
}

/**
 * Validate a key and, if good, persist activation.
 * @returns {{ ok: boolean, error?: string }}
 */
export function activate(key, CONFIG) {
  if (!isValidKey(key)) return { ok: false, error: 'Invalid activation key.' };
  CONFIG.set('activationKeyHash', hashKey(key));
  CONFIG.set('activatedAt', new Date().toISOString());
  return { ok: true };
}

export const LOCK_MESSAGE =
  'DevAgent is locked.\n' +
  '  Activate it with an access key:  da activate <YOUR-KEY>\n' +
  '  Get a key from the DevAgent Telegram bot.';
