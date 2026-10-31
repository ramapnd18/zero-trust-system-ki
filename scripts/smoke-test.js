'use strict';

/**
 * Smoke test end-to-end untuk stack yang sedang berjalan.
 *
 * Jalankan dari root setelah `docker compose up -d`:
 *   npm run test:smoke
 *
 * Script ini MENGUBAH data demo (PUT nilai, finalisasi, sinkronisasi transkrip)
 * dan membuat audit/refresh token. Reset database setelah selesai jika ingin
 * state demo yang bersih:
 *   docker compose down
 *   Remove-Item database\zerotrust.db
 *   docker compose up -d
 *
 * Jika dijalankan di luar jam operasional, pengujian write akan menyesuaikan
 * ekspektasi menjadi 403 outside_operational_hours.
 */

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');

const BASE_URL = (process.env.GATEWAY_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin#2026';
const DOSEN_PASSWORD = process.env.SEED_DOSEN_PASSWORD || 'Dosen#2026';
const MAHASISWA_PASSWORD = process.env.SEED_MAHASISWA_PASSWORD || 'Mhs#2026';
const SERVICE_CLIENT_ID = process.env.SERVICE_CLIENT_ID || 'service-nilai';
const SERVICE_CLIENT_SECRET = process.env.SERVICE_CLIENT_SECRET;

let passed = 0;
let skipped = 0;

function ok(name) {
  passed += 1;
  console.log(`PASS  ${name}`);
}

function skip(name, reason) {
  skipped += 1;
  console.log(`SKIP  ${name} (${reason})`);
}

function check(condition, name, details) {
  assert.ok(condition, `${name}${details ? `: ${JSON.stringify(details)}` : ''}`);
  ok(name);
}

function checkStatus(response, expected, name) {
  check(response.status === expected, name, {
    expected,
    actual: response.status,
    body: response.body,
  });
}

async function request(path, { method = 'GET', token, device, body, headers = {} } = {}) {
  const finalHeaders = { ...headers };

  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  if (device) finalHeaders['X-Device-ID'] = device;
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed, headers: response.headers };
}

async function login(username, password, device) {
  return request('/auth/login', {
    method: 'POST',
    device,
    body: { username, password },
  });
}

function getJakartaHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.TZ || 'Asia/Jakarta',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  return Number.parseInt(parts.find((part) => part.type === 'hour').value, 10);
}

async function main() {
  console.log(`Smoke test gateway: ${BASE_URL}`);

  const health = await request('/health');
  checkStatus(health, 200, 'gateway health 200');
  check(health.body.service === 'gateway', 'gateway health payload');

  const badLogin = await login('dosen1', 'salah-password', 'device-dosen1-01');
  checkStatus(badLogin, 401, 'login password salah ditolak');

  const noDeviceLogin = await login('dosen1', DOSEN_PASSWORD, null);
  checkStatus(noDeviceLogin, 401, 'login tanpa device ditolak');
  check(noDeviceLogin.body.reason === 'device_id_required', 'reason login tanpa device');

  const wrongDeviceLogin = await login('dosen1', DOSEN_PASSWORD, 'device-20231001-01');
  checkStatus(wrongDeviceLogin, 403, 'login device bukan milik user ditolak');

  const admin = await login('admin', ADMIN_PASSWORD, 'device-admin-01');
  checkStatus(admin, 200, 'login admin');
  check(admin.body.user.role === 'admin', 'role admin');

  const dosen1 = await login('dosen1', DOSEN_PASSWORD, 'device-dosen1-01');
  checkStatus(dosen1, 200, 'login dosen1');

  const dosen2 = await login('dosen2', DOSEN_PASSWORD, 'device-dosen2-01');
  checkStatus(dosen2, 200, 'login dosen2');

  const mhs1 = await login('20231001', MAHASISWA_PASSWORD, 'device-20231001-01');
  checkStatus(mhs1, 200, 'login mahasiswa 20231001');

  const mhs2 = await login('20231002', MAHASISWA_PASSWORD, 'device-20231002-01');
  checkStatus(mhs2, 200, 'login mahasiswa 20231002');

  const mhs3 = await login('20231003', MAHASISWA_PASSWORD, 'device-20231003-01');
  checkStatus(mhs3, 200, 'login mahasiswa 20231003');

  const adminAuth = { token: admin.body.access_token, device: 'device-admin-01' };
  const dosen1Auth = { token: dosen1.body.access_token, device: 'device-dosen1-01' };
  const dosen2Auth = { token: dosen2.body.access_token, device: 'device-dosen2-01' };
  const mhs1Auth = { token: mhs1.body.access_token, device: 'device-20231001-01' };
  const mhs2Auth = { token: mhs2.body.access_token, device: 'device-20231002-01' };

  const missingDevice = await request('/nilai', { token: mhs2Auth.token });
  checkStatus(missingDevice, 401, 'GET /nilai tanpa device ditolak');

  const wrongDevice = await request('/nilai', {
    token: mhs2Auth.token,
    device: 'device-20231003-01',
  });
  checkStatus(wrongDevice, 403, 'GET /nilai device salah ditolak');

  const mhsValues = await request('/nilai', mhs1Auth);
  checkStatus(mhsValues, 200, 'GET /nilai mahasiswa');
  check(
    Array.isArray(mhsValues.body.data) && mhsValues.body.data.length > 0,
    'mahasiswa menerima data nilai',
  );
  check(
    mhsValues.body.data.every((item) => item.mahasiswa.nim === '20231001'),
    'mahasiswa hanya menerima nilainya sendiri',
  );

  const dosenValues = await request('/nilai', dosen1Auth);
  checkStatus(dosenValues, 200, 'GET /nilai dosen');
  check(
    dosenValues.body.data.every((item) => item.kelas.id === 1),
    'dosen hanya menerima nilai kelas yang diampu',
  );

  const adminNilai = await request('/nilai', adminAuth);
  checkStatus(adminNilai, 403, 'admin tidak boleh membaca /nilai');

  const adminTranskrip = await request('/transkrip/20231001', adminAuth);
  checkStatus(adminTranskrip, 200, 'admin boleh membaca transkrip mahasiswa');

  const dosenTranskrip = await request('/transkrip/20231001', dosen1Auth);
  checkStatus(dosenTranskrip, 403, 'dosen tidak boleh membaca transkrip');

  const otherTranskrip = await request('/transkrip/20231003', mhs2Auth);
  checkStatus(otherTranskrip, 403, 'mahasiswa tidak boleh membaca transkrip lain');

  const invalidClient = await request('/auth/service', {
    method: 'POST',
    body: { client_id: SERVICE_CLIENT_ID, client_secret: 'salah' },
  });
  checkStatus(invalidClient, 401, 'service client secret salah ditolak');

  let serviceToken = null;
  if (SERVICE_CLIENT_SECRET) {
    const serviceAuth = await request('/auth/service', {
      method: 'POST',
      body: { client_id: SERVICE_CLIENT_ID, client_secret: SERVICE_CLIENT_SECRET },
    });
    checkStatus(serviceAuth, 200, 'service token diterbitkan');
    check(serviceAuth.body.role === 'service', 'role service token');
    serviceToken = serviceAuth.body.access_token;
  } else {
    skip('service token', 'SERVICE_CLIENT_SECRET tidak tersedia');
  }

  if (serviceToken) {
    const syncPayload = {
      source: 'service-nilai',
      kelas_id: 2,
      items: [
        {
          nim: '20231002',
          data_nilai: [
            {
              kelas_id: 2,
              nama_mata_kuliah: 'Kecerdasan Buatan',
              skor: 76,
              status: 'final',
            },
          ],
        },
      ],
    };

    const userSync = await request('/transkrip/sinkron', {
      method: 'POST',
      ...mhs2Auth,
      body: syncPayload,
    });
    checkStatus(userSync, 403, 'access token user tidak boleh sinkron transkrip');

    const serviceSync = await request('/transkrip/sinkron', {
      method: 'POST',
      token: serviceToken,
      body: syncPayload,
    });
    checkStatus(serviceSync, 200, 'service token boleh sinkron transkrip');
    check(serviceSync.body.synced === 1, 'jumlah transkrip tersinkron');
  }

  const refresh = await request('/auth/refresh', {
    method: 'POST',
    device: 'device-20231003-01',
    body: { refresh_token: mhs3.body.refresh_token },
  });
  checkStatus(refresh, 200, 'refresh token valid');
  check(Boolean(refresh.body.access_token && refresh.body.refresh_token), 'token hasil rotasi');

  const replay = await request('/auth/refresh', {
    method: 'POST',
    device: 'device-20231003-01',
    body: { refresh_token: mhs3.body.refresh_token },
  });
  checkStatus(replay, 401, 'refresh token lama tidak dapat dipakai ulang');

  const logout = await request('/auth/logout', {
    method: 'POST',
    device: 'device-20231003-01',
    body: { refresh_token: refresh.body.refresh_token },
  });
  checkStatus(logout, 200, 'logout mencabut refresh token');

  const afterLogout = await request('/auth/refresh', {
    method: 'POST',
    device: 'device-20231003-01',
    body: { refresh_token: refresh.body.refresh_token },
  });
  checkStatus(afterLogout, 401, 'refresh setelah logout ditolak');

  const startHour = Number.parseInt(process.env.OPERATIONAL_START_HOUR || '7', 10);
  const endHour = Number.parseInt(process.env.OPERATIONAL_END_HOUR || '21', 10);
  const currentHour = getJakartaHour();
  const withinOperationalHours = currentHour >= startHour && currentHour < endHour;

  const draft = dosenValues.body.data.find((item) => item.status === 'draft');

  if (!draft) {
    skip('pengujian write nilai', 'tidak ada nilai draft pada data demo');
  } else if (!withinOperationalHours) {
    const outside = await request(`/nilai/${draft.id}`, {
      method: 'PUT',
      ...dosen1Auth,
      body: { skor: 87 },
    });
    checkStatus(outside, 403, 'PUT di luar jam operasional ditolak');
    check(outside.body.reason === 'outside_operational_hours', 'reason di luar jam operasional');
  } else {
    const invalidScore = await request(`/nilai/${draft.id}`, {
      method: 'PUT',
      ...dosen1Auth,
      body: { skor: 101 },
    });
    checkStatus(invalidScore, 400, 'skor di luar 0-100 ditolak');

    const notOwner = await request(`/nilai/${draft.id}`, {
      method: 'PUT',
      ...dosen2Auth,
      body: { skor: 87 },
    });
    checkStatus(notOwner, 403, 'dosen lain tidak boleh mengubah nilai');

    const updated = await request(`/nilai/${draft.id}`, {
      method: 'PUT',
      ...dosen1Auth,
      body: { skor: 87 },
    });
    checkStatus(updated, 200, 'dosen pengampu boleh mengubah nilai draft');
    check(updated.body.data.skor === 87, 'skor tersimpan');

    const finalization = await request(`/kelas/${draft.kelas.id}/finalisasi`, {
      method: 'POST',
      ...dosen1Auth,
    });
    checkStatus(finalization, 200, 'finalisasi kelas oleh dosen pengampu');
    check(
      finalization.body.sync && finalization.body.sync.synced > 0,
      'finalisasi menyinkronkan transkrip lewat gateway',
    );

    const blockedAfterFinal = await request(`/nilai/${draft.id}`, {
      method: 'PUT',
      ...dosen1Auth,
      body: { skor: 90 },
    });
    checkStatus(blockedAfterFinal, 409, 'nilai final tidak boleh diubah');

    const ownTranscript = await request('/transkrip/20231001', mhs1Auth);
    checkStatus(ownTranscript, 200, 'mahasiswa membaca transkrip sendiri');
    check(
      ownTranscript.body.data_nilai.some(
        (item) => item.kelas_id === draft.kelas.id && item.status === 'final',
      ),
      'transkrip memuat nilai final hasil sinkronisasi',
    );
  }

  console.log(`\nSMOKE TEST PASSED (${passed} checks, ${skipped} skipped)`);
}

main().catch((error) => {
  console.error('\nSMOKE TEST FAILED');
  console.error(error.message);
  process.exit(1);
});
