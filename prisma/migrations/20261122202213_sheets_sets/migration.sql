-- CreateTable
CREATE TABLE "bushbim"."Sheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."SheetSet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bushbim"."SetSheet" (
    "setId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetSheet_pkey" PRIMARY KEY ("setId","sheetId")
);

-- CreateTable
CREATE TABLE "bushbim"."TitleBlockSettings" (
    "projectId" TEXT NOT NULL,
    "numberRegion" JSONB NOT NULL,
    "titleRegion" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TitleBlockSettings_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "Sheet_projectId_number_idx" ON "bushbim"."Sheet"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Sheet_versionId_page_key" ON "bushbim"."Sheet"("versionId", "page");

-- CreateIndex
CREATE UNIQUE INDEX "SheetSet_projectId_name_key" ON "bushbim"."SheetSet"("projectId", "name");

-- AddForeignKey
ALTER TABLE "bushbim"."Sheet" ADD CONSTRAINT "Sheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."Sheet" ADD CONSTRAINT "Sheet_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "bushbim"."DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."SheetSet" ADD CONSTRAINT "SheetSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."SetSheet" ADD CONSTRAINT "SetSheet_setId_fkey" FOREIGN KEY ("setId") REFERENCES "bushbim"."SheetSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."SetSheet" ADD CONSTRAINT "SetSheet_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "bushbim"."Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bushbim"."TitleBlockSettings" ADD CONSTRAINT "TitleBlockSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bushbim"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
