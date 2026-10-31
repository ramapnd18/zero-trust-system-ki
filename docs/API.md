# Dokumentasi API - Sistem Nilai Zero Trust

| Metadata | Nilai |
| :--- | :--- |
| Versi dokumen | `1.0.0` |
| Fase | Fase 2 (Gateway) + Fase 3 (Resource Services) |
| Terakhir diperbarui | 2026-10-28 |
| Status | Semua endpoint PRD sudah aktif |

Dokumen ini mencatat endpoint yang **benar-benar aktif** pada stack Docker. Semua akses dari host hanya melalui gateway di `http://localhost:3000`. Service Nilai (`3001`) dan Service Transkrip (`3002`) tidak dipublikasikan ke host.

---

## 1. Topologi dan Base URL

| Komponen | Base URL dari host | Base URL dari container | Akses host |
| :--- | :--- | :--- | :--- |
| Gateway | `http://localhost:3000` | `http://gateway:3000` | Terbuka |
| Service Nilai | - | `http://service-nilai:3001` | Tertutup |
| Service Transkrip | - | `http://service-transkrip:3002` | Tertutup |

Alur request:

```text
Client/Postman
  -> Gateway (auth, device, role/ABAC, jam operasional, audit)
  -> Service Nilai / Service Transkrip (verifikasi ulang secret + JWT + device)
```

Service-to-service:

```text
Service Nilai
  -> POST /auth/service (service token 5 menit)
  -> POST /transkrip/sinkron melalui Gateway
  -> Service Transkrip
```

`service-nilai` **tidak pernah** memanggil `service-transkrip:3002` secara langsung dan `service-transkrip` tidak memegang `SERVICE_CLIENT_SECRET`.

---

## 2. Header dan Aturan Keamanan

| Header | Arah | Wajib | Keterangan |
| :--- | :--- | :--- | :--- |
| `Authorization: Bearer <token>` | Client -> Gateway | Ya, kecuali health/login | Access token user atau service token |
| `X-Device-ID: <device_id>` | Client -> Gateway | Ya untuk access token | Harus terdaftar untuk user |
| `X-Gateway-Secret: <secret>` | Gateway -> Service | Ya (internal) | Ditambahkan gateway; client tidak boleh mengandalkan header ini |
| `Content-Type: application/json` | Client -> Gateway | Untuk body JSON | `POST`/`PUT` |

Aturan penting:

- Gateway **menimpa** `X-Gateway-Secret` dari client. Nilai palsu dari client tidak diteruskan.
- Downstream memverifikasi ulang `X-Gateway-Secret` dan signature/expiry/issuer/audience JWT.
- Downstream juga memverifikasi ulang device context untuk access token.
- JWT menggunakan `HS256`, satu issuer/audience untuk access dan service token, dibedakan oleh claim `token_use` (`access` / `service`).
- Access token: 10 menit. Refresh token: 1 hari, stateful, dirotasi setiap refresh. Service token: 5 menit.
- Refresh token disimpan sebagai hash SHA-256 di database, bukan plaintext.
- Role token dicocokkan ulang dengan role user di database.

---

## 3. Ringkasan Endpoint Aktif

| # | Method | Path | Komponen | Akses | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `GET` | `/health` | Gateway | Publik | Aktif |
| 2 | `POST` | `/auth/login` | Gateway | Publik + device | Aktif |
| 3 | `POST` | `/auth/refresh` | Gateway | Refresh token + device | Aktif |
| 4 | `POST` | `/auth/logout` | Gateway | Refresh token + device | Aktif |
| 5 | `POST` | `/auth/service` | Gateway | Client ID + secret | Aktif |
| 6 | `GET` | `/nilai` | Service Nilai via gateway | Mahasiswa, dosen | Aktif |
| 7 | `PUT` | `/nilai/:id` | Service Nilai via gateway | Dosen pengampu, jam operasional, draft | Aktif |
| 8 | `POST` | `/kelas/:id/finalisasi` | Service Nilai via gateway | Dosen pengampu, jam operasional | Aktif |
| 9 | `GET` | `/transkrip/:nim` | Service Transkrip via gateway | Mahasiswa sendiri, admin | Aktif |
| 10 | `POST` | `/transkrip/sinkron` | Service Transkrip via gateway | Service token `service-nilai` | Aktif |
| 11 | `GET` | `/health` | Service Nilai | Internal Docker | Aktif |
| 12 | `GET` | `/health` | Service Transkrip | Internal Docker | Aktif |
| 13 | `ANY` | path tidak dikenal | Gateway | Publik | 404 |

### Matriks akses role

| Endpoint | Admin | Dosen | Mahasiswa | Service |
| :--- | :--- | :--- | :--- | :--- |
| `GET /nilai` | Ditolak | Nilai kelas yang diampu | Nilai sendiri | Ditolak |
| `PUT /nilai/:id` | Ditolak | Hanya kelas sendiri + jam operasional + draft | Ditolak | Ditolak |
| `POST /kelas/:id/finalisasi` | Ditolak | Hanya kelas sendiri + jam operasional | Ditolak | Ditolak |
| `GET /transkrip/:nim` | Semua NIM | Ditolak | Hanya NIM sendiri | Ditolak |
| `POST /transkrip/sinkron` | Ditolak | Ditolak | Ditolak | Hanya `service-nilai` |

---

## 4. Format Error

Semua error menggunakan JSON:

```json
{
  "error": "forbidden",
  "reason": "class_not_owned"
}
```

| Status | Makna umum |
| :--- | :--- |
| `400` | Body/parameter tidak valid |
| `401` | Token tidak ada, invalid, expired, atau kredensial salah |
| `403` | Role/ABAC/device/jam operasional tidak mengizinkan |
| `404` | Resource/route tidak ditemukan |
| `405` | Method tidak diizinkan untuk path tersebut |
| `409` | Konflik status, misalnya nilai sudah final |
| `413` | Body terlalu besar |
| `500` | Kesalahan internal |
| `502` | Service downstream tidak tersedia atau sinkronisasi gagal |
| `503` | Audit tidak dapat ditulis (fail-closed) |

Reason yang sering muncul:

`missing_token`, `token_expired`, `invalid_token`, `device_id_required`, `device_not_registered`, `invalid_credentials`, `invalid_refresh_token`, `refresh_token_expired`, `invalid_client`, `role_not_allowed`, `service_token_required`, `service_client_not_allowed`, `outside_operational_hours`, `class_not_owned`, `nilai_final`, `nilai_not_found`, `kelas_not_found`, `transkrip_forbidden`, `route_not_allowed`, `method_not_allowed`.

---

## 5. Autentikasi

### 5.1 `POST /auth/login`

Login dengan username, password, dan device yang terdaftar.

| Atribut | Nilai |
| :--- | :--- |
| Method | `POST` |
| Path | `/auth/login` |
| Auth | Tidak ada access token |
| Header wajib | `Content-Type: application/json`, `X-Device-ID` |
| Body | `username`, `password` |

Request:

```http
POST http://localhost:3000/auth/login
Content-Type: application/json
X-Device-ID: device-20231001-01

{
  "username": "20231001",
  "password": "Mhs#2026"
}
```

Response `200 OK`:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<token-stateful>",
  "token_type": "Bearer",
  "expires_in": 600,
  "refresh_expires_in": 86400,
  "user": {
    "id": 4,
    "username": "20231001",
    "role": "mahasiswa"
  }
}
```

Error:

| Status | Reason | Kondisi |
| :--- | :--- | :--- |
| `400` | `invalid_request` | Username/password kosong atau terlalu panjang |
| `401` | `device_id_required` | Header `X-Device-ID` tidak ada/invalid |
| `401` | `invalid_credentials` | Username tidak ada atau password salah |
| `403` | `device_not_registered` | Kredensial benar, device bukan milik user |

Catatan: pesan untuk username tidak ditemukan dan password salah sengaja sama.

---

### 5.2 `POST /auth/refresh`

Menukar refresh token dengan access token baru. Refresh token **dirotasi**: token lama langsung dicabut.

| Atribut | Nilai |
| :--- | :--- |
| Method | `POST` |
| Path | `/auth/refresh` |
| Header wajib | `Content-Type: application/json`, `X-Device-ID` |
| Body | `refresh_token` |

Request:

```http
POST http://localhost:3000/auth/refresh
Content-Type: application/json
X-Device-ID: device-20231001-01

{
  "refresh_token": "<refresh-token-lama>"
}
```

Response `200 OK` sama dengan response login (berisi access token baru dan refresh token baru).

Error: `400 invalid_request`, `401 invalid_refresh_token`, `401 refresh_token_expired`, `403 device_not_registered`.

Catatan: setelah refresh berhasil, token lama tidak dapat dipakai lagi. Postman collection otomatis menyimpan token baru.

---

### 5.3 `POST /auth/logout`

Mencabut refresh token yang diberikan.

| Atribut | Nilai |
| :--- | :--- |
| Method | `POST` |
| Path | `/auth/logout` |
| Header wajib | `Content-Type: application/json`, `X-Device-ID` |
| Body | `refresh_token` |

Response `200 OK`:

```json
{
  "message": "logged_out"
}
```

Error: `400 invalid_request`, `401 invalid_refresh_token`, `403 device_not_registered`.

Catatan: access token yang sudah terbit tetap valid sampai expiry (maksimal 10 menit). Logout hanya mencabut refresh token yang dikirim.

---

### 5.4 `POST /auth/service`

Menerbitkan service token 5 menit. Hanya `service-nilai` yang memegang client secret.

| Atribut | Nilai |
| :--- | :--- |
| Method | `POST` |
| Path | `/auth/service` |
| Auth | Client ID + client secret |
| Header wajib | `Content-Type: application/json` |
| Body | `client_id`, `client_secret` |

Request:

```http
POST http://localhost:3000/auth/service
Content-Type: application/json

{
  "client_id": "service-nilai",
  "client_secret": "<SERVICE_CLIENT_SECRET>"
}
```

Response `200 OK`:

```json
{
  "access_token": "<service-jwt>",
  "token_type": "Bearer",
  "expires_in": 300,
  "role": "service"
}
```

Error: `400 invalid_request`, `401 invalid_client`.

Service token hanya diizinkan untuk `POST /transkrip/sinkron`. Access token user (termasuk admin) ditolak di endpoint tersebut.

---

## 6. Nilai

### 6.1 `GET /nilai`

Mengambil nilai sesuai subjek JWT.

| Atribut | Nilai |
| :--- | :--- |
| Method | `GET` |
| Path | `/nilai` |
| Auth | Access token |
| Header wajib | `Authorization`, `X-Device-ID` |
| Query | Tidak ada |

Perilaku:

- Mahasiswa: hanya baris nilai dengan `mahasiswaId` miliknya.
- Dosen: hanya nilai pada kelas yang `dosenId`-nya miliknya.
- Admin: ditolak `403 role_not_allowed`.

Response `200 OK`:

```json
{
  "data": [
    {
      "id": 1,
      "skor": 85,
      "status": "draft",
      "kelas": {
        "id": 1,
        "nama_mata_kuliah": "Pemrograman Web"
      },
      "mahasiswa": {
        "id": 4,
        "nim": "20231001"
      }
    }
  ]
}
```

---

### 6.2 `PUT /nilai/:id`

Mengubah skor nilai draft.

| Atribut | Nilai |
| :--- | :--- |
| Method | `PUT` |
| Path | `/nilai/:id` |
| Auth | Access token dosen |
| Header wajib | `Authorization`, `X-Device-ID`, `Content-Type: application/json` |
| Body | `skor` (number 0-100) |

Pemeriksaan berlapis:

1. Gateway: JWT, device, role dosen, jam operasional, nilai ada, kelas milik dosen, status masih `draft`.
2. Service Nilai: verifikasi ulang secret/JWT/device, jam operasional, ownership, status draft dalam transaksi database.

Request:

```http
PUT http://localhost:3000/nilai/1
Authorization: Bearer <dosen-access-token>
X-Device-ID: device-dosen1-01
Content-Type: application/json

{
  "skor": 87
}
```

Response `200 OK`:

```json
{
  "data": {
    "id": 1,
    "skor": 87,
    "status": "draft",
    "kelas": {
      "id": 1,
      "nama_mata_kuliah": "Pemrograman Web"
    },
    "mahasiswa": {
      "id": 4,
      "nim": "20231001"
    }
  }
}
```

Error:

| Status | Reason | Kondisi |
| :--- | :--- | :--- |
| `400` | `invalid_id` | ID bukan bilangan positif |
| `400` | `invalid_skor` | Skor bukan number 0-100 |
| `403` | `class_not_owned` | Nilai milik kelas dosen lain |
| `403` | `role_not_allowed` | Bukan dosen |
| `403` | `outside_operational_hours` | Di luar jam operasional |
| `404` | `nilai_not_found` | ID tidak ada |
| `409` | `nilai_final` | Nilai sudah final |

---

### 6.3 `POST /kelas/:id/finalisasi`

Memfinalisasi seluruh nilai pada kelas dan menyinkronkan transkrip mahasiswa terkait.

| Atribut | Nilai |
| :--- | :--- |
| Method | `POST` |
| Path | `/kelas/:id/finalisasi` |
| Auth | Access token dosen |
| Header wajib | `Authorization`, `X-Device-ID` |
| Body | Tidak ada |

Perilaku:

- Hanya dosen pengampu kelas.
- Hanya dalam jam operasional.
- Semua nilai kelas diubah ke `final`.
- Service Nilai mengambil **seluruh nilai final** mahasiswa terkait (lintas kelas).
- Service Nilai meminta service token ke gateway, lalu memanggil `POST /transkrip/sinkron` melalui gateway.
- Operasi idempotent: jika sinkronisasi gagal, ulangi finalisasi untuk mengirim ulang.

Response `200 OK`:

```json
{
  "message": "kelas_finalized",
  "kelas_id": 1,
  "finalized_count": 3,
  "sync": {
    "synced": 3,
    "nims": ["20231001", "20231002", "20231003"]
  }
}
```

Error:

| Status | Reason | Kondisi |
| :--- | :--- | :--- |
| `403` | `class_not_owned` | Bukan dosen pengampu |
| `403` | `outside_operational_hours` | Di luar jam operasional |
| `404` | `kelas_not_found` | Kelas tidak ada |
| `409` | `kelas_tanpa_nilai` | Kelas belum punya nilai |
| `502` | `finalized_but_sync_failed` | Nilai sudah final, sinkronisasi transkrip gagal; ulangi finalisasi |

---

## 7. Transkrip

### 7.1 `GET /transkrip/:nim`

| Atribut | Nilai |
| :--- | :--- |
| Method | `GET` |
| Path | `/transkrip/:nim` |
| Auth | Access token |
| Header wajib | `Authorization`, `X-Device-ID` |

Perilaku:

- Mahasiswa: hanya `nim` miliknya sendiri.
- Admin: semua NIM mahasiswa.
- Dosen: ditolak.

Response `200 OK`:

```json
{
  "nim": "20231001",
  "data_nilai": [
    {
      "kelas_id": 1,
      "nama_mata_kuliah": "Pemrograman Web",
      "skor": 87,
      "status": "final"
    }
  ]
}
```

Sebelum ada finalisasi, `data_nilai` berisi `[]`. Error: `403 transkrip_forbidden` untuk mahasiswa yang meminta NIM lain, `404 mahasiswa_not_found`, `404 transkrip_not_found`.

---

### 7.2 `POST /transkrip/sinkron`

Endpoint internal untuk service-to-service. Biasanya dipanggil otomatis oleh Service Nilai saat finalisasi. Endpoint ini juga dapat diuji manual dengan service token.

| Atribut | Nilai |
| :--- | :--- |
| Method | `POST` |
| Path | `/transkrip/sinkron` |
| Auth | Service token `role=service`, `client_id=service-nilai` |
| Header wajib | `Authorization`, `Content-Type: application/json` |
| Device | Tidak diperlukan |

Request:

```http
POST http://localhost:3000/transkrip/sinkron
Authorization: Bearer <service-token>
Content-Type: application/json

{
  "source": "service-nilai",
  "kelas_id": 1,
  "items": [
    {
      "nim": "20231001",
      "data_nilai": [
        {
          "kelas_id": 1,
          "nama_mata_kuliah": "Pemrograman Web",
          "skor": 87,
          "status": "final"
        }
      ]
    }
  ]
}
```

Response `200 OK`:

```json
{
  "synced": 1,
  "nims": ["20231001"]
}
```

Validasi:

- `items` 1-1000, NIM unik, NIM harus user role `mahasiswa`.
- Setiap `data_nilai` 1-500 entri.
- Setiap entri wajib memiliki `kelas_id` (integer positif), `nama_mata_kuliah` (string), `skor` (number 0-100), dan `status` harus `"final"`.
- Access token user ditolak `403 service_token_required` oleh gateway.

Error: `400 invalid_kelas_id`, `400 invalid_items`, `400 invalid_item`, `400 duplicate_nim`, `400 invalid_data_nilai`, `400 unknown_nim`; `403 service_token_required`; `403 service_client_not_allowed`.

---

## 8. Health Check dan Fallback

### 8.1 `GET /health` - Gateway

```http
GET http://localhost:3000/health
```

```json
{
  "status": "ok",
  "service": "gateway",
  "phase": "phase-2-3"
}
```

### 8.2 `GET /health` - Service Nilai

```powershell
docker compose exec service-nilai node -e "fetch('http://127.0.0.1:3001/health').then(async (r) => console.log(r.status, await r.text()))"
```

```json
{
  "status": "ok",
  "service": "service-nilai",
  "phase": "phase-3"
}
```

### 8.3 `GET /health` - Service Transkrip

```powershell
docker compose exec service-transkrip node -e "fetch('http://127.0.0.1:3002/health').then(async (r) => console.log(r.status, await r.text()))"
```

```json
{
  "status": "ok",
  "service": "service-transkrip",
  "phase": "phase-3"
}
```

Health check sengaja dikecualikan dari `X-Gateway-Secret` + JWT agar Docker healthcheck berfungsi.

### 8.4 Fallback 404

Path yang tidak terdaftar:

```json
{
  "error": "not_found"
}
```

Path di bawah prefiks resource yang tidak cocok dengan route yang diizinkan akan diaudit dan menghasilkan `404 route_not_allowed`.

---

## 9. Verifikasi Keamanan Internal

Port `3001`/`3002` tidak dapat diakses dari host:

```powershell
Invoke-WebRequest http://127.0.0.1:3001/health -TimeoutSec 3   # harus gagal
Invoke-WebRequest http://127.0.0.1:3002/health -TimeoutSec 3   # harus gagal
```

Uji double verification dari container gateway:

```powershell
# Tanpa X-Gateway-Secret -> 403 invalid_gateway_secret
docker compose exec gateway node -e "fetch('http://service-nilai:3001/nilai').then(async (r) => console.log(r.status, await r.text()))"

# Dengan secret tetapi tanpa JWT -> 401 missing_token
docker compose exec gateway node -e "fetch('http://service-nilai:3001/nilai',{headers:{'X-Gateway-Secret':process.env.GATEWAY_SECRET}}).then(async (r) => console.log(r.status, await r.text()))"

# Service token tetap tidak boleh mengakses /nilai -> 403 access_token_required
docker compose exec gateway node -e "(async()=>{const t=await fetch('http://127.0.0.1:3000/auth/service',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:process.env.SERVICE_CLIENT_ID,client_secret:process.env.SERVICE_CLIENT_SECRET})}).then(r=>r.json());const r=await fetch('http://service-nilai:3001/nilai',{headers:{'X-Gateway-Secret':process.env.GATEWAY_SECRET,Authorization:'Bearer '+t.access_token}});console.log(r.status,await r.text())})()"
```

---

## 10. Audit Log

Setiap keputusan gateway (allow/deny) ditulis ke tabel `AuditLog` sebelum request diteruskan. Jika penulisan audit gagal, request yang seharusnya allow ditolak `503 audit_unavailable` (fail-closed).

Kolom: `waktu`, `subjek`, `endpoint`, `device`, `keputusan`, `alasan`.

Contoh subjek: `user:4`, `service:service-nilai`, `anonymous`.

Lihat 20 audit terakhir:

```powershell
docker compose exec gateway node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.auditLog.findMany({orderBy:{id:'desc'},take:20}).then(console.table).finally(()=>p.`$disconnect())"
```

Alasan allow contoh: `login_success`, `refresh_success`, `nilai_list_allowed`, `nilai_update_allowed`, `kelas_finalization_allowed`, `own_transkrip_allowed`, `admin_transkrip_allowed`, `transcript_sync_allowed`.

Alasan deny contoh: `invalid_credentials`, `device_not_registered`, `role_not_allowed`, `class_not_owned`, `nilai_final`, `outside_operational_hours`, `service_token_required`, `route_not_allowed`.

---

## 11. Jam Operasional

Perubahan nilai (`PUT /nilai/:id`) dan finalisasi (`POST /kelas/:id/finalisasi`) hanya diizinkan pada:

```text
[OPERATIONAL_START_HOUR, OPERATIONAL_END_HOUR) waktu TZ
Default: [07:00, 21:00) Asia/Jakarta
```

Artinya pukul `07:00` diizinkan dan pukul `21:00` ditolak. Gateway dan Service Nilai memeriksa aturan ini secara independen.

Ubah lewat `.env`:

```dotenv
OPERATIONAL_START_HOUR=7
OPERATIONAL_END_HOUR=21
TZ=Asia/Jakarta
```

Setelah mengubah, jalankan `docker compose up -d --force-recreate`.

---

## 12. Postman Collection

File: `postman/zero-trust-system.postman_collection.json`

### Import dan persiapan

1. Postman -> **Import** -> **File** -> pilih collection.
2. Buka tab **Variables** collection.
3. Isi `service_client_secret` dengan nilai `SERVICE_CLIENT_SECRET` dari `.env` (jangan commit nilai ini).
4. Pastikan stack berjalan: `docker compose up -d`.
5. Jalankan folder secara berurutan, atau gunakan **Run collection**.

### Variable penting

| Variable | Default | Keterangan |
| :--- | :--- | :--- |
| `gateway_url` | `http://localhost:3000` | Base URL gateway |
| `admin_token`, `dosen_token`, `dosen2_token`, `mahasiswa_token` | kosong | Diisi otomatis oleh request login |
| `admin_refresh_token`, `dosen_refresh_token`, `mahasiswa_refresh_token` | kosong | Diisi otomatis oleh request login |
| `service_token` | kosong | Diisi otomatis oleh request service token |
| `nilai_id` | `1` | Nilai draft kelas `Pemrograman Web` pada seed |
| `kelas_id` | `1` | Kelas `Pemrograman Web` |
| `nim` | `20231001` | NIM mahasiswa demo |
| `nim_lain` | `20231003` | NIM mahasiswa lain untuk uji deny |
| `service_client_id` | `service-nilai` | Client ID service |
| `service_client_secret` | kosong | **Isi manual dari `.env`** |

### Urutan yang disarankan

1. `Health Check`
2. `Auth` - login admin/dosen/mahasiswa dan service token
3. `Nilai` - GET mahasiswa, GET dosen, PUT draft, finalisasi
4. `Transkrip` - GET sendiri, GET admin, GET NIM lain (deny), sinkron service
5. `Negative Cases` - login salah, tanpa device, admin GET nilai, dosen GET transkrip

Setelah finalisasi, nilai kelas menjadi `final`. Jika collection dijalankan ulang, `PUT /nilai/1` akan menghasilkan `409 nilai_final`. Reset database demo untuk mengulang dari awal (lihat bagian 14).

---

## 13. Smoke Test Otomatis

Tersedia:

```powershell
npm run test:smoke
```

Script melakukan 44 pemeriksaan: login/device, ABAC nilai, refresh rotation, logout, service token, sinkronisasi transkrip, finalisasi, dan pembacaan transkrip.

Script **mengubah data demo**. Setelah selesai, reset database jika ingin state bersih:

```powershell
docker compose down
Remove-Item database\zerotrust.db -ErrorAction SilentlyContinue
docker compose up -d
```

Jika dijalankan di luar jam operasional, pengujian write menyesuaikan ekspektasi menjadi `403 outside_operational_hours`.

---

## 14. Troubleshooting

| Masalah | Penyebab/Solusi |
| :--- | :--- |
| `401 device_id_required` | Tambahkan header `X-Device-ID` sesuai user |
| `403 device_not_registered` | Device tidak terdaftar untuk user; gunakan device dari seed |
| `401 invalid_credentials` | Password/username salah; cek `.env` seed password |
| `403 outside_operational_hours` | Di luar `[07:00, 21:00)` Asia/Jakarta; ubah env atau tunggu jam operasional |
| `409 nilai_final` | Nilai sudah difinalisasi; reset DB atau gunakan nilai draft lain |
| `502 transcript_sync_failed` | Service Transkrip/gateway bermasalah; cek log lalu ulangi finalisasi |
| `403 service_token_required` | `/transkrip/sinkron` hanya menerima service token, bukan access token user |
| `401 invalid_client` | `service_client_id`/`service_client_secret` salah |
| Postman tidak bisa akses `3001`/`3002` | Disengaja; port internal tidak dipublikasikan |
| Ingin reset database demo | `docker compose down`, hapus `database/zerotrust.db*`, lalu `docker compose up -d` |
| Ingin melihat audit | Gunakan perintah pada bagian 10 |
| Ingin melihat log | `docker compose logs gateway`, `docker compose logs service-nilai`, `docker compose logs service-transkrip` |

---

## 15. Di Luar Scope Saat Ini

Endpoint berikut tidak termasuk PRD yang diimplementasikan dan belum tersedia:

- CRUD user, kelas, dan device oleh admin.
- Enrollment device mandiri.
- Dashboard/web UI.
- Rate limiting login (belum diterapkan; gunakan reverse proxy/WAF di produksi).
- Distribusi refresh token lintas node (SQLite + satu gateway).
