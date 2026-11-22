-- CreateEnum
CREATE TYPE "bushbim"."FolderRoot" AS ENUM ('PLANS', 'PROJECT_FILES');

-- CreateTable
CREATE TABLE "bushbim"."Folder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "root" "bushbim"."FolderRoot",
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "size" INTEGER NOT NULL DEFAULT 0,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_projectId_idx" ON "bushbim"."Folder"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_projectId_root_key" ON "bushbim"."Folder"("projectId", "root");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_parentId_name_key" ON "bushbim"."Folder"("parentId", "name");

-- CreateIndex
CREATE INDEX "Document_projectId_idx" ON "bushbim"."Document"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_folderId_nameKey_key" ON "bushbim"."Document"("folderId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "bushbim"."DocumentVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_number_key" ON "bushbim"."DocumentVersion"("documentId", "number");

-- AddForeignKey
ALTER TABLE "bushbim"."Folder" ADD CONSTRAINT "Folder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bushbim"."Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Folder" ADD CONSTRAINT "Folder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "bushbim"."Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "bushbim"."Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing project gets its two root folders.
INSERT INTO "bushbim"."Folder" ("id", "projectId", "parentId", "root", "name", "createdAt", "updatedAt")
SELECT 'root_' || replace(gen_random_uuid()::text, '-', ''), p."id", NULL, r.root::"bushbim"."FolderRoot", r.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "bushbim"."Project" p
CROSS JOIN (VALUES ('PLANS', 'Plans'), ('PROJECT_FILES', 'Project Files')) AS r(root, name)
ON CONFLICT ("projectId", "root") DO NOTHING;
