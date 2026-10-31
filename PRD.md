# Product Requirements Document (PRD) - Sistem Nilai Zero Trust

## 1. Tujuan Sistem
Membangun Sistem Nilai untuk program studi Informatika yang menerapkan tiga prinsip utama Zero Trust (*never trust, always verify; least privilege; assume breach*) langsung di level aplikasi. Sistem memisahkan *Policy Enforcement Point* (PEP) di API Gateway dengan *Resource* di level *service* sesuai standar NIST SP 800-207.

## 2. Arsitektur Makro
Sistem beroperasi menggunakan topologi jaringan internal terisolasi dengan komponen berikut:
*   **API Gateway (Port 3000):** Bertindak sebagai PEP (satu-satunya pintu masuk) dan *Policy Engine/Policy Administrator* (PE/PA) yang mengevaluasi login, token, kebijakan akses, membaca atribut database, dan mencatat *audit log*.
*   **Service Nilai (Port 3001):** Bertindak sebagai *Resource* untuk mengelola data nilai dan kelas.
*   **Service Transkrip (Port 3002):** Bertindak sebagai *Resource* untuk mengelola data transkrip mahasiswa.
*   **Database Bersama:** Satu *database* terpusat yang diakses oleh Gateway dan kedua *service* untuk validasi atribut dan penyimpanan data.

## 3. Matriks Peran dan Hak Akses (Least Privilege)
| Role | Hak Akses |
| :--- | :--- |
| **Mahasiswa** | Melihat nilai dan transkrip miliknya sendiri. |
| **Dosen** | Melihat, mengubah, dan memfinalisasi nilai *hanya* pada kelas yang diampunya. |
| **Admin** | Melihat transkrip seluruh mahasiswa. |
| **Service (Internal)** | Hanya Service Nilai yang diizinkan memanggil *endpoint* sinkronisasi transkrip. |

## 4. Kebutuhan Fungsional Utama

### 4.1 Autentikasi dan Manajemen Token
*   **Access Token:** Berbasis JWT dengan masa berlaku 10 menit, wajib berisi *payload* `sub` (identitas user ID) dan `role`. Dikirim via *header* `Authorization: Bearer <token>`.
*   **Refresh Token:** Masa berlaku 1 hari, berstatus *stateful* (disimpan di database) agar dapat dicabut saat *logout*.
*   **Token Service:** Diperoleh Service Nilai melalui `POST /auth/service` menggunakan *Client ID* dan *Secret*, berlaku 5 menit dengan *role: service*.

### 4.2 Verifikasi Konteks Tambahan
*   **Device ID:** Setiap *request* wajib membawa *header* `X-Device-ID`. Sistem akan menolak akses jika *device* tidak terdaftar untuk *user* bersangkutan.
*   **Jam Operasional:** Perubahan (PUT) dan finalisasi (POST) nilai oleh dosen hanya diizinkan pada pukul 07.00 - 21.00 (waktu ini dapat dikonfigurasi).

### 4.3 Spesifikasi Endpoint
*   **Gateway Handling:**
    *   `POST /auth/login`: Kredensial valid & *device* terdaftar.
    *   `POST /auth/refresh` & `POST /auth/logout`: Refresh token valid & belum dicabut.
    *   `POST /auth/service`: Memerlukan *Client ID* dan *Secret* yang valid (khusus Service Nilai).
*   **Service Nilai Handling:**
    *   `GET /nilai`: Mahasiswa (nilai miliknya), Dosen (kelas yang diampunya).
    *   `PUT /nilai/:id`: Dosen pengampu, nilai belum final, dalam jam akses operasional.
    *   `POST /kelas/:id/finalisasi`: Dosen pengampu, dalam jam akses. Memanggil sinkronisasi ke Service Transkrip.
*   **Service Transkrip Handling:**
    *   `GET /transkrip/:nim`: Mahasiswa (hanya NIM sendiri), Admin (semua NIM).
    *   `POST /transkrip/sinkron`: Hanya menerima token *service*; akses *user* biasa ditolak.

## 5. Kebutuhan Keamanan (Assume Breach) & Log
*   **Lapisan Gateway Secret:** API Gateway wajib menyisipkan *header* `X-Gateway-Secret` sebelum meneruskan (*proxying*) *request* ke *service*.
*   **Verifikasi Ganda (Double Verification):** Service Nilai dan Service Transkrip dilarang mempercayai *request* secara otomatis. Service wajib menolak *request* tanpa `X-Gateway-Secret` dan wajib memverifikasi ulang tanda tangan (*signature*) serta masa berlaku token JWT.
*   **Audit Log Terpusat:** Gateway wajib mencatat setiap keputusan akses (waktu, subjek, *endpoint*, *device*, keputusan *allow/deny*, dan alasan) ke dalam database.