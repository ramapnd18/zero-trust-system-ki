'use strict';

const prisma = require('./lib/prisma');
const config = require('./config');
const { recordAudit } = require('./lib/audit');
const { isWithinOperationalHours } = require('./lib/time');
const { endpointOf } = require('./lib/http');

function normalizePath(path) {
  if (path.length > 1) return path.replace(/\/+$/, '');
  return path;
}

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function auditDecision(req, decision, reason) {
  return recordAudit({
    subject: req.auth?.subject || 'anonymous',
    endpoint: endpointOf(req),
    device: req.auth?.device || null,
    decision,
    reason,
  });
}

async function deny(req, res, status, error, reason) {
  await auditDecision(req, 'deny', reason);
  return res.status(status).json({ error, reason });
}

/**
 * Fail-closed: jika keputusan allow tidak dapat diaudit, request ditolak.
 */
async function allow(req, res, next, reason) {
  const audited = await auditDecision(req, 'allow', reason);

  if (!audited) {
    return res.status(503).json({
      error: 'audit_unavailable',
      reason: 'audit_write_failed',
    });
  }

  return next();
}

async function enforceNilaiList(req, res, next) {
  if (req.method !== 'GET') {
    return deny(req, res, 405, 'method_not_allowed', 'method_not_allowed');
  }
  if (req.auth.tokenUse !== 'access') {
    return deny(req, res, 403, 'forbidden', 'service_token_not_allowed');
  }
  if (!['mahasiswa', 'dosen'].includes(req.auth.role)) {
    return deny(req, res, 403, 'forbidden', 'role_not_allowed');
  }

  // Row-level scoping dilakukan service-nilai berdasarkan subjek JWT:
  // mahasiswa hanya nilainya sendiri, dosen hanya kelas yang diampu.
  return allow(req, res, next, 'nilai_list_allowed');
}

async function enforceNilaiUpdate(req, res, next, nilaiId) {
  if (req.method !== 'PUT') {
    return deny(req, res, 405, 'method_not_allowed', 'method_not_allowed');
  }
  if (req.auth.tokenUse !== 'access') {
    return deny(req, res, 403, 'forbidden', 'service_token_not_allowed');
  }
  if (req.auth.role !== 'dosen') {
    return deny(req, res, 403, 'forbidden', 'role_not_allowed');
  }
  if (!isWithinOperationalHours()) {
    return deny(req, res, 403, 'forbidden', 'outside_operational_hours');
  }

  const nilai = await prisma.nilai.findUnique({
    where: { id: nilaiId },
    select: {
      id: true,
      status: true,
      kelas: { select: { dosenId: true } },
    },
  });

  if (!nilai) {
    return deny(req, res, 404, 'not_found', 'nilai_not_found');
  }
  if (nilai.kelas.dosenId !== req.auth.userId) {
    return deny(req, res, 403, 'forbidden', 'class_not_owned');
  }
  if (nilai.status === 'final') {
    return deny(req, res, 409, 'conflict', 'nilai_final');
  }

  return allow(req, res, next, 'nilai_update_allowed');
}

async function enforceFinalisasi(req, res, next, kelasId) {
  if (req.method !== 'POST') {
    return deny(req, res, 405, 'method_not_allowed', 'method_not_allowed');
  }
  if (req.auth.tokenUse !== 'access') {
    return deny(req, res, 403, 'forbidden', 'service_token_not_allowed');
  }
  if (req.auth.role !== 'dosen') {
    return deny(req, res, 403, 'forbidden', 'role_not_allowed');
  }
  if (!isWithinOperationalHours()) {
    return deny(req, res, 403, 'forbidden', 'outside_operational_hours');
  }

  const kelas = await prisma.kelas.findUnique({
    where: { id: kelasId },
    select: { id: true, dosenId: true },
  });

  if (!kelas) {
    return deny(req, res, 404, 'not_found', 'kelas_not_found');
  }
  if (kelas.dosenId !== req.auth.userId) {
    return deny(req, res, 403, 'forbidden', 'class_not_owned');
  }

  return allow(req, res, next, 'kelas_finalization_allowed');
}

async function enforceTranskripRead(req, res, next, nim) {
  if (req.method !== 'GET') {
    return deny(req, res, 405, 'method_not_allowed', 'method_not_allowed');
  }
  if (req.auth.tokenUse !== 'access') {
    return deny(req, res, 403, 'forbidden', 'service_token_not_allowed');
  }
  if (!['mahasiswa', 'admin'].includes(req.auth.role)) {
    return deny(req, res, 403, 'forbidden', 'role_not_allowed');
  }

  if (!/^[A-Za-z0-9._-]{1,64}$/.test(nim)) {
    return deny(req, res, 400, 'bad_request', 'invalid_nim');
  }

  if (req.auth.role === 'mahasiswa') {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { username: true },
    });

    if (!user || user.username !== nim) {
      return deny(req, res, 403, 'forbidden', 'transkrip_forbidden');
    }
  }

  return allow(
    req,
    res,
    next,
    req.auth.role === 'admin' ? 'admin_transkrip_allowed' : 'own_transkrip_allowed',
  );
}

async function enforceTranskripSync(req, res, next) {
  if (req.method !== 'POST') {
    return deny(req, res, 405, 'method_not_allowed', 'method_not_allowed');
  }
  if (req.auth.tokenUse !== 'service') {
    return deny(req, res, 403, 'forbidden', 'service_token_required');
  }
  if (req.auth.role !== 'service') {
    return deny(req, res, 403, 'forbidden', 'service_role_required');
  }
  if (req.auth.clientId !== config.serviceClientId) {
    return deny(req, res, 403, 'forbidden', 'service_client_not_allowed');
  }

  return allow(req, res, next, 'transcript_sync_allowed');
}

/**
 * Policy Enforcement Point untuk seluruh resource di balik gateway.
 *
 * Gateway melakukan pemeriksaan role + ABAC sebelum request diteruskan.
 * Downstream tetap memeriksa ulang (assume breach).
 */
async function enforcePolicy(req, res, next) {
  try {
    if (!req.auth) {
      return deny(req, res, 401, 'unauthorized', 'authentication_context_missing');
    }

    const path = normalizePath(req.path);

    if (path === '/nilai') {
      return enforceNilaiList(req, res, next);
    }

    if (path.startsWith('/nilai/')) {
      const match = /^\/nilai\/(\d+)$/.exec(path);
      if (!match) {
        return deny(req, res, 404, 'not_found', 'route_not_allowed');
      }

      const nilaiId = parsePositiveId(match[1]);
      if (!nilaiId) {
        return deny(req, res, 400, 'bad_request', 'invalid_id');
      }
      return enforceNilaiUpdate(req, res, next, nilaiId);
    }

    if (path.startsWith('/kelas/')) {
      const match = /^\/kelas\/(\d+)\/finalisasi$/.exec(path);
      if (!match) {
        return deny(req, res, 404, 'not_found', 'route_not_allowed');
      }

      const kelasId = parsePositiveId(match[1]);
      if (!kelasId) {
        return deny(req, res, 400, 'bad_request', 'invalid_id');
      }
      return enforceFinalisasi(req, res, next, kelasId);
    }

    if (path === '/transkrip/sinkron') {
      return enforceTranskripSync(req, res, next);
    }

    if (path.startsWith('/transkrip/')) {
      const match = /^\/transkrip\/([^/]+)$/.exec(path);
      if (!match) {
        return deny(req, res, 404, 'not_found', 'route_not_allowed');
      }

      let nim;
      try {
        nim = decodeURIComponent(match[1]);
      } catch {
        return deny(req, res, 400, 'bad_request', 'invalid_nim');
      }
      return enforceTranskripRead(req, res, next, nim);
    }

    return deny(req, res, 404, 'not_found', 'route_not_allowed');
  } catch (error) {
    await auditDecision(req, 'deny', 'policy_internal_error');
    return next(error);
  }
}

module.exports = { enforcePolicy };
