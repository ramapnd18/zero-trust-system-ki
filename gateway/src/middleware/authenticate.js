'use strict';

const prisma = require('../lib/prisma');
const { verifyToken } = require('../lib/tokens');
const { recordAudit } = require('../lib/audit');
const { endpointOf, normalizeDevice, extractBearerToken } = require('../lib/http');

const PROTECTED_PREFIXES = ['/nilai', '/kelas', '/transkrip'];
const ALLOWED_USER_ROLES = new Set(['mahasiswa', 'dosen', 'admin']);

function isProtectedPath(path) {
  return PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

async function deny(req, res, status, error, reason, subject = 'anonymous') {
  await recordAudit({
    subject,
    endpoint: endpointOf(req),
    device: normalizeDevice(req.get('X-Device-ID')),
    decision: 'deny',
    reason,
  });

  return res.status(status).json({ error, reason });
}

/**
 * Autentikasi untuk seluruh request yang menuju resource service.
 *
 * - JWT diverifikasi signature, expiry, issuer, audience.
 * - Access token wajib disertai X-Device-ID yang terdaftar untuk user.
 * - Service token tidak memakai device context; route policy tetap membatasi
 *   service token hanya untuk endpoint sinkronisasi.
 * - Role token dicocokkan dengan role user di database (role tidak stale).
 */
async function authenticate(req, res, next) {
  try {
    const token = extractBearerToken(req);
    const device = normalizeDevice(req.get('X-Device-ID'));

    if (!token) {
      return deny(req, res, 401, 'unauthorized', 'missing_token');
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (error) {
      const reason = error.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
      return deny(req, res, 401, 'unauthorized', reason);
    }

    if (!payload || typeof payload !== 'object' || !payload.sub || !payload.role) {
      return deny(req, res, 401, 'unauthorized', 'invalid_token_claims');
    }

    if (payload.token_use === 'service') {
      if (payload.role !== 'service' || typeof payload.client_id !== 'string') {
        return deny(req, res, 401, 'unauthorized', 'invalid_service_token');
      }

      req.auth = {
        tokenUse: 'service',
        role: 'service',
        clientId: payload.client_id,
        subject: `service:${payload.client_id}`,
        device: null,
      };
      return next();
    }

    if (payload.token_use !== 'access') {
      return deny(req, res, 401, 'unauthorized', 'invalid_token_use');
    }

    if (!ALLOWED_USER_ROLES.has(payload.role)) {
      return deny(req, res, 401, 'unauthorized', 'invalid_role');
    }

    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      return deny(req, res, 401, 'unauthorized', 'invalid_subject');
    }

    const subject = `user:${userId}`;
    if (!device) {
      return deny(req, res, 401, 'unauthorized', 'device_id_required', subject);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true },
    });

    if (!user) {
      return deny(req, res, 401, 'unauthorized', 'unknown_subject', subject);
    }

    if (user.role !== payload.role) {
      return deny(req, res, 401, 'unauthorized', 'role_mismatch', subject);
    }

    const registeredDevice = await prisma.device.findFirst({
      where: { userId, device_id: device },
      select: { id: true },
    });

    if (!registeredDevice) {
      return deny(req, res, 403, 'forbidden', 'device_not_registered', subject);
    }

    req.auth = {
      tokenUse: 'access',
      role: user.role,
      userId: user.id,
      username: user.username,
      device,
      subject,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  authenticate,
  isProtectedPath,
  PROTECTED_PREFIXES,
};
