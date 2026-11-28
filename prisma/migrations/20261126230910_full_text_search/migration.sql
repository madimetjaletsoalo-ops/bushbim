-- CreateEnum
CREATE TYPE "bushbim"."TextIndexStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "bushbim"."TextIndexMethod" AS ENUM ('PDF_TEXT', 'OCR', 'DOCX', 'XLSX', 'TEXT', 'NONE');

-- CreateTable
CREATE TABLE "bushbim"."DocumentText" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "bushbim"."TextIndexStatus" NOT NULL DEFAULT 'PENDING',
    "method" "bushbim"."TextIndexMethod",
    "text" TEXT NOT NULL DEFAULT '',
    "chars" INTEGER NOT NULL DEFAULT 0,
    "pages" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "search" tsvector,

    CONSTRAINT "DocumentText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentText_versionId_key" ON "bushbim"."DocumentText"("versionId");

-- CreateIndex
CREATE INDEX "DocumentText_projectId_status_idx" ON "bushbim"."DocumentText"("projectId", "status");

-- CreateIndex
CREATE INDEX "DocumentText_status_updatedAt_idx" ON "bushbim"."DocumentText"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "DocumentText_search_idx" ON "bushbim"."DocumentText" USING GIN ("search");

-- AddForeignKey
ALTER TABLE "bushbim"."DocumentText" ADD CONSTRAINT "DocumentText_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DocumentText" ADD CONSTRAINT "DocumentText_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "bushbim"."DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: queue the latest version of every existing document for the background indexer.
INSERT INTO "bushbim"."DocumentText" ("id", "projectId", "versionId", "status", "updatedAt")
SELECT 'dt' || md5(v."id"), d."projectId", v."id", 'PENDING', CURRENT_TIMESTAMP
FROM "bushbim"."DocumentVersion" v
JOIN "bushbim"."Document" d ON d."id" = v."documentId" AND d."currentVersion" = v."number"
ON CONFLICT ("versionId") DO NOTHING;
