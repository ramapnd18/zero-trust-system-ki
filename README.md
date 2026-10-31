# Sistem Nilai Zero Trust

Implementasi Sistem Nilai program studi Informatika dengan prinsip **Zero Trust** (NIST SP 800-207): *never trust, always verify*, *least privilege*, dan *assume breach*.

Gateway menjadi satu-satunya entry point publik. Gateway menangani autentikasi JWT, device binding, policy ABAC, jam operasional, audit log, dan proxy. Service Nilai serta Service Transkrip melakukan double verification terhadap `X-Gateway-Secret` dan JWT.

---

## 1. Arsitektur Singkat

| Komponen | Port | Akses dari host | Peran |
| :--- | :--- | :--- | :--- |
| `gateway` | 3000 | Terbuka | PEP + Policy Engine/Administrator |
| `service-nilai` | 3001 | Internal saja | Resource nilai & kelas |
| `service-transkrip` | 3002 | Internal saja | Resource transkrip |
| SQLite | - | volume `./database` | Database bersama |

Alur request:

```text
Client -> Gateway (JWT, device, role/ABAC, jam operasional, audit)
       -> Service Nilai / Service Transkrip (verifikasi ulang secret + JWT + device)
```

Sinkronisasi transkrip saat finalisasi:

```text
Service Nilai -> Gateway /auth/service -> service token 5 menit
Service Nilai -> Gateway /transkrip/sinkron -> Service Transkrip
```

Service Nilai tidak pernah memanggil Service Transkrip secara langsung.

---

## 2. Cara Menjalankan

### Prasyarat

- Docker Desktop
- Docker Compose v2
- Node.js (hanya diperlukan untuk menjalankan script lokal seperti `npm run env:init` dan `npm run test:smoke`)

### Langkah menjalankan

Buka terminal di root proyek `zero-trust-system`, lalu:

```powershell
# 1. Buat file .env berisi secret acak (lewati jika .env sudah ada)
npm run env:init

# 2. Build image dan jalankan seluruh stack
docker compose up --build -d

# 3. Pastikan semua container healthy
docker compose ps

# 4. Cek gateway dari host
Invoke-RestMethod http://127.0.0.1:3000/health
```

Linux/macOS:

```bash
npm run env:init
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:3000/health
```

Health check yang diharapkan:

```json
{
  "status": "ok",
  "service": "gateway",
  "phase": "phase-2-3"
}
```

Saat gateway pertama kali start, entrypoint akan otomatis:

1. menjalankan migrasi Prisma;
2. menjalankan seed idempotent (jika `SEED_ON_START=true`);
3. menjalankan API gateway.

Lihat log bootstrap:

```powershell
docker compose logs gateway
```

### Menghentikan dan mereset data demo

```powershell
# Hentikan stack
docker compose down

# Reset database ke kondisi seed bersih
Remove-Item database\zerotrust.db,database\zerotrust.db-wal,database\zerotrust.db-shm -ErrorAction SilentlyContinue
docker compose up -d
```

Linux/macOS:

```bash
docker compose down
rm -f database/zerotrust.db database/zerotrust.db-wal database/zerotrust.db-shm
docker compose up -d
```

---

## 3. Daftar Akun Demo dan Device ID

Username mahasiswa sekaligus berfungsi sebagai NIM. Setiap akun hanya boleh memakai device yang terdaftar.

| Role | Username | Password | Device ID (`X-Device-ID`) |
| :--- | :--- | :--- | :--- |
| Admin | `admin` | `Admin#2026` | `device-admin-01` |
| Dosen | `dosen1` | `Dosen#2026` | `device-dosen1-01` |
| Dosen | `dosen2` | `Dosen#2026` | `device-dosen2-01` |
| Mahasiswa | `20231001` | `Mhs#2026` | `device-20231001-01` |
| Mahasiswa | `20231002` | `Mhs#2026` | `device-20231002-01` |
| Mahasiswa | `20231003` | `Mhs#2026` | `device-20231003-01` |

> Password di atas adalah password demo. Nilainya dapat diubah lewat `SEED_ADMIN_PASSWORD`, `SEED_DOSEN_PASSWORD`, dan `SEED_MAHASISWA_PASSWORD` di `.env` sebelum seed dijalankan.

### Hak akses singkat

| Role | Hak akses |
| :--- | :--- |
| Admin | Melihat transkrip seluruh mahasiswa |
| Dosen | Melihat, mengubah, dan memfinalisasi nilai hanya pada kelas yang diampu |
| Mahasiswa | Melihat nilai dan transkrip miliknya sendiri |
| Service | Hanya `service-nilai` yang boleh memanggil sinkronisasi transkrip |

---

## 4. Data Awal (Seed)

Seed awal berisi **6 user, 6 device, 2 kelas, 6 nilai draft, dan 3 transkrip kosong**.

### 4.1 Kelas

| ID Kelas | Mata Kuliah | Dosen Pengampu |
| :--- | :--- | :--- |
| `1` | Pemrograman Web | `dosen1` |
| `2` | Kecerdasan Buatan | `dosen2` |

### 4.2 Nilai awal

Semua nilai di bawah ini berstatus `draft` dan dapat diubah oleh dosen pengampu pada jam operasional.

| ID Nilai | Kelas | Mahasiswa | NIM | Skor | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `1` | Pemrograman Web | `20231001` | `20231001` | `85` | `draft` |
| `2` | Pemrograman Web | `20231002` | `20231002` | `90` | `draft` |
| `3` | Pemrograman Web | `20231003` | `20231003` | `78` | `draft` |
| `4` | Kecerdasan Buatan | `20231001` | `20231001` | `88` | `draft` |
| `5` | Kecerdasan Buatan | `20231002` | `20231002` | `76` | `draft` |
| `6` | Kecerdasan Buatan | `20231003` | `20231003` | `92` | `draft` |

### 4.3 Transkrip

Ketiga mahasiswa memiliki transkrip awal berupa array kosong:

```json
{
  "nim": "20231001",
  "data_nilai": []
}
```

Transkrip akan terisi setelah dosen memfinalisasi kelas dan Service Nilai menyinkronkan data melalui gateway.

---

## 5. Contoh Login

Login memerlukan username, password, dan `X-Device-ID` yang terdaftar.

### PowerShell

```powershell
$body = @{
  username = "20231001"
  password = "Mhs#2026"
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/auth/login `
  -Headers @{ "X-Device-ID" = "device-20231001-01" } `
  -ContentType "application/json" `
  -Body $body

$login.user
$login.access_token
```

### curl (Linux/macOS)

```bash
curl -X POST http://127.0.0.1:3000/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: device-20231001-01" \
  -d '{"username":"20231001","password":"Mhs#2026"}'
```

Response login berisi `access_token` (10 menit), `refresh_token` (1 hari), dan data user. Untuk request berikutnya:

```http
Authorization: Bearer <access_token>
X-Device-ID: device-20231001-01
```

---

## 6. Endpoint Aktif

Kontrak lengkap ada di [`docs/API.md`](docs/API.md).

| Method | Path | Akses |
| :--- | :--- | :--- |
| `GET` | `/health` | Publik |
| `POST` | `/auth/login` | Username + password + `X-Device-ID` |
| `POST` | `/auth/refresh` | Refresh token + `X-Device-ID` |
| `POST` | `/auth/logout` | Refresh token + `X-Device-ID` |
| `POST` | `/auth/service` | Client ID + client secret |
| `GET` | `/nilai` | Mahasiswa sendiri, dosen kelas sendiri |
| `PUT` | `/nilai/:id` | Dosen pengampu, nilai draft, jam operasional |
| `POST` | `/kelas/:id/finalisasi` | Dosen pengampu, jam operasional |
| `GET` | `/transkrip/:nim` | Mahasiswa sendiri, admin semua |
| `POST` | `/transkrip/sinkron` | Service token `service-nilai` |

Catatan:

- Endpoint `PUT /nilai/:id` dan `POST /kelas/:id/finalisasi` hanya aktif pada `[07:00, 21:00)` Asia/Jakarta.
- Service token hanya boleh dipakai untuk `POST /transkrip/sinkron`.
- Port `3001` dan `3002` tidak dapat diakses dari host.

---

## 7. Postman dan Smoke Test

### Postman

File collection: [`postman/zero-trust-system.postman_collection.json`](postman/zero-trust-system.postman_collection.json)

Langkah:

1. Import collection ke Postman.
2. Jalankan folder `Health Check`.
3. Jalankan folder `Auth` untuk login admin/dosen/mahasiswa. Token disimpan otomatis.
4. Isi collection variable `service_client_secret` dengan nilai `SERVICE_CLIENT_SECRET` dari `.env` jika ingin menguji service token dan sinkronisasi.
5. Jalankan folder `Nilai`, `Transkrip`, lalu `Negative Cases`.

Setelah finalisasi, nilai kelas menjadi `final`. Reset database sebelum menjalankan collection ulang dari awal.

### Smoke test

Dengan stack berjalan:

```powershell
npm run test:smoke
```

Smoke test memeriksa login/device, ABAC nilai, refresh token rotation, logout, service token, sinkronisasi transkrip, finalisasi, dan pembacaan transkrip. Script ini mengubah data demo; reset database setelah selesai jika ingin state bersih.

---

## 8. Verifikasi Keamanan

```powershell
# Port internal harus tidak dapat diakses dari host
Invoke-WebRequest http://127.0.0.1:3001/health -TimeoutSec 3
Invoke-WebRequest http://127.0.0.1:3002/health -TimeoutSec 3

# Hanya gateway yang memiliki mapping host
docker compose ps

# Container berjalan sebagai non-root
docker compose exec gateway id
```

Uji double verification dari dalam container:

```powershell
# 403 invalid_gateway_secret
docker compose exec gateway node -e "fetch('http://service-nilai:3001/nilai').then(async (r) => console.log(r.status, await r.text()))"

# 401 missing_token
docker compose exec gateway node -e "fetch('http://service-nilai:3001/nilai',{headers:{'X-Gateway-Secret':process.env.GATEWAY_SECRET}}).then(async (r) => console.log(r.status, await r.text()))"
```

---

## 9. Environment Penting

| Variable | Default | Fungsi |
| :--- | :--- | :--- |
| `DATABASE_URL` | `file:../database/zerotrust.db` | SQLite; di Docker di-override ke `file:/app/database/zerotrust.db` |
| `JWT_SECRET` | wajib diisi | Signing key access/refresh/service token |
| `GATEWAY_SECRET` | wajib diisi | Nilai header `X-Gateway-Secret` |
| `SERVICE_CLIENT_ID` | `service-nilai` | Identitas service internal |
| `SERVICE_CLIENT_SECRET` | wajib diisi | Secret untuk `POST /auth/service` |
| `ACCESS_TOKEN_TTL` | `10m` | Masa berlaku access token |
| `REFRESH_TOKEN_TTL` | `1d` | Masa berlaku refresh token |
| `SERVICE_TOKEN_TTL` | `5m` | Masa berlaku service token |
| `OPERATIONAL_START_HOUR` | `7` | Awal jam operasional |
| `OPERATIONAL_END_HOUR` | `21` | Akhir jam operasional |
| `TZ` | `Asia/Jakarta` | Zona waktu pengecekan jam |
| `SEED_ON_START` | `true` | Jalankan seed saat gateway start |

`npm run env:init` membuat `.env` dari `.env.example` dan mengisi `JWT_SECRET`, `GATEWAY_SECRET`, serta `SERVICE_CLIENT_SECRET` dengan nilai acak. Jangan commit file `.env`.

---

## 10. Troubleshooting Singkat

| Masalah | Solusi |
| :--- | :--- |
| `401 device_id_required` | Tambahkan header `X-Device-ID` sesuai akun |
| `403 device_not_registered` | Gunakan device ID yang terdaftar untuk akun tersebut |
| `401 invalid_credentials` | Cek username/password demo |
| `403 outside_operational_hours` | Perubahan/finalisasi hanya `[07:00, 21:00)` Asia/Jakarta |
| `409 nilai_final` | Nilai sudah difinalisasi; reset database untuk mengulang |
| `403 service_token_required` | `/transkrip/sinkron` hanya menerima service token |
| `401 invalid_client` | Cek `SERVICE_CLIENT_ID` dan `SERVICE_CLIENT_SECRET` |
| Port 3001/3002 tidak bisa dibuka | Disengaja; gunakan `docker compose exec` |
| Ingin reset data demo | Hapus `database/zerotrust.db*`, lalu `docker compose up -d` |

---

## 11. Struktur Proyek

```text
zero-trust-system/
├── .env.example
├── docker-compose.yml
├── package.json
├── README.md
├── database/                    # shared SQLite volume
├── docs/
│   └── API.md
├── postman/
│   └── zero-trust-system.postman_collection.json
├── prisma/
│   ├── schema.prisma
│   ├── seed.js
│   └── migrations/
├── scripts/
│   ├── generate-env.js
│   └── smoke-test.js
├── gateway/
│   └── src/
├── service-nilai/
│   └── src/
└── service-transkrip/
    └── src/
```

Dokumentasi API lengkap: [`docs/API.md`](docs/API.md)

Panduan video demo 6–9 menit: [`docs/VIDEO_DEMO_GUIDE.md`](docs/VIDEO_DEMO_GUIDE.md)
