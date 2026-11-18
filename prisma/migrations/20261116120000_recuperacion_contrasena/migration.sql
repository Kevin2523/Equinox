-- CreateTable
CREATE TABLE "solicitudes_recuperacion" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "usado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_recuperacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_recuperacion_token_hash_key" ON "solicitudes_recuperacion"("token_hash");

-- CreateIndex
CREATE INDEX "solicitudes_recuperacion_usuario_id_idx" ON "solicitudes_recuperacion"("usuario_id");

-- CreateIndex
CREATE INDEX "solicitudes_recuperacion_expira_en_idx" ON "solicitudes_recuperacion"("expira_en");

-- AddForeignKey
ALTER TABLE "solicitudes_recuperacion" ADD CONSTRAINT "solicitudes_recuperacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
