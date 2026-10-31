'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const asyncHandler = require('../lib/async-handler');
const { requireAccess } = require('../middleware/verify-gateway');
const requireOperationalHours = require('../middleware/operational-hours');

const router = express.Router();

function serializeNilai(nilai) {
  return {
    id: nilai.id,
    skor: nilai.skor,
    status: nilai.status,
    kelas: {
      id: nilai.kelas.id,
      nama_mata_kuliah: nilai.kelas.nama_mata_kuliah,
    },
    mahasiswa: {
      id: nilai.mahasiswa.id,
      nim: nilai.mahasiswa.username,
    },
  };
}

const NILAI_INCLUDE = {
  kelas: { select: { id: true, nama_mata_kuliah: true } },
  mahasiswa: { select: { id: true, username: true } },
};

/**
 * GET /nilai
 *
 * Mahasiswa hanya menerima nilainya sendiri; dosen hanya menerima nilai pada
 * kelas yang diampu. Scoping dilakukan dari subjek JWT, bukan input client.
 */
router.get('/', requireAccess('mahasiswa', 'dosen'), asyncHandler(async (req, res) => {
  const where = req.auth.role === 'mahasiswa'
    ? { mahasiswaId: req.auth.userId }
    : { kelas: { is: { dosenId: req.auth.userId } } };

  const values = await prisma.nilai.findMany({
    where,
    include: NILAI_INCLUDE,
    orderBy: { id: 'asc' },
  });

  return res.status(200).json({ data: values.map(serializeNilai) });
}));

/**
 * PUT /nilai/:id
 *
 * Hanya dosen pengampu, hanya nilai draft, dan hanya dalam jam operasional.
 * Pemeriksaan diulang di service (bukan hanya di gateway).
 */
router.put(
  '/:id',
  requireAccess('dosen'),
  requireOperationalHours,
  asyncHandler(async (req, res) => {
    const nilaiId = Number(req.params.id);
    if (!Number.isInteger(nilaiId) || nilaiId <= 0) {
      return res.status(400).json({ error: 'bad_request', reason: 'invalid_id' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const skor = body.skor;

    if (typeof skor !== 'number' || !Number.isFinite(skor) || skor < 0 || skor > 100) {
      return res.status(400).json({ error: 'bad_request', reason: 'invalid_skor' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const nilai = await tx.nilai.findUnique({
        where: { id: nilaiId },
        include: {
          ...NILAI_INCLUDE,
          kelas: { select: { id: true, nama_mata_kuliah: true, dosenId: true } },
        },
      });

      if (!nilai) return { kind: 'not_found' };
      if (nilai.kelas.dosenId !== req.auth.userId) return { kind: 'forbidden' };
      if (nilai.status === 'final') return { kind: 'conflict' };

      const updated = await tx.nilai.update({
        where: { id: nilaiId },
        data: { skor },
        include: NILAI_INCLUDE,
      });

      return { kind: 'ok', nilai: updated };
    });

    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'not_found', reason: 'nilai_not_found' });
    }
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'forbidden', reason: 'class_not_owned' });
    }
    if (result.kind === 'conflict') {
      return res.status(409).json({ error: 'conflict', reason: 'nilai_final' });
    }

    return res.status(200).json({ data: serializeNilai(result.nilai) });
  }),
);

module.exports = router;
