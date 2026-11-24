-- CreateEnum
CREATE TYPE "bushbim"."ChecklistItemKind" AS ENUM ('YES_NO', 'TEXT', 'NUMBER', 'DATE', 'SIGNATURE', 'PHOTO');

-- CreateEnum
CREATE TYPE "bushbim"."ChecklistStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "bushbim"."Photo" ADD COLUMN     "checklistItemId" TEXT;

-- CreateTable
CREATE TABLE "bushbim"."ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."ChecklistTemplateSection" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistTemplateSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "bushbim"."ChecklistItemKind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."Checklist" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "status" "bushbim"."ChecklistStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assigneeType" "bushbim"."SubjectType",
    "assigneeId" TEXT,
    "locationId" TEXT,
    "dueDate" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."ChecklistSection" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."ChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "bushbim"."ChecklistItemKind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "value" TEXT,
    "note" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "issueId" TEXT,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_projectId_name_key" ON "bushbim"."ChecklistTemplate"("projectId", "name");

-- CreateIndex
CREATE INDEX "ChecklistTemplateSection_templateId_order_idx" ON "bushbim"."ChecklistTemplateSection"("templateId", "order");

-- CreateIndex
CREATE INDEX "ChecklistTemplateItem_sectionId_order_idx" ON "bushbim"."ChecklistTemplateItem"("sectionId", "order");

-- CreateIndex
CREATE INDEX "Checklist_projectId_status_idx" ON "bushbim"."Checklist"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_projectId_number_key" ON "bushbim"."Checklist"("projectId", "number");

-- CreateIndex
CREATE INDEX "ChecklistSection_checklistId_order_idx" ON "bushbim"."ChecklistSection"("checklistId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_issueId_key" ON "bushbim"."ChecklistItem"("issueId");

-- CreateIndex
CREATE INDEX "ChecklistItem_checklistId_order_idx" ON "bushbim"."ChecklistItem"("checklistId", "order");

-- CreateIndex
CREATE INDEX "Photo_checklistItemId_idx" ON "bushbim"."Photo"("checklistItemId");

-- AddForeignKey
ALTER TABLE "bushbim"."Photo" ADD CONSTRAINT "Photo_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "bushbim"."ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistTemplateSection" ADD CONSTRAINT "ChecklistTemplateSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "bushbim"."ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "bushbim"."ChecklistTemplateSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Checklist" ADD CONSTRAINT "Checklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Checklist" ADD CONSTRAINT "Checklist_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "bushbim"."ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Checklist" ADD CONSTRAINT "Checklist_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "bushbim"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Checklist" ADD CONSTRAINT "Checklist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Checklist" ADD CONSTRAINT "Checklist_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistSection" ADD CONSTRAINT "ChecklistSection_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "bushbim"."Checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistItem" ADD CONSTRAINT "ChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "bushbim"."Checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistItem" ADD CONSTRAINT "ChecklistItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "bushbim"."ChecklistSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistItem" ADD CONSTRAINT "ChecklistItem_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ChecklistItem" ADD CONSTRAINT "ChecklistItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "bushbim"."Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
