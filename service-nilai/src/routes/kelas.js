'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const asyncHandler = require('../lib/async-handler');
const { requireAccess } = require('../middleware/verify-gateway');
const requireOperationalHours = require('../middleware/operational-hours');
const { syncTranscript } = require('../lib/gateway-client');

const router = express.Router();

/**
 * POST /kelas/:id/finalisasi
 *
 * Dosen pengampu memfinalisasi seluruh nilai di kelas. Setelah commit,
 * service-nilai meminta service token ke gateway lalu memanggil
 * POST /transkrip/sinkron melalui gateway (tidak pernah langsung ke 3002).
 *
 * Operasi ini idempotent: bila sinkronisasi gagal, dosen dapat mengulang
 * finalisasi dan service akan mengirim ulang data transkrip.
 */
router.post(
  '/:id/finalisasi',
  requireAccess('dosen'),
  requireOperationalHours,
  asyncHandler(async (req, res) => {
    const kelasId = Number(req.params.id);
    if (!Number.isInteger(kelasId) || kelasId <= 0) {
      return res.status(400).json({ error: 'bad_request', reason: 'invalid_id' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const kelas = await tx.kelas.findUnique({
        where: { id: kelasId },
        include: { nilai: { select: { id: true, mahasiswaId: true } } },
      });

      if (!kelas) return { kind: 'not_found' };
      if (kelas.dosenId !== req.auth.userId) return { kind: 'forbidden' };
      if (kelas.nilai.length === 0) return { kind: 'empty_class' };

      await tx.nilai.updateMany({
        where: { kelasId },
        data: { status: 'final' },
      });

      return {
        kind: 'ok',
        finalizedCount: kelas.nilai.length,
        studentIds: [...new Set(kelas.nilai.map((nilai) => nilai.mahasiswaId))],
      };
    });

    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'not_found', reason: 'kelas_not_found' });
    }
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'forbidden', reason: 'class_not_owned' });
    }
    if (result.kind === 'empty_class') {
      return res.status(409).json({ error: 'conflict', reason: 'kelas_tanpa_nilai' });
    }

    // Ambil seluruh nilai final mahasiswa terkait agar transkrip selalu lengkap
    // lintas kelas, bukan hanya kelas yang baru difinalisasi.
    const finalValues = await prisma.nilai.findMany({
      where: {
        mahasiswaId: { in: result.studentIds },
        status: 'final',
      },
      include: {
        kelas: { select: { id: true, nama_mata_kuliah: true } },
        mahasiswa: { select: { username: true } },
      },
      orderBy: [{ mahasiswaId: 'asc' }, { kelasId: 'asc' }],
    });

    const grouped = new Map();
    for (const nilai of finalValues) {
      if (!grouped.has(nilai.mahasiswaId)) {
        grouped.set(nilai.mahasiswaId, {
          nim: nilai.mahasiswa.username,
          data_nilai: [],
        });
      }

      grouped.get(nilai.mahasiswaId).data_nilai.push({
        kelas_id: nilai.kelas.id,
        nama_mata_kuliah: nilai.kelas.nama_mata_kuliah,
        skor: nilai.skor,
        status: nilai.status,
      });
    }

    const items = [...grouped.values()];

    if (items.length === 0) {
      return res.status(409).json({ error: 'conflict', reason: 'tidak_ada_nilai_final' });
    }

    let syncResult;
    try {
      syncResult = await syncTranscript({
        source: 'service-nilai',
        kelas_id: kelasId,
        items,
      });
    } catch (error) {
      console.error(
        `[service-nilai] sinkronisasi transkrip kelas ${kelasId} gagal:`,
        error.message,
      );

      return res.status(502).json({
        error: 'transcript_sync_failed',
        reason: 'finalized_but_sync_failed',
        finalized: true,
        kelas_id: kelasId,
        finalized_count: result.finalizedCount,
      });
    }

    return res.status(200).json({
      message: 'kelas_finalized',
      kelas_id: kelasId,
      finalized_count: result.finalizedCount,
      sync: syncResult,
    });
  }),
);

module.exports = router;
