-- AlterTable
ALTER TABLE "bushbim"."Project" ADD COLUMN     "coverImage" TEXT;

-- Data: cover photos for the demo projects already in the database.
UPDATE "bushbim"."Project" SET "coverImage" = '/projects/kruger-lodge-villas.webp' WHERE "name" = 'Kruger Lodge Villas' AND "coverImage" IS NULL;
UPDATE "bushbim"."Project" SET "coverImage" = '/projects/zanzibar-beach-retreat.webp' WHERE "name" = 'Zanzibar Beach Retreat' AND "coverImage" IS NULL;
