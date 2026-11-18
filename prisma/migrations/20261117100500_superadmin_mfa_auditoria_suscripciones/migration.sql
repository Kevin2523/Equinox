-- CreateEnum
CREATE TYPE "RolPlataforma" AS ENUM ('USUARIO', 'ADMIN_GLOBAL');

-- CreateEnum
CREATE TYPE "TipoAccesoSesion" AS ENUM ('ORGANIZACION', 'CLIENTE', 'ADMIN_GLOBAL');

-- CreateEnum
CREATE TYPE "EstadoSuscripcion" AS ENUM ('SIN_SUSCRIPCION', 'PRUEBA', 'ACTIVA', 'SUSPENDIDA', 'CANCELADA');

-- AlterTable
ALTER TABLE "sesiones" ADD COLUMN     "ip_origen" TEXT,
ADD COLUMN     "mfa_verificado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_verificado_en" TIMESTAMP(3),
ADD COLUMN     "tipo_acceso" "TipoAccesoSesion" NOT NULL DEFAULT 'ORGANIZACION',
ADD COLUMN     "user_agent" TEXT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "mfa_habilitado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_pendiente_secreto_cifrado" TEXT,
ADD COLUMN     "mfa_secreto_cifrado" TEXT,
ADD COLUMN     "mfa_ultimo_paso_usado" BIGINT,
ADD COLUMN     "mfa_verificado_en" TIMESTAMP(3),
ADD COLUMN     "rol_plataforma" "RolPlataforma" NOT NULL DEFAULT 'USUARIO';

-- CreateTable
CREATE TABLE "codigos_recuperacion_mfa" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "usado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_recuperacion_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_recuperacion_mfa" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "usado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_recuperacion_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_admin" (
    "id" UUID NOT NULL,
    "actor_usuario_id" UUID,
    "actor_correo" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "organizacion_id" UUID,
    "resultado" TEXT NOT NULL DEFAULT 'EXITO',
    "ip" TEXT,
    "user_agent" TEXT,
    "metadatos" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planes_suscripcion" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "es_plan_prueba" BOOLEAN NOT NULL DEFAULT false,
    "duracion_sugerida_dias" INTEGER,
    "caracteristicas" JSONB,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_por_usuario_id" UUID,
    "actualizado_por_usuario_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planes_suscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripciones_organizacion" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "plan_id" UUID,
    "estado" "EstadoSuscripcion" NOT NULL DEFAULT 'SIN_SUSCRIPCION',
    "fecha_inicio" TIMESTAMP(3),
    "fecha_fin" TIMESTAMP(3),
    "motivo" TEXT,
    "notas_internas" TEXT,
    "referencia_manual" TEXT,
    "asignado_por_usuario_id" UUID,
    "asignado_en" TIMESTAMP(3),
    "cancelada_por_usuario_id" UUID,
    "cancelada_en" TIMESTAMP(3),
    "motivo_cancelacion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suscripciones_organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_suscripciones" (
    "id" UUID NOT NULL,
    "suscripcion_id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "accion" TEXT NOT NULL,
    "estado_anterior" "EstadoSuscripcion",
    "estado_nuevo" "EstadoSuscripcion" NOT NULL,
    "plan_anterior_id" UUID,
    "plan_nuevo_id" UUID,
    "fecha_inicio_anterior" TIMESTAMP(3),
    "fecha_inicio_nueva" TIMESTAMP(3),
    "fecha_fin_anterior" TIMESTAMP(3),
    "fecha_fin_nueva" TIMESTAMP(3),
    "motivo" TEXT,
    "notas" TEXT,
    "metadatos" JSONB,
    "realizado_por_usuario_id" UUID,
    "realizado_por_correo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_suscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "codigos_recuperacion_mfa_usuario_id_usado_en_idx" ON "codigos_recuperacion_mfa"("usuario_id", "usado_en");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_recuperacion_mfa_token_hash_key" ON "solicitudes_recuperacion_mfa"("token_hash");

-- CreateIndex
CREATE INDEX "solicitudes_recuperacion_mfa_usuario_id_idx" ON "solicitudes_recuperacion_mfa"("usuario_id");

-- CreateIndex
CREATE INDEX "solicitudes_recuperacion_mfa_expira_en_idx" ON "solicitudes_recuperacion_mfa"("expira_en");

-- CreateIndex
CREATE INDEX "auditoria_admin_actor_usuario_id_creado_en_idx" ON "auditoria_admin"("actor_usuario_id", "creado_en");

-- CreateIndex
CREATE INDEX "auditoria_admin_accion_creado_en_idx" ON "auditoria_admin"("accion", "creado_en");

-- CreateIndex
CREATE INDEX "auditoria_admin_entidad_entidad_id_idx" ON "auditoria_admin"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "auditoria_admin_organizacion_id_creado_en_idx" ON "auditoria_admin"("organizacion_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "planes_suscripcion_codigo_key" ON "planes_suscripcion"("codigo");

-- CreateIndex
CREATE INDEX "planes_suscripcion_activo_orden_idx" ON "planes_suscripcion"("activo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_organizacion_organizacion_id_key" ON "suscripciones_organizacion"("organizacion_id");

-- CreateIndex
CREATE INDEX "suscripciones_organizacion_estado_fecha_fin_idx" ON "suscripciones_organizacion"("estado", "fecha_fin");

-- CreateIndex
CREATE INDEX "suscripciones_organizacion_plan_id_idx" ON "suscripciones_organizacion"("plan_id");

-- CreateIndex
CREATE INDEX "historial_suscripciones_organizacion_id_creado_en_idx" ON "historial_suscripciones"("organizacion_id", "creado_en");

-- CreateIndex
CREATE INDEX "historial_suscripciones_suscripcion_id_creado_en_idx" ON "historial_suscripciones"("suscripcion_id", "creado_en");

-- CreateIndex
CREATE INDEX "historial_suscripciones_realizado_por_usuario_id_idx" ON "historial_suscripciones"("realizado_por_usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_tipo_acceso_revocada_en_idx" ON "sesiones"("usuario_id", "tipo_acceso", "revocada_en");

-- CreateIndex
CREATE INDEX "solicitudes_recuperacion_token_hash_idx" ON "solicitudes_recuperacion"("token_hash");

-- AddForeignKey
ALTER TABLE "codigos_recuperacion_mfa" ADD CONSTRAINT "codigos_recuperacion_mfa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_recuperacion_mfa" ADD CONSTRAINT "solicitudes_recuperacion_mfa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_admin" ADD CONSTRAINT "auditoria_admin_actor_usuario_id_fkey" FOREIGN KEY ("actor_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planes_suscripcion" ADD CONSTRAINT "planes_suscripcion_creado_por_usuario_id_fkey" FOREIGN KEY ("creado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planes_suscripcion" ADD CONSTRAINT "planes_suscripcion_actualizado_por_usuario_id_fkey" FOREIGN KEY ("actualizado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_organizacion" ADD CONSTRAINT "suscripciones_organizacion_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_organizacion" ADD CONSTRAINT "suscripciones_organizacion_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "planes_suscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_organizacion" ADD CONSTRAINT "suscripciones_organizacion_asignado_por_usuario_id_fkey" FOREIGN KEY ("asignado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_organizacion" ADD CONSTRAINT "suscripciones_organizacion_cancelada_por_usuario_id_fkey" FOREIGN KEY ("cancelada_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_suscripciones" ADD CONSTRAINT "historial_suscripciones_suscripcion_id_fkey" FOREIGN KEY ("suscripcion_id") REFERENCES "suscripciones_organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_suscripciones" ADD CONSTRAINT "historial_suscripciones_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_suscripciones" ADD CONSTRAINT "historial_suscripciones_plan_anterior_id_fkey" FOREIGN KEY ("plan_anterior_id") REFERENCES "planes_suscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_suscripciones" ADD CONSTRAINT "historial_suscripciones_plan_nuevo_id_fkey" FOREIGN KEY ("plan_nuevo_id") REFERENCES "planes_suscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_suscripciones" ADD CONSTRAINT "historial_suscripciones_realizado_por_usuario_id_fkey" FOREIGN KEY ("realizado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

