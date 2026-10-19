-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'REVIEWER';
ALTER TYPE "Role" ADD VALUE 'TAXONOMY_MANAGER';

-- AlterEnum
ALTER TYPE "StoryStatus" ADD VALUE 'CHANGES_REQUESTED';

ALTER TABLE "User" ADD COLUMN "roles" "Role"[] DEFAULT ARRAY['CREATOR']::"Role"[];
UPDATE "User" SET "roles" = ARRAY["role"];
ALTER TABLE "User" DROP COLUMN "role";