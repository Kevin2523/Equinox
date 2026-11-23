-- CreateEnum
CREATE TYPE "TipoFreelance" AS ENUM ('GENERAL', 'DESARROLLO_SOFTWARE', 'FOTOGRAFIA', 'DISENO_GRAFICO');

-- CreateEnum
CREATE TYPE "EstadoSesionFotografica" AS ENUM ('BORRADOR', 'PUBLICADA');

-- AlterTable
ALTER TABLE "organizaciones" ADD COLUMN "tipo_freelance" "TipoFreelance" NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE "sesiones_fotograficas" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "fecha" DATE,
    "estado" "EstadoSesionFotografica" NOT NULL DEFAULT 'BORRADOR',
    "portada_foto_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesiones_fotograficas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fotos_sesion" (
    "id" UUID NOT NULL,
    "sesion_id" UUID NOT NULL,
    "almacenamiento_key" TEXT NOT NULL,
    "miniatura_key" TEXT,
    "nombre_original" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_sesion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sesiones_fotograficas_organizacion_id_estado_idx" ON "sesiones_fotograficas"("organizacion_id", "estado");

-- CreateIndex
CREATE INDEX "sesiones_fotograficas_cliente_id_idx" ON "sesiones_fotograficas"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "fotos_sesion_almacenamiento_key_key" ON "fotos_sesion"("almacenamiento_key");

-- CreateIndex
CREATE INDEX "fotos_sesion_sesion_id_orden_idx" ON "fotos_sesion"("sesion_id", "orden");

-- AddForeignKey
ALTER TABLE "sesiones_fotograficas" ADD CONSTRAINT "sesiones_fotograficas_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_fotograficas" ADD CONSTRAINT "sesiones_fotograficas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fotos_sesion" ADD CONSTRAINT "fotos_sesion_sesion_id_fkey" FOREIGN KEY ("sesion_id") REFERENCES "sesiones_fotograficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
