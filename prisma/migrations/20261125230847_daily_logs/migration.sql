-- CreateEnum
CREATE TYPE "bushbim"."DailyLogItemKind" AS ENUM ('YES_NO', 'TEXT', 'NUMBER');

-- CreateEnum
CREATE TYPE "bushbim"."DailyLogStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "bushbim"."WeatherSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "bushbim"."Photo" ADD COLUMN     "dailyLogId" TEXT;

-- AlterTable
ALTER TABLE "bushbim"."Project" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "bushbim"."DailyLogSettings" (
    "projectId" TEXT NOT NULL,
    "workLogRequired" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLogSettings_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "bushbim"."DailyLogTemplateItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "bushbim"."DailyLogItemKind" NOT NULL DEFAULT 'YES_NO',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLogTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."DailyLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "bushbim"."DailyLogStatus" NOT NULL DEFAULT 'DRAFT',
    "weatherSource" "bushbim"."WeatherSource",
    "weatherCode" INTEGER,
    "conditions" TEXT,
    "tempMin" DOUBLE PRECISION,
    "tempMax" DOUBLE PRECISION,
    "precipitation" DOUBLE PRECISION,
    "windMax" DOUBLE PRECISION,
    "weatherNote" TEXT,
    "workSummary" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."DailyLogLabour" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "companyId" TEXT,
    "companyName" TEXT NOT NULL,
    "trade" TEXT,
    "headcount" INTEGER NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "work" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLogLabour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."DailyLogEquipment" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "hours" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLogEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."DailyLogVisitor" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organisation" TEXT,
    "purpose" TEXT,
    "arrivedAt" TEXT,
    "leftAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLogVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."DailyLogItem" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "bushbim"."DailyLogItemKind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "value" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "DailyLogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyLogTemplateItem_projectId_order_idx" ON "bushbim"."DailyLogTemplateItem"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_projectId_date_key" ON "bushbim"."DailyLog"("projectId", "date");

-- CreateIndex
CREATE INDEX "DailyLogLabour_logId_idx" ON "bushbim"."DailyLogLabour"("logId");

-- CreateIndex
CREATE INDEX "DailyLogEquipment_logId_idx" ON "bushbim"."DailyLogEquipment"("logId");

-- CreateIndex
CREATE INDEX "DailyLogVisitor_logId_idx" ON "bushbim"."DailyLogVisitor"("logId");

-- CreateIndex
CREATE INDEX "DailyLogItem_logId_order_idx" ON "bushbim"."DailyLogItem"("logId", "order");

-- CreateIndex
CREATE INDEX "Photo_dailyLogId_idx" ON "bushbim"."Photo"("dailyLogId");

-- AddForeignKey
ALTER TABLE "bushbim"."Photo" ADD CONSTRAINT "Photo_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "bushbim"."DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogSettings" ADD CONSTRAINT "DailyLogSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogTemplateItem" ADD CONSTRAINT "DailyLogTemplateItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLog" ADD CONSTRAINT "DailyLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLog" ADD CONSTRAINT "DailyLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLog" ADD CONSTRAINT "DailyLog_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogLabour" ADD CONSTRAINT "DailyLogLabour_logId_fkey" FOREIGN KEY ("logId") REFERENCES "bushbim"."DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogLabour" ADD CONSTRAINT "DailyLogLabour_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "bushbim"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogLabour" ADD CONSTRAINT "DailyLogLabour_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogEquipment" ADD CONSTRAINT "DailyLogEquipment_logId_fkey" FOREIGN KEY ("logId") REFERENCES "bushbim"."DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogVisitor" ADD CONSTRAINT "DailyLogVisitor_logId_fkey" FOREIGN KEY ("logId") REFERENCES "bushbim"."DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogItem" ADD CONSTRAINT "DailyLogItem_logId_fkey" FOREIGN KEY ("logId") REFERENCES "bushbim"."DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."DailyLogItem" ADD CONSTRAINT "DailyLogItem_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
