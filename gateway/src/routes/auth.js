'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const config = require('../config');
const prisma = require('../lib/prisma');
const asyncHandler = require('../lib/async-handler');
const { recordAudit } = require('../lib/audit');
const {
  signAccessToken,
  signServiceToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  safeEqual,
} = require('../lib/tokens');
const { endpointOf, normalizeDevice } = require('../lib/http');

const router = express.Router();

// Dipakai saat username tidak ditemukan agar waktu respons tidak membocorkan
// apakah username valid atau tidak.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing-only', 10);

const USER_SELECT = {
  id: true,
  username: true,
  role: true,
};

function auditAuth(req, { subject = 'anonymous', decision, reason, device }) {
  return recordAudit({
    subject,
    endpoint: endpointOf(req),
    device: device ?? normalizeDevice(req.get('X-Device-ID')),
    decision,
    reason,
  });
}

function tokenResponse({ user, accessToken, refreshToken }) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    refresh_expires_in: config.refreshTokenTtlSeconds,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  };
}

/**
 * POST /auth/login
 *
 * Login membutuhkan username + password + X-Device-ID yang sudah terdaftar
 * untuk user tersebut. Access token 10 menit; refresh token stateful 1 hari.
 */
router.post('/login', asyncHandler(async (req, res) => {
  const device = normalizeDevice(req.get('X-Device-ID'));
  if (!device) {
    await auditAuth(req, { decision: 'deny', reason: 'device_id_required' });
    return res.status(401).json({ error: 'unauthorized', reason: 'device_id_required' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || username.length > 64 || !password || password.length > 200) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_request', device });
    return res.status(400).json({ error: 'bad_request', reason: 'invalid_request' });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const passwordMatches = await bcrypt.compare(
    password,
    user ? user.password_hash : DUMMY_PASSWORD_HASH,
  );

  // Pesan sama untuk username tidak ada dan password salah.
  if (!user || !passwordMatches) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_credentials', device });
    return res.status(401).json({ error: 'unauthorized', reason: 'invalid_credentials' });
  }

  const registeredDevice = await prisma.device.findFirst({
    where: { userId: user.id, device_id: device },
    select: { id: true },
  });

  if (!registeredDevice) {
    await auditAuth(req, {
      subject: `user:${user.id}`,
      decision: 'deny',
      reason: 'device_not_registered',
      device,
    });
    return res.status(403).json({ error: 'forbidden', reason: 'device_not_registered' });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  const refreshHash = hashRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      token: refreshHash,
      expires_at: refreshTokenExpiry(),
      userId: user.id,
    },
  });

  const audited = await auditAuth(req, {
    subject: `user:${user.id}`,
    decision: 'allow',
    reason: 'login_success',
    device,
  });

  if (!audited) {
    // Fail-closed: jangan berikan token jika keputusan tidak tercatat.
    await prisma.refreshToken.deleteMany({ where: { token: refreshHash } });
    return res.status(503).json({ error: 'audit_unavailable', reason: 'audit_write_failed' });
  }

  res.set('Cache-Control', 'no-store');
  return res.status(200).json(
    tokenResponse({
      user,
      accessToken,
      refreshToken,
    }),
  );
}));

/**
 * POST /auth/refresh
 *
 * Refresh token bersifat stateful dan dirotasi setiap pemakaian.
 * Token lama langsung dicabut sehingga replay token lama gagal.
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const device = normalizeDevice(req.get('X-Device-ID'));
  if (!device) {
    await auditAuth(req, { decision: 'deny', reason: 'device_id_required' });
    return res.status(401).json({ error: 'unauthorized', reason: 'device_id_required' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';

  if (!rawToken || rawToken.length > 512) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_request', device });
    return res.status(400).json({ error: 'bad_request', reason: 'invalid_request' });
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: hashRefreshToken(rawToken) },
    select: {
      id: true,
      token: true,
      expires_at: true,
      userId: true,
      user: { select: USER_SELECT },
    },
  });

  if (!stored) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_refresh_token', device });
    return res.status(401).json({ error: 'unauthorized', reason: 'invalid_refresh_token' });
  }

  const subject = `user:${stored.userId}`;

  if (stored.expires_at.getTime() <= Date.now()) {
    await prisma.refreshToken.deleteMany({ where: { id: stored.id } });
    await auditAuth(req, {
      subject,
      decision: 'deny',
      reason: 'refresh_token_expired',
      device,
    });
    return res.status(401).json({ error: 'unauthorized', reason: 'refresh_token_expired' });
  }

  const registeredDevice = await prisma.device.findFirst({
    where: { userId: stored.userId, device_id: device },
    select: { id: true },
  });

  if (!registeredDevice) {
    await auditAuth(req, {
      subject,
      decision: 'deny',
      reason: 'device_not_registered',
      device,
    });
    return res.status(403).json({ error: 'forbidden', reason: 'device_not_registered' });
  }

  const newRefreshToken = generateRefreshToken();
  const newRefreshHash = hashRefreshToken(newRefreshToken);

  const rotated = await prisma.$transaction(async (tx) => {
    const deleted = await tx.refreshToken.deleteMany({ where: { id: stored.id } });
    if (deleted.count !== 1) return false;

    await tx.refreshToken.create({
      data: {
        token: newRefreshHash,
        expires_at: refreshTokenExpiry(),
        userId: stored.userId,
      },
    });
    return true;
  });

  if (!rotated) {
    await auditAuth(req, {
      subject,
      decision: 'deny',
      reason: 'invalid_refresh_token',
      device,
    });
    return res.status(401).json({ error: 'unauthorized', reason: 'invalid_refresh_token' });
  }

  const accessToken = signAccessToken(stored.user);
  const audited = await auditAuth(req, {
    subject,
    decision: 'allow',
    reason: 'refresh_success',
    device,
  });

  if (!audited) {
    await prisma.refreshToken.deleteMany({ where: { token: newRefreshHash } });
    return res.status(503).json({ error: 'audit_unavailable', reason: 'audit_write_failed' });
  }

  res.set('Cache-Control', 'no-store');
  return res.status(200).json(
    tokenResponse({
      user: stored.user,
      accessToken,
      refreshToken: newRefreshToken,
    }),
  );
}));

/**
 * POST /auth/logout
 *
 * Mencabut refresh token yang diberikan. Access token yang sudah terbit tetap
 * valid sampai expiry (10 menit) sesuai desain stateless access token.
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const device = normalizeDevice(req.get('X-Device-ID'));
  if (!device) {
    await auditAuth(req, { decision: 'deny', reason: 'device_id_required' });
    return res.status(401).json({ error: 'unauthorized', reason: 'device_id_required' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';

  if (!rawToken || rawToken.length > 512) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_request', device });
    return res.status(400).json({ error: 'bad_request', reason: 'invalid_request' });
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: hashRefreshToken(rawToken) },
    select: { id: true, userId: true },
  });

  if (!stored) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_refresh_token', device });
    return res.status(401).json({ error: 'unauthorized', reason: 'invalid_refresh_token' });
  }

  const subject = `user:${stored.userId}`;
  const registeredDevice = await prisma.device.findFirst({
    where: { userId: stored.userId, device_id: device },
    select: { id: true },
  });

  if (!registeredDevice) {
    await auditAuth(req, {
      subject,
      decision: 'deny',
      reason: 'device_not_registered',
      device,
    });
    return res.status(403).json({ error: 'forbidden', reason: 'device_not_registered' });
  }

  await prisma.refreshToken.deleteMany({ where: { id: stored.id } });

  const audited = await auditAuth(req, {
    subject,
    decision: 'allow',
    reason: 'logout_success',
    device,
  });

  if (!audited) {
    return res.status(503).json({ error: 'audit_unavailable', reason: 'audit_write_failed' });
  }

  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ message: 'logged_out' });
}));

/**
 * POST /auth/service
 *
 * Hanya service-nilai yang memegang client secret. Service-transkrip tidak
 * menerima secret ini (least privilege). Service token berlaku 5 menit dan
 * hanya boleh dipakai untuk POST /transkrip/sinkron.
 */
router.post('/service', asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
  const clientSecret = typeof body.client_secret === 'string' ? body.client_secret : '';

  if (!clientId || clientId.length > 128 || !clientSecret || clientSecret.length > 256) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_request' });
    return res.status(400).json({ error: 'bad_request', reason: 'invalid_request' });
  }

  // Bandingkan keduanya tanpa short-circuit untuk menjaga sifat constant-time.
  const clientIdMatches = safeEqual(clientId, config.serviceClientId);
  const secretMatches = safeEqual(clientSecret, config.serviceClientSecret);

  if (!clientIdMatches || !secretMatches) {
    await auditAuth(req, { decision: 'deny', reason: 'invalid_client' });
    return res.status(401).json({ error: 'unauthorized', reason: 'invalid_client' });
  }

  const serviceToken = signServiceToken(config.serviceClientId);
  const subject = `service:${config.serviceClientId}`;
  const audited = await auditAuth(req, {
    subject,
    decision: 'allow',
    reason: 'service_token_issued',
    device: null,
  });

  if (!audited) {
    return res.status(503).json({ error: 'audit_unavailable', reason: 'audit_write_failed' });
  }

  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    access_token: serviceToken,
    token_type: 'Bearer',
    expires_in: config.serviceTokenTtlSeconds,
    role: 'service',
  });
}));

module.exports = router;
