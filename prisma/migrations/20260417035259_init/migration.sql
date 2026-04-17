-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "namaLengkap" TEXT,
    "nik" TEXT,
    "noHp" TEXT,
    "perusahaan" TEXT,
    "loker" TEXT,
    "atasanTif" TEXT,
    "role" TEXT NOT NULL,
    "isRegistered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNumber" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "customer" TEXT NOT NULL,
    "kodePerangkat" TEXT NOT NULL,
    "noTiket" TEXT NOT NULL,
    "layanan" TEXT NOT NULL,
    "witelSto" TEXT NOT NULL,
    "datekMetro" TEXT NOT NULL,
    "requesterNik" TEXT NOT NULL,
    "requesterUsername" TEXT NOT NULL,
    "requesterRole" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "acceptedBy" TEXT,
    "acceptedAt" DATETIME,
    "completedBy" TEXT,
    "completedAt" DATETIME,
    "cancelledBy" TEXT,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_chatId_orderNumber_key" ON "Order"("chatId", "orderNumber");
