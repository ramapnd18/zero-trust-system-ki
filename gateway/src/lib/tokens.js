'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const ALGORITHM = 'HS256';

/**
 * Access token pengguna (10 menit).
 * `sub` selalu string sesuai spesifikasi JWT, berisi User.id.
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      role: user.role,
      token_use: 'access',
    },
    config.jwtSecret,
    {
      algorithm: ALGORITHM,
      subject: String(user.id),
      expiresIn: config.accessTokenTtlSeconds,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    },
  );
}

/**
 * Service token untuk service-to-service (5 menit).
 * Hanya client yang kredensialnya cocok yang dapat memperoleh token ini.
 */
function signServiceToken(clientId) {
  return jwt.sign(
    {
      role: 'service',
      token_use: 'service',
      client_id: clientId,
    },
    config.jwtSecret,
    {
      algorithm: ALGORITHM,
      subject: clientId,
      expiresIn: config.serviceTokenTtlSeconds,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    },
  );
}

/**
 * Verifikasi signature, expiry, issuer, dan audience.
 * Downstream service melakukan verifikasi yang sama secara independen.
 */
function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: [ALGORITHM],
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    clockTolerance: 5,
  });
}

function generateRefreshToken() {
  // 384 bit entropi; token mentah hanya dikirim ke client, DB menyimpan hash.
  return crypto.randomBytes(48).toString('hex');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function refreshTokenExpiry() {
  return new Date(Date.now() + config.refreshTokenTtlSeconds * 1000);
}

/**
 * Perbandingan constant-time untuk secret.
 */
function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  signAccessToken,
  signServiceToken,
  verifyToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  safeEqual,
};
