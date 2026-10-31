-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Device" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "device_id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Kelas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nama_mata_kuliah" TEXT NOT NULL,
    "dosenId" INTEGER NOT NULL,
    CONSTRAINT "Kelas_dosenId_fkey" FOREIGN KEY ("dosenId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Nilai" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skor" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "kelasId" INTEGER NOT NULL,
    "mahasiswaId" INTEGER NOT NULL,
    CONSTRAINT "Nilai_kelasId_fkey" FOREIGN KEY ("kelasId") REFERENCES "Kelas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Nilai_mahasiswaId_fkey" FOREIGN KEY ("mahasiswaId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transkrip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "data_nilai" TEXT NOT NULL,
    "mahasiswaId" INTEGER NOT NULL,
    CONSTRAINT "Transkrip_mahasiswaId_fkey" FOREIGN KEY ("mahasiswaId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "waktu" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjek" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "device" TEXT,
    "keputusan" TEXT NOT NULL,
    "alasan" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Transkrip_mahasiswaId_key" ON "Transkrip"("mahasiswaId");
