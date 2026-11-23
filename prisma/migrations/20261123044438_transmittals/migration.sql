-- CreateTable
CREATE TABLE "bushbim"."Transmittal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT,
    "senderId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transmittal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."TransmittalDocument" (
    "id" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "versionId" TEXT,
    "fileName" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "TransmittalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."TransmittalRecipient" (
    "id" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "firstOpenedAt" TIMESTAMP(3),

    CONSTRAINT "TransmittalRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."TransmittalDownload" (
    "id" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransmittalDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transmittal_projectId_createdAt_idx" ON "bushbim"."Transmittal"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transmittal_projectId_number_key" ON "bushbim"."Transmittal"("projectId", "number");

-- CreateIndex
CREATE INDEX "TransmittalDocument_versionId_idx" ON "bushbim"."TransmittalDocument"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "TransmittalDocument_transmittalId_versionId_key" ON "bushbim"."TransmittalDocument"("transmittalId", "versionId");

-- CreateIndex
CREATE INDEX "TransmittalRecipient_userId_idx" ON "bushbim"."TransmittalRecipient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TransmittalRecipient_transmittalId_email_key" ON "bushbim"."TransmittalRecipient"("transmittalId", "email");

-- CreateIndex
CREATE INDEX "TransmittalDownload_transmittalId_createdAt_idx" ON "bushbim"."TransmittalDownload"("transmittalId", "createdAt");

-- AddForeignKey
ALTER TABLE "bushbim"."Transmittal" ADD CONSTRAINT "Transmittal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Transmittal" ADD CONSTRAINT "Transmittal_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TransmittalDocument" ADD CONSTRAINT "TransmittalDocument_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "bushbim"."Transmittal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TransmittalDocument" ADD CONSTRAINT "TransmittalDocument_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "bushbim"."DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TransmittalRecipient" ADD CONSTRAINT "TransmittalRecipient_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "bushbim"."Transmittal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TransmittalRecipient" ADD CONSTRAINT "TransmittalRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TransmittalDownload" ADD CONSTRAINT "TransmittalDownload_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "bushbim"."Transmittal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TransmittalDownload" ADD CONSTRAINT "TransmittalDownload_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "bushbim"."TransmittalRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TransmittalDownload" ADD CONSTRAINT "TransmittalDownload_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "bushbim"."TransmittalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
