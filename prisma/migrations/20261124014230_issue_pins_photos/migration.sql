-- CreateTable
CREATE TABLE "bushbim"."IssuePin" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuePin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."Photo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "issueId" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuePin_issueId_key" ON "bushbim"."IssuePin"("issueId");

-- CreateIndex
CREATE INDEX "IssuePin_versionId_page_idx" ON "bushbim"."IssuePin"("versionId", "page");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_storageKey_key" ON "bushbim"."Photo"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_thumbKey_key" ON "bushbim"."Photo"("thumbKey");

-- CreateIndex
CREATE INDEX "Photo_projectId_createdAt_idx" ON "bushbim"."Photo"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_issueId_idx" ON "bushbim"."Photo"("issueId");

-- AddForeignKey
ALTER TABLE "bushbim"."IssuePin" ADD CONSTRAINT "IssuePin_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "bushbim"."Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssuePin" ADD CONSTRAINT "IssuePin_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "bushbim"."DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."IssuePin" ADD CONSTRAINT "IssuePin_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Photo" ADD CONSTRAINT "Photo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Photo" ADD CONSTRAINT "Photo_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "bushbim"."Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Photo" ADD CONSTRAINT "Photo_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "bushbim"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
