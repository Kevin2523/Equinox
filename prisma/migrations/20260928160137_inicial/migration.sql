-- CreateEnum
CREATE TYPE "RolMiembro" AS ENUM ('PROPIETARIO', 'COLABORADOR');

-- CreateEnum
CREATE TYPE "EstadoCliente" AS ENUM ('ACTIVO', 'INACTIVO', 'PROSPECTO', 'ARCHIVADO');

-- CreateEnum
CREATE TYPE "EstadoProyecto" AS ENUM ('BORRADOR', 'ACTIVO', 'PAUSADO', 'COMPLETADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PrioridadTarea" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "EstadoTarea" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'BLOQUEADA', 'COMPLETADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoHito" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "TipoArchivo" AS ENUM ('ARCHIVO', 'ENTREGABLE', 'IMAGEN', 'DOCUMENTO');

-- CreateEnum
CREATE TYPE "VisibilidadArchivo" AS ENUM ('INTERNA', 'CLIENTE');

-- CreateEnum
CREATE TYPE "AutorComentario" AS ENUM ('FREELANCER', 'CLIENTE');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('BORRADOR', 'ENVIADA', 'PAGADA', 'VENCIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "correo" TEXT NOT NULL,
    "contrasena_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT,
    "telefono" TEXT,
    "zona_horaria" TEXT NOT NULL DEFAULT 'America/Panama',
    "avatar_url" TEXT,
    "correo_verificado_en" TIMESTAMP(3),
    "ultimo_acceso_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizaciones" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descripcion" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'PAB',
    "ruc" TEXT,
    "direccion" TEXT,
    "telefono" TEXT,
    "correo_contacto" TEXT,
    "logo_url" TEXT,
    "color_primario" TEXT NOT NULL DEFAULT '#2563EB',
    "color_secundario" TEXT NOT NULL DEFAULT '#0F172A',
    "tipografia" TEXT NOT NULL DEFAULT 'Inter',
    "dominio_portal" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "miembros_organizacion" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "rol" "RolMiembro" NOT NULL DEFAULT 'COLABORADOR',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "miembros_organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "empresa" TEXT,
    "correo" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "sitio_web" TEXT,
    "notas_internas" TEXT,
    "estado" "EstadoCliente" NOT NULL DEFAULT 'ACTIVO',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proyectos" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "creado_por_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" "EstadoProyecto" NOT NULL DEFAULT 'BORRADOR',
    "presupuesto" DECIMAL(12,2),
    "moneda" TEXT NOT NULL DEFAULT 'PAB',
    "fecha_inicio" DATE,
    "fecha_entrega" DATE,
    "completado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proyectos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tareas" (
    "id" UUID NOT NULL,
    "proyecto_id" UUID NOT NULL,
    "hito_id" UUID,
    "asignado_a_id" UUID,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" "EstadoTarea" NOT NULL DEFAULT 'PENDIENTE',
    "prioridad" "PrioridadTarea" NOT NULL DEFAULT 'MEDIA',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "fecha_vencimiento" DATE,
    "completada_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tareas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hitos" (
    "id" UUID NOT NULL,
    "proyecto_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" "EstadoHito" NOT NULL DEFAULT 'PENDIENTE',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "fecha_objetivo" DATE,
    "completado_en" TIMESTAMP(3),
    "visible_en_portal" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hitos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archivos" (
    "id" UUID NOT NULL,
    "proyecto_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "tipo" "TipoArchivo" NOT NULL DEFAULT 'ARCHIVO',
    "visibilidad" "VisibilidadArchivo" NOT NULL DEFAULT 'INTERNA',
    "descripcion" TEXT,
    "publicado_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comentarios" (
    "id" UUID NOT NULL,
    "proyecto_id" UUID NOT NULL,
    "usuario_id" UUID,
    "acceso_portal_id" UUID,
    "autor" "AutorComentario" NOT NULL,
    "contenido" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comentarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accesos_portal" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "proyecto_id" UUID,
    "token" TEXT NOT NULL,
    "nombre" TEXT,
    "correo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "expira_en" TIMESTAMP(3),
    "ultimo_acceso_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accesos_portal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "proyecto_id" UUID,
    "numero" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PAB',
    "estado" "EstadoFactura" NOT NULL DEFAULT 'BORRADOR',
    "fecha_emision" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_vencimiento" DATE,
    "pagada_en" TIMESTAMP(3),
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actividades" (
    "id" UUID NOT NULL,
    "organizacion_id" UUID NOT NULL,
    "usuario_id" UUID,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "descripcion" TEXT,
    "metadatos" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actividades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "revocada_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "organizaciones_slug_key" ON "organizaciones"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizaciones_dominio_portal_key" ON "organizaciones"("dominio_portal");

-- CreateIndex
CREATE UNIQUE INDEX "miembros_organizacion_usuario_id_organizacion_id_key" ON "miembros_organizacion"("usuario_id", "organizacion_id");

-- CreateIndex
CREATE INDEX "clientes_organizacion_id_estado_idx" ON "clientes"("organizacion_id", "estado");

-- CreateIndex
CREATE INDEX "proyectos_organizacion_id_estado_idx" ON "proyectos"("organizacion_id", "estado");

-- CreateIndex
CREATE INDEX "proyectos_cliente_id_idx" ON "proyectos"("cliente_id");

-- CreateIndex
CREATE INDEX "tareas_proyecto_id_estado_idx" ON "tareas"("proyecto_id", "estado");

-- CreateIndex
CREATE INDEX "hitos_proyecto_id_orden_idx" ON "hitos"("proyecto_id", "orden");

-- CreateIndex
CREATE INDEX "archivos_proyecto_id_visibilidad_idx" ON "archivos"("proyecto_id", "visibilidad");

-- CreateIndex
CREATE INDEX "comentarios_proyecto_id_creado_en_idx" ON "comentarios"("proyecto_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "accesos_portal_token_key" ON "accesos_portal"("token");

-- CreateIndex
CREATE INDEX "accesos_portal_cliente_id_activo_idx" ON "accesos_portal"("cliente_id", "activo");

-- CreateIndex
CREATE INDEX "facturas_organizacion_id_estado_idx" ON "facturas"("organizacion_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_organizacion_id_numero_key" ON "facturas"("organizacion_id", "numero");

-- CreateIndex
CREATE INDEX "actividades_organizacion_id_creado_en_idx" ON "actividades"("organizacion_id", "creado_en");

-- CreateIndex
CREATE INDEX "actividades_entidad_entidad_id_idx" ON "actividades"("entidad", "entidad_id");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_token_hash_key" ON "sesiones"("token_hash");

-- AddForeignKey
ALTER TABLE "miembros_organizacion" ADD CONSTRAINT "miembros_organizacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miembros_organizacion" ADD CONSTRAINT "miembros_organizacion_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_hito_id_fkey" FOREIGN KEY ("hito_id") REFERENCES "hitos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas" ADD CONSTRAINT "tareas_asignado_a_id_fkey" FOREIGN KEY ("asignado_a_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitos" ADD CONSTRAINT "hitos_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivos" ADD CONSTRAINT "archivos_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_acceso_portal_id_fkey" FOREIGN KEY ("acceso_portal_id") REFERENCES "accesos_portal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_portal" ADD CONSTRAINT "accesos_portal_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_portal" ADD CONSTRAINT "accesos_portal_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "proyectos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actividades" ADD CONSTRAINT "actividades_organizacion_id_fkey" FOREIGN KEY ("organizacion_id") REFERENCES "organizaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actividades" ADD CONSTRAINT "actividades_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
