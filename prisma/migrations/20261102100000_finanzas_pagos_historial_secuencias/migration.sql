-- AlterTable
ALTER TABLE "facturas" ADD COLUMN "visible_en_portal" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "facturas_cliente_id_visible_en_portal_idx" ON "facturas"("cliente_id", "visible_en_portal");

-- CreateTable
CREATE TABLE "historial_facturas" (
    "id" UUID NOT NULL,
    "factura_id" UUID NOT NULL,
    "estado_anterior" "EstadoFactura",
    "estado_nuevo" "EstadoFactura" NOT NULL,
    "usuario_id" UUID,
    "motivo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL,
    "factura_id" UUID NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PAB',
    "metodo" TEXT,
    "referencia" TEXT,
    "notas" TEXT,
    "registrado_por_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secuencias_facturas" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "ultimo_numero" INTEGER NOT NULL DEFAULT 0,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secuencias_facturas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historial_facturas_factura_id_creado_en_idx" ON "historial_facturas"("factura_id", "creado_en");

-- CreateIndex
CREATE INDEX "pagos_factura_id_creado_en_idx" ON "pagos"("factura_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "secuencias_facturas_organizacion_id_key" ON "secuencias_facturas"("organizacion_id");

-- AddForeignKey
ALTER TABLE "historial_facturas" ADD CONSTRAINT "historial_facturas_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_facturas" ADD CONSTRAINT "historial_facturas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secuencias_facturas" ADD CONSTRAINT "secuencias_facturas_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Inicializar secuencias para organizaciones existentes a partir del mayor correlativo
INSERT INTO "secuencias_facturas" ("id", "organizacion_id", "ultimo_numero", "actualizado_en")
SELECT
  gen_random_uuid(),
  o."id",
  COALESCE(
    (
      SELECT MAX(
        NULLIF(SUBSTRING(f."numero" FROM '^[iI][nN][vV]-([0-9]+)$'), '')::integer
      )
      FROM "facturas" f
      WHERE f."organizacion_id" = o."id"
    ),
    0
  ),
  CURRENT_TIMESTAMP
FROM "organizaciones" o
ON CONFLICT ("organizacion_id") DO NOTHING;
