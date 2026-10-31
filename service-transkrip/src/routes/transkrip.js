'use strict';

const express = require('express');

const config = require('../config');
const prisma = require('../lib/prisma');
const asyncHandler = require('../lib/async-handler');
const { requireAccess, requireService } = require('../middleware/verify-gateway');

const router = express.Router();

const NIM_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_SYNC_ITEMS = 1_000;
const MAX_GRADES_PER_STUDENT = 500;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidGrade(grade) {
  return isPlainObject(grade)
    && Number.isInteger(grade.kelas_id)
    && grade.kelas_id > 0
    && typeof grade.nama_mata_kuliah === 'string'
    && grade.nama_mata_kuliah.trim().length > 0
    && grade.nama_mata_kuliah.length <= 200
    && typeof grade.skor === 'number'
    && Number.isFinite(grade.skor)
    && grade.skor >= 0
    && grade.skor <= 100
    && grade.status === 'final';
}

function validateSyncBody(body) {
  if (!isPlainObject(body)) return { error: 'invalid_request' };

  if (!Number.isInteger(body.kelas_id) || body.kelas_id <= 0) {
    return { error: 'invalid_kelas_id' };
  }
  if (body.source !== undefined && (typeof body.source !== 'string' || body.source.length > 64)) {
    return { error: 'invalid_source' };
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_SYNC_ITEMS) {
    return { error: 'invalid_items' };
  }

  const seenNims = new Set();
  const items = [];

  for (const item of body.items) {
    if (!isPlainObject(item)) return { error: 'invalid_item' };
    if (typeof item.nim !== 'string' || !NIM_PATTERN.test(item.nim)) {
      return { error: 'invalid_nim' };
    }
    if (seenNims.has(item.nim)) return { error: 'duplicate_nim' };
    seenNims.add(item.nim);

    if (
      !Array.isArray(item.data_nilai)
      || item.data_nilai.length < 1
      || item.data_nilai.length > MAX_GRADES_PER_STUDENT
      || !item.data_nilai.every(isValidGrade)
    ) {
      return { error: 'invalid_data_nilai' };
    }

    items.push({ nim: item.nim, data_nilai: item.data_nilai });
  }

  return { items, kelasId: body.kelas_id };
}

/**
 * POST /transkrip/sinkron
 *
 * HANYA service token dari service-nilai yang boleh memanggil endpoint ini.
 * Access token user (termasuk admin) ditolak.
 */
router.post(
  '/sinkron',
  requireService(config.allowedServiceClientId),
  asyncHandler(async (req, res) => {
    const parsed = validateSyncBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: 'bad_request', reason: parsed.error });
    }

    const nims = parsed.items.map((item) => item.nim);
    const users = await prisma.user.findMany({
      where: { username: { in: nims }, role: 'mahasiswa' },
      select: { id: true, username: true },
    });

    if (users.length !== nims.length) {
      return res.status(400).json({ error: 'bad_request', reason: 'unknown_nim' });
    }

    const byUsername = new Map(users.map((user) => [user.username, user]));

    const operations = parsed.items.map((item) => {
      const mahasiswa = byUsername.get(item.nim);
      const dataNilai = JSON.stringify(item.data_nilai);

      return prisma.transkrip.upsert({
        where: { mahasiswaId: mahasiswa.id },
        update: { data_nilai: dataNilai },
        create: {
          mahasiswaId: mahasiswa.id,
          data_nilai: dataNilai,
        },
      });
    });

    await prisma.$transaction(operations);

    return res.status(200).json({
      synced: parsed.items.length,
      nims,
    });
  }),
);

/**
 * GET /transkrip/:nim
 *
 * Mahasiswa hanya boleh membaca transkrip miliknya sendiri; admin boleh
 * membaca semua; dosen tidak memiliki akses transkrip.
 */
router.get(
  '/:nim',
  requireAccess('mahasiswa', 'admin'),
  asyncHandler(async (req, res) => {
    const nim = req.params.nim;

    if (!NIM_PATTERN.test(nim)) {
      return res.status(400).json({ error: 'bad_request', reason: 'invalid_nim' });
    }

    if (req.auth.role === 'mahasiswa' && req.auth.username !== nim) {
      return res.status(403).json({ error: 'forbidden', reason: 'transkrip_forbidden' });
    }

    const mahasiswa = await prisma.user.findUnique({
      where: { username: nim },
      select: { id: true, username: true, role: true },
    });

    if (!mahasiswa || mahasiswa.role !== 'mahasiswa') {
      return res.status(404).json({ error: 'not_found', reason: 'mahasiswa_not_found' });
    }

    const transkrip = await prisma.transkrip.findUnique({
      where: { mahasiswaId: mahasiswa.id },
      select: { data_nilai: true },
    });

    if (!transkrip) {
      return res.status(404).json({ error: 'not_found', reason: 'transkrip_not_found' });
    }

    let dataNilai;
    try {
      dataNilai = JSON.parse(transkrip.data_nilai || '[]');
    } catch {
      return res.status(500).json({ error: 'internal_error', reason: 'invalid_transcript_data' });
    }

    if (!Array.isArray(dataNilai)) {
      return res.status(500).json({ error: 'internal_error', reason: 'invalid_transcript_data' });
    }

    return res.status(200).json({
      nim: mahasiswa.username,
      data_nilai: dataNilai,
    });
  }),
);

module.exports = router;
