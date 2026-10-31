'use strict';

/**
 * Mengambil method + path tanpa query string untuk audit log.
 * Query tidak disimpan agar data sensitif tidak masuk audit.
 */
function endpointOf(req) {
  return `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}`;
}

/**
 * X-Device-ID: string wajar, maksimal 128 karakter, tanpa karakter kontrol.
 */
function normalizeDevice(value) {
  if (typeof value !== 'string') return null;
  const device = value.trim();

  if (!device || device.length > 128) return null;
  if (/[\u0000-\u001f\u007f]/.test(device)) return null;

  return device;
}

function extractBearerToken(req) {
  const header = req.get('Authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token || null;
}

module.exports = {
  endpointOf,
  normalizeDevice,
  extractBearerToken,
};
