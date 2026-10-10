-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('PAYMENTS', 'BANK_TRANSACTIONS', 'ACCOUNTS', 'RATES');

-- CreateEnum
CREATE TYPE "FaultStatus" AS ENUM ('PENDING', 'APPROVED', 'EDITED', 'REJECTED', 'SAVED_TO_TARGET');

-- CreateTable
CREATE TABLE "ProcessingFile" (
    "fileName" TEXT NOT NULL,
    "originalName" TEXT,
    "storedPath" TEXT NOT NULL,
    "fileType" "FileType" NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'QUEUED',
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recordCount" INTEGER,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successfulRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "predictedDurationMs" INTEGER,
    "actualDurationMs" INTEGER,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingFile_pkey" PRIMARY KEY ("fileName")
);

-- CreateTable
CREATE TABLE "FaultLog" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "colNumber" INTEGER,
    "columnName" TEXT NOT NULL,
    "cellValue" TEXT,
    "errorMessage" TEXT NOT NULL,
    "errorType" TEXT,
    "rawRowData" JSONB,
    "aiSuggestion" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiExplanation" TEXT,
    "status" "FaultStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedValue" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "targetTable" "FileType",
    "targetRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaultLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anomaly" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "anomalyType" TEXT NOT NULL,
    "description" TEXT,
    "score" DOUBLE PRECISION,
    "details" JSONB,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "accountNumber" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "accountStatus" TEXT NOT NULL,
    "ifscCode" VARCHAR(11) NOT NULL,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("accountNumber")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "transactionId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "description" TEXT,
    "ifscCode" VARCHAR(11),
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("transactionId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "paymentId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "ifscCode" VARCHAR(11),
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("paymentId")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "rateId" TEXT NOT NULL,
    "currencyPair" VARCHAR(7) NOT NULL,
    "rateDate" DATE NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "rateType" VARCHAR(4) NOT NULL,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessingFile_status_idx" ON "ProcessingFile"("status");

-- CreateIndex
CREATE INDEX "ProcessingFile_fileType_idx" ON "ProcessingFile"("fileType");

-- CreateIndex
CREATE INDEX "FaultLog_fileId_status_idx" ON "FaultLog"("fileId", "status");

-- CreateIndex
CREATE INDEX "FaultLog_rowNumber_idx" ON "FaultLog"("rowNumber");

-- CreateIndex
CREATE INDEX "FaultLog_status_idx" ON "FaultLog"("status");

-- CreateIndex
CREATE INDEX "FaultLog_columnName_idx" ON "FaultLog"("columnName");

-- CreateIndex
CREATE INDEX "Anomaly_fileId_idx" ON "Anomaly"("fileId");

-- CreateIndex
CREATE INDEX "Account_fileId_idx" ON "Account"("fileId");

-- CreateIndex
CREATE INDEX "Account_currency_idx" ON "Account"("currency");

-- CreateIndex
CREATE INDEX "Account_accountStatus_idx" ON "Account"("accountStatus");

-- CreateIndex
CREATE INDEX "Account_ifscCode_idx" ON "Account"("ifscCode");

-- CreateIndex
CREATE INDEX "BankTransaction_fileId_idx" ON "BankTransaction"("fileId");

-- CreateIndex
CREATE INDEX "BankTransaction_accountNumber_idx" ON "BankTransaction"("accountNumber");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDate_idx" ON "BankTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionType_idx" ON "BankTransaction"("transactionType");

-- CreateIndex
CREATE INDEX "Payment_fileId_idx" ON "Payment"("fileId");

-- CreateIndex
CREATE INDEX "Payment_accountNumber_idx" ON "Payment"("accountNumber");

-- CreateIndex
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");

-- CreateIndex
CREATE INDEX "Payment_paymentStatus_idx" ON "Payment"("paymentStatus");

-- CreateIndex
CREATE INDEX "ExchangeRate_fileId_idx" ON "ExchangeRate"("fileId");

-- CreateIndex
CREATE INDEX "ExchangeRate_rateDate_currencyPair_idx" ON "ExchangeRate"("rateDate", "currencyPair");

-- CreateIndex
CREATE INDEX "ExchangeRate_rateId_idx" ON "ExchangeRate"("rateId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_currencyPair_rateDate_rateType_key" ON "ExchangeRate"("currencyPair", "rateDate", "rateType");

-- AddForeignKey
ALTER TABLE "FaultLog" ADD CONSTRAINT "FaultLog_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProcessingFile"("fileName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProcessingFile"("fileName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProcessingFile"("fileName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProcessingFile"("fileName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountNumber_fkey" FOREIGN KEY ("accountNumber") REFERENCES "Account"("accountNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProcessingFile"("fileName") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountNumber_fkey" FOREIGN KEY ("accountNumber") REFERENCES "Account"("accountNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProcessingFile"("fileName") ON DELETE SET NULL ON UPDATE CASCADE;
