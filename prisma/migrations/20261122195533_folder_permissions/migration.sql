-- CreateEnum
CREATE TYPE "bushbim"."FolderLevel" AS ENUM ('NONE', 'VIEW', 'VIEW_DOWNLOAD', 'UPLOAD', 'EDIT', 'MANAGE');

-- CreateEnum
CREATE TYPE "bushbim"."FolderSubjectType" AS ENUM ('DEFAULT', 'USER', 'ROLE', 'COMPANY');

-- CreateTable
CREATE TABLE "bushbim"."FolderPermission" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "subjectType" "bushbim"."FolderSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "level" "bushbim"."FolderLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FolderPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FolderPermission_folderId_idx" ON "bushbim"."FolderPermission"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderPermission_folderId_subjectType_subjectId_key" ON "bushbim"."FolderPermission"("folderId", "subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "bushbim"."FolderPermission" ADD CONSTRAINT "FolderPermission_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "bushbim"."Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
