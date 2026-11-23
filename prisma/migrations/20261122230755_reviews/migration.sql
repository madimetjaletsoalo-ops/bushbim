-- CreateEnum
CREATE TYPE "bushbim"."ReviewOutcome" AS ENUM ('APPROVED', 'APPROVED_WITH_COMMENTS', 'REVISE_RESUBMIT', 'REJECTED');

-- CreateEnum
CREATE TYPE "bushbim"."ReviewStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "bushbim"."ReviewStepMode" AS ENUM ('ANY', 'ALL');

-- CreateTable
CREATE TABLE "bushbim"."ReviewWorkflow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "statuses" JSONB NOT NULL,
    "initiators" JSONB NOT NULL DEFAULT '[]',
    "autoStartFolderId" TEXT,
    "approvedFolderId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."ReviewWorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "reviewers" JSONB NOT NULL,
    "mode" "bushbim"."ReviewStepMode" NOT NULL DEFAULT 'ANY',
    "days" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "ReviewWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."Review" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "bushbim"."ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "stepDueAt" TIMESTAMP(3),
    "initiatorId" TEXT,
    "autoStarted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."ReviewDocument" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "outcome" "bushbim"."ReviewOutcome",
    "copiedVersionId" TEXT,

    CONSTRAINT "ReviewDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."ReviewDecision" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reviewDocumentId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "outcome" "bushbim"."ReviewOutcome" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewWorkflow_autoStartFolderId_idx" ON "bushbim"."ReviewWorkflow"("autoStartFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewWorkflow_projectId_name_key" ON "bushbim"."ReviewWorkflow"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewWorkflowStep_workflowId_order_key" ON "bushbim"."ReviewWorkflowStep"("workflowId", "order");

-- CreateIndex
CREATE INDEX "Review_projectId_status_idx" ON "bushbim"."Review"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Review_projectId_number_key" ON "bushbim"."Review"("projectId", "number");

-- CreateIndex
CREATE INDEX "ReviewDocument_versionId_idx" ON "bushbim"."ReviewDocument"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDocument_reviewId_versionId_key" ON "bushbim"."ReviewDocument"("reviewId", "versionId");

-- CreateIndex
CREATE INDEX "ReviewDecision_reviewId_step_idx" ON "bushbim"."ReviewDecision"("reviewId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_reviewDocumentId_step_reviewerId_key" ON "bushbim"."ReviewDecision"("reviewDocumentId", "step", "reviewerId");

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewWorkflow" ADD CONSTRAINT "ReviewWorkflow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewWorkflow" ADD CONSTRAINT "ReviewWorkflow_autoStartFolderId_fkey" FOREIGN KEY ("autoStartFolderId") REFERENCES "bushbim"."Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewWorkflow" ADD CONSTRAINT "ReviewWorkflow_approvedFolderId_fkey" FOREIGN KEY ("approvedFolderId") REFERENCES "bushbim"."Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewWorkflowStep" ADD CONSTRAINT "ReviewWorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "bushbim"."ReviewWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Review" ADD CONSTRAINT "Review_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Review" ADD CONSTRAINT "Review_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "bushbim"."ReviewWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Review" ADD CONSTRAINT "Review_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewDocument" ADD CONSTRAINT "ReviewDocument_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "bushbim"."Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewDocument" ADD CONSTRAINT "ReviewDocument_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "bushbim"."DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "bushbim"."Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewDocumentId_fkey" FOREIGN KEY ("reviewDocumentId") REFERENCES "bushbim"."ReviewDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "bushbim"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
