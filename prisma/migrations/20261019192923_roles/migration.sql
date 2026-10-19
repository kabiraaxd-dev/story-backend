-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "publishedById" INTEGER,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Story_reviewedById_idx" ON "Story"("reviewedById");

-- CreateIndex
CREATE INDEX "Story_publishedById_idx" ON "Story"("publishedById");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
