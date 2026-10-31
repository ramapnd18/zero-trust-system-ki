'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const config = require('../config');
const prisma = require('../lib/prisma');
const { normalizeDevice, extractBearerToken } = require('../lib/http');

const ALGORITHM = 'HS256';
const ALLOWED_USER_ROLES = new Set(['mahasiswa', 'dosen', 'admin']);

function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Double verification di service-transkrip:
 *  1. X-Gateway-Secret constant-time.
 *  2. Verifikasi ulang JWT (signature, expiry, issuer, audience).
 *  3. Device context diverifikasi ulang untuk access token.
 */
async function verifyGatewayRequest(req, res, next) {
  try {
    const gatewaySecret = req.get('X-Gateway-Secret');
    if (!gatewaySecret || !safeEqual(gatewaySecret, config.gatewaySecret)) {
      return res.status(403).json({ error: 'forbidden', reason: 'invalid_gateway_secret' });
    }

    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', reason: 'missing_token' });
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, {
        algorithms: [ALGORITHM],
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        clockTolerance: 5,
      });
    } catch (error) {
      const reason = error.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
      return res.status(401).json({ error: 'unauthorized', reason });
    }

    if (!payload || typeof payload !== 'object' || !payload.sub || !payload.role) {
      return res.status(401).json({ error: 'unauthorized', reason: 'invalid_token_claims' });
    }

    if (payload.token_use === 'service') {
      if (payload.role !== 'service' || typeof payload.client_id !== 'string') {
        return res.status(401).json({ error: 'unauthorized', reason: 'invalid_service_token' });
      }

      req.auth = {
        tokenUse: 'service',
        role: 'service',
        clientId: payload.client_id,
        subject: `service:${payload.client_id}`,
      };
      return next();
    }

    if (payload.token_use !== 'access') {
      return res.status(401).json({ error: 'unauthorized', reason: 'invalid_token_use' });
    }

    if (!ALLOWED_USER_ROLES.has(payload.role)) {
      return res.status(401).json({ error: 'unauthorized', reason: 'invalid_role' });
    }

    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'unauthorized', reason: 'invalid_subject' });
    }

    const device = normalizeDevice(req.get('X-Device-ID'));
    if (!device) {
      return res.status(401).json({ error: 'unauthorized', reason: 'device_id_required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'unauthorized', reason: 'unknown_subject' });
    }
    if (user.role !== payload.role) {
      return res.status(401).json({ error: 'unauthorized', reason: 'role_mismatch' });
    }

    const registeredDevice = await prisma.device.findFirst({
      where: { userId, device_id: device },
      select: { id: true },
    });

    if (!registeredDevice) {
      return res.status(403).json({ error: 'forbidden', reason: 'device_not_registered' });
    }

    req.auth = {
      tokenUse: 'access',
      role: user.role,
      userId: user.id,
      username: user.username,
      device,
      subject: `user:${user.id}`,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAccess(...allowedRoles) {
  return function accessGuard(req, res, next) {
    if (req.auth?.tokenUse !== 'access') {
      return res.status(403).json({ error: 'forbidden', reason: 'access_token_required' });
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'forbidden', reason: 'role_not_allowed' });
    }
    return next();
  };
}

function requireService(expectedClientId) {
  return function serviceGuard(req, res, next) {
    if (req.auth?.tokenUse !== 'service' || req.auth.role !== 'service') {
      return res.status(403).json({ error: 'forbidden', reason: 'service_token_required' });
    }
    if (expectedClientId && req.auth.clientId !== expectedClientId) {
      return res.status(403).json({ error: 'forbidden', reason: 'service_client_not_allowed' });
    }
    return next();
  };
}

module.exports = {
  verifyGatewayRequest,
  requireAccess,
  requireService,
};
