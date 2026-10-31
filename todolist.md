# TODO List - Sistem Nilai Zero Trust

Dokumen ini merangkum apa yang **sudah dibangun**, apa yang **baru sebagian**, dan apa yang **belum dibangun**.

**Terakhir diperbarui:** 2026-10-28  
**Status stack:** healthy, database dalam kondisi seed bersih  
**Cakupan PRD inti:** selesai

> **Cakupan penilaian praktikum:** mekanisme kontrol akses. Frontend tidak wajib; pengujian menggunakan Postman atau curl. Area **Admin & UI** dan **Production Readiness** tidak perlu dikerjakan karena di luar cakupan penilaian.

### Legend

- `[x]` Selesai dan sudah diuji
- `[ ]` Belum dibuat (opsional/pengembangan lanjutan)
- **Di luar cakupan** = tidak perlu dikerjakan atau dinilai
- **Sebagian** = fondasi sudah ada, tetapi belum lengkap

---

## Ringkasan Status

| Area | Status | Catatan |
| :--- | :--- | :--- |
| Fondasi monorepo & Docker | Selesai | 3 service, shared SQLite, network internal, non-root |
| Database & seed | Selesai | Migrasi, seed idempotent, 6 user/6 device/2 kelas/6 nilai |
| Gateway auth | Selesai | Login, refresh rotation, logout, service token |
| Gateway policy/ABAC | Selesai | Role, device, ownership, jam operasional |
| Audit log | Selesai | Allow/deny, fail-closed |
| Service Nilai | Selesai | GET nilai, PUT nilai, finalisasi |
| Service Transkrip | Selesai | GET transkrip, sinkronisasi service-to-service |
| Double verification | Selesai | Secret + JWT + device diverifikasi ulang |
| Dokumentasi & Postman | Selesai | README, docs/API, 29 request Postman |
| Automated test suite | Sebagian | Smoke test + Newman; unit/integration test otomatis belum |
| Admin CRUD & web UI | Di luar cakupan | Frontend tidak wajib; pengujian via Postman/curl |
| Production readiness | Di luar cakupan | PostgreSQL, CI/CD, TLS, observability, backup tidak dinilai |

---

## 1. Fondasi & Infrastruktur

### Selesai

- [x] Monorepo `gateway`, `service-nilai`, `service-transkrip`
- [x] Dockerfile terpisah untuk setiap service
- [x] Container berjalan sebagai user non-root `node`
- [x] Docker Compose dengan network internal `zt-network`
- [x] Hanya gateway yang mempublikasikan port ke host (`3000:3000`)
- [x] Service Nilai (`3001`) dan Service Transkrip (`3002`) hanya `expose`
- [x] Health check Docker untuk gateway dan kedua service
- [x] Dependency gateway/service saling terisolasi
- [x] Shared SQLite melalui bind mount `./database`
- [x] `.env.example`, generator `.env`, `.gitignore`, `.dockerignore`
- [x] Prisma schema, migration awal, dan seed idempotent
- [x] Script `npm run env:init`
- [x] Script `npm run test:smoke`
- [x] `README.md` berisi cara menjalankan, akun, device ID, dan data awal
- [x] `docs/API.md` berisi kontrak endpoint aktif
- [x] Collection Postman siap diimpor

### Catatan cakupan

Semua kebutuhan fondasi untuk praktikum sudah selesai. Item CI/CD, observability, TLS, dan deployment produksi tidak termasuk cakupan penilaian (lihat bagian 12).

---

## 2. Database & Seed

### Selesai

- [x] Model `User`
- [x] Model `Device`
- [x] Model `RefreshToken`
- [x] Model `Kelas`
- [x] Model `Nilai`
- [x] Model `Transkrip`
- [x] Model `AuditLog`
- [x] Seed 1 admin, 2 dosen, 3 mahasiswa
- [x] Seed 6 device (satu per user)
- [x] Password di-hash dengan bcrypt
- [x] Seed 2 kelas: Pemrograman Web dan Kecerdasan Buatan
- [x] Seed 6 nilai draft
- [x] Seed 3 transkrip kosong
- [x] Seed idempotent, aman dijalankan ulang
- [x] Data demo terdokumentasi di README

### Peningkatan opsional (tidak wajib)

- [ ] Kolom `nim` terpisah dari `username`
- [ ] Unique constraint `(userId, device_id)` pada tabel Device
- [ ] Model enrollment mahasiswa-kelas yang eksplisit
- [ ] Riwayat perubahan nilai per field (grade history)
- [ ] Metadata refresh token: device, waktu dibuat, waktu dicabut
- [ ] Index tambahan untuk audit dan query nilai
- [ ] Soft delete/status aktif untuk user dan kelas
- [ ] Audit log tamper-evident/immutable

---

## 3. Gateway - Autentikasi

### Selesai

- [x] `GET /health`
- [x] `POST /auth/login`
- [x] `POST /auth/refresh`
- [x] `POST /auth/logout`
- [x] `POST /auth/service`
- [x] Access token JWT HS256, 10 menit
- [x] Refresh token stateful, 1 hari
- [x] Refresh token disimpan sebagai hash SHA-256
- [x] Refresh token rotation: token lama langsung dicabut
- [x] Service token 5 menit dengan `role=service`
- [x] JWT issuer/audience/expiry divalidasi
- [x] Role token dicocokkan ulang dengan role user di database
- [x] Login wajib `X-Device-ID` yang terdaftar
- [x] Perbandingan secret constant-time
- [x] Password salah dan username tidak ditemukan menghasilkan pesan yang sama
- [x] `Cache-Control: no-store` pada response token

### Peningkatan opsional (tidak wajib)

- [ ] Rate limiting login
- [ ] Account lockout setelah percobaan gagal berulang
- [ ] MFA/2FA
- [ ] Access token revocation/denylist
- [ ] Deteksi refresh token reuse dan pencabutan seluruh token family
- [ ] Manajemen sesi multi-device
- [ ] Password policy dan reset password
- [ ] Rotasi password user melalui API

---

## 4. Gateway - Policy & Audit

### Selesai

- [x] Middleware autentikasi JWT
- [x] Validasi device context ke database
- [x] Role-based access control
- [x] ABAC kepemilikan kelas untuk `PUT /nilai/:id`
- [x] ABAC kepemilikan kelas untuk `POST /kelas/:id/finalisasi`
- [x] ABAC NIM sendiri untuk `GET /transkrip/:nim`
- [x] Admin boleh membaca transkrip semua mahasiswa
- [x] Dosen ditolak dari endpoint transkrip
- [x] Admin ditolak dari endpoint nilai
- [x] Cek nilai sudah `final`
- [x] Cek jam operasional `[07:00, 21:00)` Asia/Jakarta
- [x] Audit log setiap keputusan allow/deny
- [x] Audit subject, endpoint, device, keputusan, alasan
- [x] Fail-closed `503` jika audit allow gagal ditulis
- [x] Audit untuk login, refresh, logout, service token, dan resource
- [x] Fallback 404 untuk route tidak dikenal
- [x] Penolakan route resource yang tidak diizinkan

### Peningkatan opsional (tidak wajib)

- [ ] Admin audit viewer/dashboard
- [ ] Filter/pagination audit log
- [ ] Retensi dan rotasi audit log
- [ ] Request ID/correlation ID untuk tracing
- [ ] Structured JSON logging
- [ ] Metrics policy deny/allow
- [ ] Notifikasi anomali akses

---

## 5. Gateway - Proxy

### Selesai

- [x] Proxy `http-proxy-middleware` ke Service Nilai dan Service Transkrip
- [x] `X-Gateway-Secret` ditambahkan gateway
- [x] Header secret dari client ditimpa, bukan dipercaya
- [x] `fixRequestBody` untuk request JSON yang sudah diparse `express.json()`
- [x] Timeout proxy
- [x] Response `502 bad_gateway` jika upstream gagal
- [x] Path filter dipisah per service
- [x] Error handler terpusat
- [x] Body limit `100kb`

### Peningkatan opsional (tidak wajib)

- [ ] Retry/circuit breaker
- [ ] Load balancing multi-instance service
- [ ] Request/response logging terstruktur
- [ ] Rate limiting per client/IP
- [ ] API versioning
- [ ] OpenAPI/Swagger specification

---

## 6. Service Nilai

### Selesai

- [x] `GET /health`
- [x] Middleware double verification `X-Gateway-Secret`
- [x] Verifikasi ulang JWT signature/expiry/issuer/audience
- [x] Verifikasi ulang device context
- [x] `GET /nilai`
- [x] Mahasiswa hanya menerima nilai sendiri
- [x] Dosen hanya menerima nilai kelas yang diampu
- [x] `PUT /nilai/:id`
- [x] Validasi `skor` number 0-100
- [x] Cek dosen pengampu
- [x] Cek nilai masih draft
- [x] Cek jam operasional di service
- [x] Update nilai dalam transaksi database
- [x] `POST /kelas/:id/finalisasi`
- [x] Cek dosen pengampu dan jam operasional
- [x] Finalisasi seluruh nilai kelas dalam transaksi
- [x] Finalisasi idempotent
- [x] Ambil seluruh nilai final mahasiswa lintas kelas
- [x] Minta service token ke gateway
- [x] Sinkronisasi transkrip melalui gateway, bukan langsung ke service-transkrip
- [x] Response `502` jika finalisasi berhasil tetapi sinkronisasi gagal
- [x] Health check tetap dapat diakses Docker healthcheck

### Peningkatan opsional (tidak wajib)

- [ ] CRUD kelas
- [ ] Enrollment mahasiswa ke kelas
- [ ] Bulk import nilai (CSV/Excel)
- [ ] Pagination/filter/search nilai
- [ ] Grade history per perubahan
- [ ] Reopen kelas final / workflow koreksi nilai
- [ ] Chunking sinkronisasi untuk kelas besar
- [ ] Unit test dan integration test service
- [ ] Audit internal service (selain audit gateway)

---

## 7. Service Transkrip

### Selesai

- [x] `GET /health`
- [x] Middleware double verification `X-Gateway-Secret`
- [x] Verifikasi ulang JWT signature/expiry/issuer/audience
- [x] Verifikasi ulang device context untuk access token
- [x] `GET /transkrip/:nim`
- [x] Mahasiswa hanya dapat membaca NIM sendiri
- [x] Admin dapat membaca semua NIM mahasiswa
- [x] Dosen ditolak
- [x] `POST /transkrip/sinkron`
- [x] Hanya menerima service token `service-nilai`
- [x] Access token user ditolak
- [x] Validasi payload sinkronisasi
- [x] Validasi NIM unik dan role mahasiswa
- [x] Validasi `data_nilai` dan status final
- [x] Upsert transkrip dalam transaksi
- [x] Service Transkrip tidak memegang `SERVICE_CLIENT_SECRET`
- [x] Response transkrip kosong `[]` sebelum finalisasi

### Peningkatan opsional (tidak wajib)

- [ ] Export transkrip PDF
- [ ] Perhitungan IPK/IPS
- [ ] Format transkrip resmi
- [ ] Pagination/versioning transkrip
- [ ] Audit internal sinkronisasi transkrip
- [ ] Unit test dan integration test service

---

## 8. Keamanan

### Selesai

- [x] Gateway sebagai satu-satunya entry point publik
- [x] Port internal tidak dipublikasikan ke host
- [x] JWT algorithm dipin ke HS256
- [x] JWT issuer/audience/expiry divalidasi
- [x] `sub` dan `role` pada access token
- [x] `token_use` membedakan access dan service token
- [x] Device binding untuk access token
- [x] Role dicek ulang dari database
- [x] Double verification di kedua resource service
- [x] `X-Gateway-Secret` constant-time comparison
- [x] Least privilege: service-transkrip tanpa client secret
- [x] Service token hanya untuk endpoint sinkronisasi
- [x] Refresh token hash SHA-256
- [x] Refresh token rotation
- [x] Password bcrypt
- [x] Prisma mencegah SQL injection melalui query parameterized
- [x] Body limit dan validasi input dasar
- [x] Error response tidak membocorkan stack trace
- [x] Container non-root
- [x] Dependency audit `0 vulnerabilities`

### Peningkatan opsional (tidak wajib)

- [ ] Rate limiting dan brute-force protection
- [ ] MFA
- [ ] Access token revocation/denylist
- [ ] Refresh token reuse detection
- [ ] Security headers lengkap di semua service
- [ ] Pentest/security review formal

> TLS, secrets manager, mTLS, WAF, dan network policy produksi tidak termasuk cakupan penilaian (lihat bagian 12).

---

## 9. Testing

### Selesai

- [x] Smoke test end-to-end `scripts/smoke-test.js`
- [x] Smoke test 44 check dari kondisi seed bersih
- [x] Postman collection 29 request
- [x] Newman run 69 assertion, 0 gagal
- [x] Test login benar/salah
- [x] Test login tanpa device
- [x] Test device bukan milik user
- [x] Test GET nilai mahasiswa
- [x] Test GET nilai dosen
- [x] Test admin ditolak dari nilai
- [x] Test dosen lain ditolak mengubah nilai
- [x] Test skor invalid
- [x] Test finalisasi
- [x] Test nilai final tidak dapat diubah
- [x] Test transkrip sendiri
- [x] Test transkrip mahasiswa lain ditolak
- [x] Test admin membaca transkrip
- [x] Test dosen ditolak dari transkrip
- [x] Test service token
- [x] Test access token user ditolak dari sinkronisasi
- [x] Test refresh token rotation
- [x] Test logout mencabut refresh token
- [x] Test port internal tertutup dari host
- [x] Test direct access tanpa gateway secret
- [x] Test direct access dengan secret tanpa JWT
- [x] Test service token tidak dapat mengakses `/nilai`
- [x] Test jam operasional pada helper waktu
- [x] Test audit allow/deny
- [x] `npm audit --omit=dev` root dan ketiga service

### Peningkatan opsional (tidak wajib)

- [ ] Unit test otomatis dengan Jest/Vitest
- [ ] Integration test otomatis di repository
- [ ] Test coverage report
- [ ] Test token expired otomatis
- [ ] Test audit failure/fail-closed otomatis
- [ ] Test `502` sinkronisasi gagal otomatis
- [ ] Test boundary jam 07:00 dan 21:00 di runtime
- [ ] Load/performance test
- [ ] Security test otomatis (OWASP ZAP, dll.)

---

## 10. Dokumentasi

### Selesai

- [x] `README.md` dengan cara menjalankan, akun, device ID, data awal
- [x] `docs/API.md` dengan kontrak semua endpoint aktif
- [x] Contoh request/response
- [x] Tabel error dan reason
- [x] Instruksi Postman
- [x] Instruksi smoke test
- [x] Troubleshooting
- [x] Catatan audit log
- [x] Catatan jam operasional
- [x] Postman collection
- [x] Panduan video demo 6–9 menit (`docs/VIDEO_DEMO_GUIDE.md`)
- [x] `TODO List` ini

### Peningkatan opsional (tidak wajib)

- [ ] OpenAPI/Swagger spec
- [ ] ERD diagram
- [ ] Diagram arsitektur gambar
- [ ] Changelog
- [ ] Panduan kontribusi

---

## 11. Admin & UI - Di Luar Cakupan

> Dokumen tugas menyatakan penilaian berfokus pada mekanisme kontrol akses, bukan tampilan. Frontend tidak wajib; pengujian menggunakan Postman atau curl.

Item berikut **tidak perlu dikerjakan**:

| Item | Status |
| :--- | :--- |
| Web UI/dashboard | Di luar cakupan |
| Halaman login | Di luar cakupan |
| Dashboard admin | Di luar cakupan |
| CRUD user | Di luar cakupan |
| CRUD device | Di luar cakupan |
| Device enrollment mandiri | Di luar cakupan |
| CRUD kelas | Di luar cakupan |
| Enrollment mahasiswa ke kelas | Di luar cakupan |
| UI dosen untuk input/finalisasi nilai | Di luar cakupan |
| UI mahasiswa untuk melihat nilai/transkrip | Di luar cakupan |
| UI admin untuk melihat transkrip | Di luar cakupan |
| UI audit log | Di luar cakupan |
| Export laporan | Di luar cakupan |

---

## 12. Production Readiness - Di Luar Cakupan

> Item berikut tidak perlu dikerjakan untuk praktikum karena penilaian berfokus pada mekanisme kontrol akses.

| Item | Status |
| :--- | :--- |
| PostgreSQL/MySQL sebagai database produksi | Di luar cakupan |
| Redis untuk rate limit/session/cache | Di luar cakupan |
| Migrasi database sebagai job terpisah | Di luar cakupan |
| CI/CD pipeline | Di luar cakupan |
| Reverse proxy + TLS | Di luar cakupan |
| Secrets manager | Di luar cakupan |
| Backup dan restore otomatis | Di luar cakupan |
| Monitoring, metrics, dan alerting | Di luar cakupan |
| Log aggregation | Di luar cakupan |
| Tracing terdistribusi | Di luar cakupan |
| Horizontal scaling | Di luar cakupan |
| Health check readiness vs liveness terpisah | Di luar cakupan |
| Runbook insiden | Di luar cakupan |
| Disaster recovery plan | Di luar cakupan |

---

## 13. Fokus Penilaian & Verifikasi

Yang perlu dipastikan untuk praktikum:

1. **Jalankan stack** dengan `docker compose up -d` dan pastikan semua container healthy.
2. **Uji kontrol akses** menggunakan Postman atau curl, bukan UI.
3. **Tunjukkan skenario allow**: login dengan device benar, mahasiswa membaca nilai sendiri, dosen mengubah nilai draft kelasnya, dosen finalisasi, admin membaca transkrip.
4. **Tunjukkan skenario deny**: tanpa device, device salah, role salah, dosen bukan pengampu, nilai final, admin ke endpoint nilai, mahasiswa ke transkrip lain, access token ke endpoint sinkronisasi.
5. **Tunjukkan double verification**: akses langsung ke port 3001/3002 tanpa secret/JWT ditolak.
6. **Tunjukkan audit log** berisi keputusan allow/deny.
7. **Reset database** setelah pengujian yang mengubah data.

Item opsional yang tidak memengaruhi penilaian: unit test otomatis, OpenAPI, ERD, diagram, dan peningkatan skema lanjutan.

---

## 14. Cara Cepat Memverifikasi Status

```powershell
# Status container
docker compose ps

# Health gateway
Invoke-RestMethod http://127.0.0.1:3000/health

# Smoke test end-to-end (mengubah data demo)
npm run test:smoke

# Audit dependency
npm audit --omit=dev
npm --prefix gateway audit --omit=dev
npm --prefix service-nilai audit --omit=dev
npm --prefix service-transkrip audit --omit=dev
```

Reset database setelah pengujian yang mengubah data:

```powershell
docker compose down
Remove-Item database\zerotrust.db,database\zerotrust.db-wal,database\zerotrust.db-shm -ErrorAction SilentlyContinue
docker compose up -d
```
