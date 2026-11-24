-- CreateEnum
CREATE TYPE "IdiomaUsuario" AS ENUM ('es', 'en', 'pt');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "idioma" "IdiomaUsuario" NOT NULL DEFAULT 'es';
