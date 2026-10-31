'use strict';

function readEnv(name, { required = false, minLength = 0, fallback } = {}) {
  const raw = process.env[name];

  if (raw === undefined || String(raw).trim() === '') {
    if (required) throw new Error(`Environment variable ${name} wajib diisi`);
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

const config = {
  port: readInt('PORT', 3002, { min: 1, max: 65535 }),
  databaseUrl: readEnv('DATABASE_URL', { required: true }),

  jwtSecret: readEnv('JWT_SECRET', { required: true, minLength: 32 }),
  jwtIssuer: readEnv('JWT_ISSUER', { fallback: 'zero-trust-gateway' }),
  jwtAudience: readEnv('JWT_AUDIENCE', { fallback: 'zero-trust-services' }),

  gatewaySecret: readEnv('GATEWAY_SECRET', { required: true, minLength: 32 }),

  // Hanya ID client (non-rahasia). Service-transkrip TIDAK menerima
  // SERVICE_CLIENT_SECRET (least privilege).
  allowedServiceClientId: readEnv('SERVICE_CLIENT_ID', { fallback: 'service-nilai' }),
};

module.exports = config;
