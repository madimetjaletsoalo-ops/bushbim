-- CreateEnum
CREATE TYPE "bushbim"."IssueAttributeKind" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'LIST');

-- CreateTable
CREATE TABLE "bushbim"."Location" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."IssueType" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."IssueSubtype" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueSubtype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."IssueStatus" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."IssueRootCause" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueRootCause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."IssueAttribute" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "bushbim"."IssueAttributeKind" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."Issue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "typeId" TEXT,
    "subtypeId" TEXT,
    "statusId" TEXT NOT NULL,
    "assigneeType" "bushbim"."SubjectType",
    "assigneeId" TEXT,
    "dueDate" DATE,
    "locationId" TEXT,
    "rootCauseId" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."IssueWatcher" (
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueWatcher_pkey" PRIMARY KEY ("issueId","userId")
);

-- CreateTable
CREATE TABLE "bushbim"."IssueComment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_projectId_idx" ON "bushbim"."Location"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_projectId_parentId_name_key" ON "bushbim"."Location"("projectId", "parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "IssueType_projectId_name_key" ON "bushbim"."IssueType"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "IssueSubtype_typeId_name_key" ON "bushbim"."IssueSubtype"("typeId", "name");

-- CreateIndex
CREATE INDEX "IssueStatus_projectId_order_idx" ON "bushbim"."IssueStatus"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "IssueStatus_projectId_name_key" ON "bushbim"."IssueStatus"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "IssueRootCause_projectId_name_key" ON "bushbim"."IssueRootCause"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "IssueAttribute_projectId_name_key" ON "bushbim"."IssueAttribute"("projectId", "name");

-- CreateIndex
CREATE INDEX "Issue_projectId_statusId_idx" ON "bushbim"."Issue"("projectId", "statusId");

-- CreateIndex
CREATE INDEX "Issue_projectId_createdAt_idx" ON "bushbim"."Issue"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_projectId_number_key" ON "bushbim"."Issue"("projectId", "number");

-- CreateIndex
CREATE INDEX "IssueWatcher_userId_idx" ON "bushbim"."IssueWatcher"("userId");

-- CreateIndex
CREATE INDEX "IssueComment_issueId_createdAt_idx" ON "bushbim"."IssueComment"("issueId", "createdAt");

-- AddForeignKey
ALTER TABLE "bushbim"."Location" ADD CONSTRAINT "Location_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bushbim"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueType" ADD CONSTRAINT "IssueType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueSubtype" ADD CONSTRAINT "IssueSubtype_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "bushbim"."IssueType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueStatus" ADD CONSTRAINT "IssueStatus_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueStatus" ADD CONSTRAINT "IssueStatus_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bushbim"."IssueStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueRootCause" ADD CONSTRAINT "IssueRootCause_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueAttribute" ADD CONSTRAINT "IssueAttribute_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Issue" ADD CONSTRAINT "Issue_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "bushbim"."IssueType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Issue" ADD CONSTRAINT "Issue_subtypeId_fkey" FOREIGN KEY ("subtypeId") REFERENCES "bushbim"."IssueSubtype"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Issue" ADD CONSTRAINT "Issue_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "bushbim"."IssueStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Issue" ADD CONSTRAINT "Issue_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "bushbim"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Issue" ADD CONSTRAINT "Issue_rootCauseId_fkey" FOREIGN KEY ("rootCauseId") REFERENCES "bushbim"."IssueRootCause"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Issue" ADD CONSTRAINT "Issue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueWatcher" ADD CONSTRAINT "IssueWatcher_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "bushbim"."Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueWatcher" ADD CONSTRAINT "IssueWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bushbim"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueComment" ADD CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "bushbim"."Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssueComment" ADD CONSTRAINT "IssueComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
