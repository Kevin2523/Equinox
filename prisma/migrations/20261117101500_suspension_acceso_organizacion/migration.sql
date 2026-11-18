-- AlterTable
ALTER TABLE "organizaciones" ADD COLUMN     "motivo_suspension" TEXT,
ADD COLUMN     "suspendida_en" TIMESTAMP(3),
ADD COLUMN     "suspendida_por_usuario_id" UUID;

-- CreateIndex
CREATE INDEX "organizaciones_suspendida_en_idx" ON "organizaciones"("suspendida_en");

