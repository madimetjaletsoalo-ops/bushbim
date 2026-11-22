-- CreateEnum
CREATE TYPE "bushbim"."MarkupType" AS ENUM ('PEN', 'RECT', 'CLOUD', 'ARROW', 'TEXT', 'LENGTH', 'AREA');

-- CreateEnum
CREATE TYPE "bushbim"."MarkupStatus" AS ENUM ('PRIVATE', 'PUBLISHED');

-- CreateTable
CREATE TABLE "bushbim"."Markup" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "type" "bushbim"."MarkupType" NOT NULL,
    "points" JSONB NOT NULL,
    "color" TEXT NOT NULL,
    "text" TEXT,
    "status" "bushbim"."MarkupStatus" NOT NULL DEFAULT 'PRIVATE',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Markup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."SheetCalibration" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "unitsPerPoint" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Markup_versionId_page_idx" ON "bushbim"."Markup"("versionId", "page");

-- CreateIndex
CREATE UNIQUE INDEX "SheetCalibration_versionId_page_key" ON "bushbim"."SheetCalibration"("versionId", "page");

-- AddForeignKey
ALTER TABLE "bushbim"."Markup" ADD CONSTRAINT "Markup_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "bushbim"."DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Markup" ADD CONSTRAINT "Markup_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."SheetCalibration" ADD CONSTRAINT "SheetCalibration_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "bushbim"."DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."SheetCalibration" ADD CONSTRAINT "SheetCalibration_setById_fkey" FOREIGN KEY ("setById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
