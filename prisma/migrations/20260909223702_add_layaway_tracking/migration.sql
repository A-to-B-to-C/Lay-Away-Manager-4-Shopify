-- CreateTable
CREATE TABLE "LayawaySale" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "orderReference" TEXT,
    "initialDate" DATETIME NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL DEFAULT 0,
    "allowedInstallments" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LayawayInstallment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "saleId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LayawayInstallment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "LayawaySale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LayawaySale_shop_initialDate_idx" ON "LayawaySale"("shop", "initialDate");

-- CreateIndex
CREATE INDEX "LayawayInstallment_saleId_paidAt_idx" ON "LayawayInstallment"("saleId", "paidAt");
