/*
  Warnings:

  - Added the required column `orderNumber` to the `LayawaySale` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LayawaySale" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "orderReference" TEXT,
    "initialDate" DATETIME NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL DEFAULT 0,
    "allowedInstallments" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_LayawaySale" ("allowedInstallments", "createdAt", "customerName", "downPaymentCents", "id", "initialDate", "orderReference", "productDescription", "shop", "totalCents") SELECT "allowedInstallments", "createdAt", "customerName", "downPaymentCents", "id", "initialDate", "orderReference", "productDescription", "shop", "totalCents" FROM "LayawaySale";
DROP TABLE "LayawaySale";
ALTER TABLE "new_LayawaySale" RENAME TO "LayawaySale";
CREATE INDEX "LayawaySale_shop_initialDate_idx" ON "LayawaySale"("shop", "initialDate");
CREATE UNIQUE INDEX "LayawaySale_shop_orderNumber_key" ON "LayawaySale"("shop", "orderNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
