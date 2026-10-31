#!/usr/bin/env node
'use strict';

/**
 * Seed idempotent untuk Sistem Nilai Zero Trust.
 *
 * Catatan skema: User tidak memiliki kolom `nim` terpisah. Untuk mahasiswa,
 * `username` diperlakukan sebagai NIM (dipakai oleh endpoint /transkrip/:nim).
 * Password default hanya untuk lingkungan demo dan dapat dioverride via env.
 */

require('dotenv').config({ quiet: true });

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 10;

const MAHASISWA_PASSWORD = process.env.SEED_MAHASISWA_PASSWORD || 'Mhs#2026';
const DOSEN_PASSWORD = process.env.SEED_DOSEN_PASSWORD || 'Dosen#2026';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin#2026';

const SEED_USERS = [
  {
    username: 'admin',
    role: 'admin',
    password: ADMIN_PASSWORD,
    devices: ['device-admin-01'],
  },
  {
    username: 'dosen1',
    role: 'dosen',
    password: DOSEN_PASSWORD,
    devices: ['device-dosen1-01'],
  },
  {
    username: 'dosen2',
    role: 'dosen',
    password: DOSEN_PASSWORD,
    devices: ['device-dosen2-01'],
  },
  {
    username: '20231001',
    role: 'mahasiswa',
    password: MAHASISWA_PASSWORD,
    devices: ['device-20231001-01'],
  },
  {
    username: '20231002',
    role: 'mahasiswa',
    password: MAHASISWA_PASSWORD,
    devices: ['device-20231002-01'],
  },
  {
    username: '20231003',
    role: 'mahasiswa',
    password: MAHASISWA_PASSWORD,
    devices: ['device-20231003-01'],
  },
];

async function ensureUser({ username, role, password, devices }) {
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { username },
    update: { role, password_hash },
    create: { username, role, password_hash },
  });

  for (const deviceId of devices) {
    const existingDevice = await prisma.device.findFirst({
      where: { userId: user.id, device_id: deviceId },
    });

    if (!existingDevice) {
      await prisma.device.create({
        data: { userId: user.id, device_id: deviceId },
      });
    }
  }

  return user;
}

async function ensureKelas(namaMataKuliah, dosenId) {
  const existing = await prisma.kelas.findFirst({
    where: { nama_mata_kuliah: namaMataKuliah, dosenId },
  });

  if (existing) {
    return existing;
  }

  return prisma.kelas.create({
    data: { nama_mata_kuliah: namaMataKuliah, dosenId },
  });
}

async function ensureNilai(kelasId, mahasiswaId, skor) {
  const existing = await prisma.nilai.findFirst({
    where: { kelasId, mahasiswaId },
  });

  if (existing) {
    return existing;
  }

  return prisma.nilai.create({
    data: {
      kelasId,
      mahasiswaId,
      skor,
      status: 'draft',
    },
  });
}

async function ensureTranskrip(mahasiswaId) {
  const existing = await prisma.transkrip.findUnique({
    where: { mahasiswaId },
  });

  if (existing) {
    return;
  }

  await prisma.transkrip.create({
    data: {
      mahasiswaId,
      data_nilai: '[]',
    },
  });
}

async function main() {
  const users = new Map();

  for (const seedUser of SEED_USERS) {
    const user = await ensureUser(seedUser);
    users.set(seedUser.username, user);
  }

  const dosen1 = users.get('dosen1');
  const dosen2 = users.get('dosen2');
  const mahasiswa1 = users.get('20231001');
  const mahasiswa2 = users.get('20231002');
  const mahasiswa3 = users.get('20231003');

  const kelasWeb = await ensureKelas('Pemrograman Web', dosen1.id);
  const kelasAi = await ensureKelas('Kecerdasan Buatan', dosen2.id);

  const nilaiSeed = [
    [kelasWeb.id, mahasiswa1.id, 85],
    [kelasWeb.id, mahasiswa2.id, 90],
    [kelasWeb.id, mahasiswa3.id, 78],
    [kelasAi.id, mahasiswa1.id, 88],
    [kelasAi.id, mahasiswa2.id, 76],
    [kelasAi.id, mahasiswa3.id, 92],
  ];

  for (const [kelasId, mahasiswaId, skor] of nilaiSeed) {
    await ensureNilai(kelasId, mahasiswaId, skor);
  }

  for (const mahasiswa of [mahasiswa1, mahasiswa2, mahasiswa3]) {
    await ensureTranskrip(mahasiswa.id);
  }

  const [usersCount, devicesCount, kelasCount, nilaiCount, transkripCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.device.count(),
      prisma.kelas.count(),
      prisma.nilai.count(),
      prisma.transkrip.count(),
    ]);

  console.log('[seed] Selesai. Data saat ini:', {
    users: usersCount,
    devices: devicesCount,
    kelas: kelasCount,
    nilai: nilaiCount,
    transkrip: transkripCount,
  });
  console.log(
    '[seed] Akun demo: admin, dosen1, dosen2, 20231001, 20231002, 20231003'
  );
  console.log(
    '[seed] Password demo dibaca dari SEED_*_PASSWORD (lihat .env / .env.example).'
  );
}

main()
  .catch((error) => {
    console.error('[seed] Gagal:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
