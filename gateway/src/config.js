'use strict';

/**
 * Konfigurasi Gateway dengan validasi fail-fast.
 *
 * Semua secret wajib berasal dari environment dan minimal 32 karakter.
 * Nilai default hanya digunakan untuk parameter non-rahasia (TTL, jam akses,
 * issuer/audience, URL internal) agar deployment tetap eksplisit.
 */

function readEnv(name, { required = false, minLength = 0, fallback } = {}) {
  const raw = process.env[name];

  if (raw === undefined || String(raw).trim() === '') {
    if (required) {
      throw new Error(`Environment variable ${name} wajib diisi`);
    }
    return fallback;
  }

  const value = String(raw).trim();
  if (minLength > 0 && value.length < minLength) {
    throw new Error(`Environment variable ${name} minimal ${minLength} karakter`);
  }
  return value;
}

function readInt(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = readEnv(name, { fallback: String(fallback) });
  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Environment variable ${name} harus bilangan bulat ${min}-${max}`);
  }
  return value;
}

/**
 * Mengubah TTL seperti 10m / 1d / 5m / 30s menjadi detik.
 * Format numerik dianggap detik.
 */
function parseDuration(value, name) {
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number.parseInt(text, 10);
    if (seconds <= 0) throw new Error(`${name} harus lebih besar dari 0`);
    return seconds;
  }

  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(text);
  if (!match) {
    throw new Error(`${name} tidak valid; gunakan contoh 30s, 10m, 1h, atau 1d`);
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  const seconds = amount * multiplier;

  if (seconds <= 0) throw new Error(`${name} harus lebih besar dari 0`);
  return seconds;
}

const accessTokenTtl = readEnv('ACCESS_TOKEN_TTL', { fallback: '10m' });
const refreshTokenTtl = readEnv('REFRESH_TOKEN_TTL', { fallback: '1d' });
const serviceTokenTtl = readEnv('SERVICE_TOKEN_TTL', { fallback: '5m' });

const config = {
  port: readInt('PORT', 3000, { min: 1, max: 65535 }),

  databaseUrl: readEnv('DATABASE_URL', { required: true }),

  jwtSecret: readEnv('JWT_SECRET', { required: true, minLength: 32 }),
  jwtIssuer: readEnv('JWT_ISSUER', { fallback: 'zero-trust-gateway' }),
  jwtAudience: readEnv('JWT_AUDIENCE', { fallback: 'zero-trust-services' }),

  accessTokenTtlSeconds: parseDuration(accessTokenTtl, 'ACCESS_TOKEN_TTL'),
  refreshTokenTtlSeconds: parseDuration(refreshTokenTtl, 'REFRESH_TOKEN_TTL'),
  serviceTokenTtlSeconds: parseDuration(serviceTokenTtl, 'SERVICE_TOKEN_TTL'),

  gatewaySecret: readEnv('GATEWAY_SECRET', { required: true, minLength: 32 }),
  serviceClientId: readEnv('SERVICE_CLIENT_ID', { fallback: 'service-nilai' }),
  serviceClientSecret: readEnv('SERVICE_CLIENT_SECRET', { required: true, minLength: 32 }),

  operationalStartHour: readInt('OPERATIONAL_START_HOUR', 7, { min: 0, max: 23 }),
  operationalEndHour: readInt('OPERATIONAL_END_HOUR', 21, { min: 0, max: 23 }),
  timezone: readEnv('TZ', { fallback: 'Asia/Jakarta' }),

  serviceNilaiUrl: readEnv('SERVICE_NILAI_URL', { fallback: 'http://service-nilai:3001' }),
  serviceTranskripUrl: readEnv('SERVICE_TRANSKRIP_URL', {
    fallback: 'http://service-transkrip:3002',
  }),

  proxyTimeoutMs: readInt('PROXY_TIMEOUT_MS', 10_000, { min: 1_000, max: 120_000 }),
};

if (config.operationalStartHour >= config.operationalEndHour) {
  throw new Error('OPERATIONAL_START_HOUR harus lebih kecil dari OPERATIONAL_END_HOUR');
}

try {
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format(new Date());
} catch {
  throw new Error(`TZ tidak valid: ${config.timezone}`);
}

module.exports = config;
