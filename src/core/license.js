// src/core/license.js — activation gate with device binding + activation report.
//
// - Only the SHA-256 hashes of the valid keys live here (not the plaintext).
// - A key activates for ONE device: activation stores a device fingerprint, and
//   a copied config on another machine won't unlock (same key, other device).
// - On activation the client can report to a central endpoint so the owner can
//   see who activated (config.licenseReportUrl; off when unset).
//
// This is a client-side gate on open-source code — it deters sharing, it is not
// tamper-proof DRM. Real enforcement needs a license server.

import { createHash } from 'crypto';
import { hostname, platform, arch, userInfo } from 'os';

// Hashes of the activation keys currently issued.
const KEY_HASHES = new Set([
  'bf78033744514a86d6054fb7366c3b86a5a74828e5d317a5955b3c8e34e1e1d4',
  '42265ef3d809d6b36d15317c6a98ca957ef92773cac3c02b14fb745d811e515f',
  '98eb2b9a80f0c34780159575cc34d43f0663eee37e8d86297d2e625999a21bf9',
]);

function sha(s) { return createHash('sha256').update(String(s)).digest('hex'); }
function hashKey(key) { return sha(String(key || '').trim().toUpperCase()); }

/** Stable-ish fingerprint of this machine (survives MAC/IP changes). */
export function deviceId() {
  let user = '';
  try { user = userInfo().username || ''; } catch { /* sandboxed */ }
  return sha([hostname(), platform(), arch(), user].join('|')).slice(0, 24);
}

/** Short label for which key was used (first 8 hex of its hash). */
export function keyId(config = {}) {
  return typeof config.activationKeyHash === 'string' ? config.activationKeyHash.slice(0, 8) : '';
}

export function isValidKey(key) {
  return KEY_HASHES.has(hashKey(key));
}

/**
 * Activated only when a valid key hash is stored AND it is bound to THIS device
 * (or no device was recorded yet, for configs from before binding existed).
 */
export function isActivated(config = {}) {
  if (!(typeof config.activationKeyHash === 'string' && KEY_HASHES.has(config.activationKeyHash))) return false;
  if (config.activationDeviceId && config.activationDeviceId !== deviceId()) return false;
  return true;
}

/** Why activation is refused, for a clearer message. */
export function lockReason(config = {}) {
  if (config.activationKeyHash && KEY_HASHES.has(config.activationKeyHash)
      && config.activationDeviceId && config.activationDeviceId !== deviceId()) {
    return 'device-mismatch';
  }
  return 'not-activated';
}

/**
 * Validate a key and, if good, bind it to this device and persist.
 * @returns {{ ok: boolean, error?: string }}
 */
export function activate(key, CONFIG) {
  if (!isValidKey(key)) return { ok: false, error: 'Invalid activation key.' };
  CONFIG.set('activationKeyHash', hashKey(key));
  CONFIG.set('activationDeviceId', deviceId());
  CONFIG.set('activatedAt', new Date().toISOString());
  return { ok: true };
}

/** Fire-and-forget report so the owner can see who activated. No-op if unset. */
export async function reportActivation(config = {}, extra = {}) {
  const url = config.licenseReportUrl;
  if (!url) return { ok: false, skipped: true };
  const payload = {
    event: 'activate',
    device: deviceId(),
    key: keyId(config),
    host: safeHost(),
    platform: platform(),
    arch: arch(),
    at: new Date().toISOString(),
    ...extra,
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function safeHost() {
  try { return hostname(); } catch { return 'unknown'; }
}

export const LOCK_MESSAGES = {
  'not-activated':
    'DevAgent is locked.\n' +
    '  Activate it with an access key:  da activate <YOUR-KEY>\n' +
    '  Get a key from the DevAgent Telegram bot.',
  'device-mismatch':
    'This access key is already bound to another device.\n' +
    '  Each key works on one machine only. Get your own key from the DevAgent Telegram bot.',
};

// Back-compat: a single default message.
export const LOCK_MESSAGE = LOCK_MESSAGES['not-activated'];
