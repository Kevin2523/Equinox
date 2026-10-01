-- CreateEnum
CREATE TYPE "RolCliente" AS ENUM ('TITULAR', 'COLABORADOR');

-- CreateEnum
CREATE TYPE "EstadoInvitacionCliente" AS ENUM ('PENDIENTE', 'ACEPTADA', 'REVOCADA', 'EXPIRADA');

-- CreateTable
CREATE TABLE "accesos_cliente" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "rol" "RolCliente" NOT NULL DEFAULT 'TITULAR',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acceso_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accesos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitaciones_cliente" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "correo" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "rol" "RolCliente" NOT NULL DEFAULT 'TITULAR',
    "estado" "EstadoInvitacionCliente" NOT NULL DEFAULT 'PENDIENTE',
    "expira_en" TIMESTAMP(3) NOT NULL,
    "aceptada_en" TIMESTAMP(3),
    "invitado_por_id" UUID NOT NULL,
    "aceptada_por_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitaciones_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accesos_cliente_organizacion_id_activo_idx" ON "accesos_cliente"("organizacion_id", "activo");

-- CreateIndex
CREATE INDEX "accesos_cliente_cliente_id_idx" ON "accesos_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "accesos_cliente_usuario_id_idx" ON "accesos_cliente"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "accesos_cliente_usuario_id_cliente_id_key" ON "accesos_cliente"("usuario_id", "cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_cliente_token_hash_key" ON "invitaciones_cliente"("token_hash");

-- CreateIndex
CREATE INDEX "invitaciones_cliente_organizacion_id_estado_idx" ON "invitaciones_cliente"("organizacion_id", "estado");

-- CreateIndex
CREATE INDEX "invitaciones_cliente_cliente_id_idx" ON "invitaciones_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "invitaciones_cliente_correo_idx" ON "invitaciones_cliente"("correo");

-- CreateIndex
CREATE INDEX "invitaciones_cliente_expira_en_idx" ON "invitaciones_cliente"("expira_en");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_id_organizacion_id_key" ON "clientes"("id", "organizacion_id");

-- AddForeignKey
ALTER TABLE "accesos_cliente" ADD CONSTRAINT "accesos_cliente_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_cliente" ADD CONSTRAINT "accesos_cliente_cliente_id_organizacion_id_fkey" FOREIGN KEY ("cliente_id", "organizacion_id") REFERENCES "clientes"("id", "organizacion_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_cliente" ADD CONSTRAINT "accesos_cliente_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_cliente" ADD CONSTRAINT "invitaciones_cliente_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_cliente" ADD CONSTRAINT "invitaciones_cliente_cliente_id_organizacion_id_fkey" FOREIGN KEY ("cliente_id", "organizacion_id") REFERENCES "clientes"("id", "organizacion_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_cliente" ADD CONSTRAINT "invitaciones_cliente_invitado_por_id_fkey" FOREIGN KEY ("invitado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_cliente" ADD CONSTRAINT "invitaciones_cliente_aceptada_por_id_fkey" FOREIGN KEY ("aceptada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
