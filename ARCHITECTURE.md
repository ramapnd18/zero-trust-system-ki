# Arsitektur Sistem & Spesifikasi Database

## 1. Tech Stack
*   **Gateway & Services:** Node.js (v18+) + Express.js
*   **Gateway Proxy:** `http-proxy-middleware`
*   **Database:** SQLite
*   **ORM:** Prisma Client
*   **Authentication:** `jsonwebtoken` (JWT)
*   **Deployment:** Docker Compose

## 2. Struktur Monorepo
```text
zero-trust-system/
├── docker-compose.yml
├── database/                # Shared volume untuk zerotrust.db
├── prisma/
│   └── schema.prisma        # Definisi database ORM
├── gateway/
│   ├── package.json
│   ├── Dockerfile
│   └── src/ (index.js, policy.js, routes/, dll)
├── service-nilai/
│   ├── package.json
│   ├── Dockerfile
│   └── src/ (index.js, routes/, dll)
└── service-transkrip/
    ├── package.json
    ├── Dockerfile
    └── src/ (index.js, routes/, dll)
```

## 3. Skema Database (Prisma)
Implementasikan skema berikut pada `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL") // "file:../database/zerotrust.db"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            Int            @id @default(autoincrement())
  username      String         @unique
  password_hash String
  role          String         // 'mahasiswa', 'dosen', 'admin'
  devices       Device[]
  refreshTokens RefreshToken[]
  kelasAmpu     Kelas[]        @relation("DosenKelas")
  nilai         Nilai[]
  transkrip     Transkrip?
}

model Device {
  id        Int    @id @default(autoincrement())
  device_id String // Menyimpan X-Device-ID
  user      User   @relation(fields: [userId], references: [id])
  userId    Int
}

model RefreshToken {
  id         Int      @id @default(autoincrement())
  token      String   @unique
  expires_at DateTime
  user       User     @relation(fields: [userId], references: [id])
  userId     Int
}

model Kelas {
  id               Int     @id @default(autoincrement())
  nama_mata_kuliah String
  dosen            User    @relation("DosenKelas", fields: [dosenId], references: [id])
  dosenId          Int
  nilai            Nilai[]
}

model Nilai {
  id           Int     @id @default(autoincrement())
  skor         Float
  status       String  // 'draft' atau 'final'
  kelas        Kelas   @relation(fields: [kelasId], references: [id])
  kelasId      Int
  mahasiswa    User    @relation(fields: [mahasiswaId], references: [id])
  mahasiswaId  Int
}

model Transkrip {
  id          Int    @id @default(autoincrement())
  data_nilai  String // JSON string / text
  mahasiswa   User   @relation(fields: [mahasiswaId], references: [id])
  mahasiswaId Int    @unique
}

model AuditLog {
  id        Int      @id @default(autoincrement())
  waktu     DateTime @default(now())
  subjek    String   
  endpoint  String
  device    String?
  keputusan String   // 'allow' atau 'deny'
  alasan    String
}
```

## 4. Docker Compose Setup
Semua servis berada dalam bridge network `zt-network`.
*   Gateway diekspos di port `3000:3000`.
*   Service Nilai berjalan di port `3001` (TIDAK diekspos ke host machine, hanya via network internal docker).
*   Service Transkrip berjalan di port `3002` (TIDAK diekspos ke host machine).
*   Gunakan volume `./database` yang di-mount ke masing-masing container untuk berbagi file SQLite.