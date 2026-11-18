import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import {
  extraerContextoRequestAuditoria,
  registrarAuditoriaAdmin,
} from "../servicios/auditoria.js";
import {
  ESTADOS_SUSCRIPCION,
  actualizarPlanSuscripcion,
  actualizarSuscripcionManual,
  asignarSuscripcionManual,
  cancelarSuscripcionManual,
  crearPlanSuscripcion,
  listarHistorialSuscripcion,
  listarPlanesSuscripcion,
  listarSuscripcionesOrganizaciones,
  obtenerSuscripcionOrganizacion,
} from "../servicios/suscripciones.js";

export const rutasAdminSuscripciones = Router();

const uuid = z.string().uuid();

const esquemaPaginacionQuery = z.object({
  pagina: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

const esquemaBooleanoQuery = z
  .enum(["true", "false"])
  .transform((valor) => valor === "true")
  .optional();

const esquemaListarPlanes = esquemaPaginacionQuery.extend({
  activo: esquemaBooleanoQuery,
  busqueda: z.string().trim().max(120).optional(),
});

const esquemaCrearPlan = z.object({
  codigo: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/, "El código solo puede contener letras, números, guiones y guion bajo"),
  nombre: z.string().trim().min(2).max(120),
  descripcion: z.string().trim().max(500).optional().nullable(),
  activo: z.boolean().optional(),
  esPlanPrueba: z.boolean().optional(),
  duracionSugeridaDias: z.coerce.number().int().positive().max(3650).optional().nullable(),
  caracteristicas: z.record(z.string(), z.unknown()).optional().nullable(),
  orden: z.coerce.number().int().min(0).max(10000).optional(),
});

const esquemaActualizarPlan = esquemaCrearPlan.partial();

const esquemaListarSuscripciones = esquemaPaginacionQuery.extend({
  estado: z.enum(ESTADOS_SUSCRIPCION).optional(),
  planId: uuid.optional(),
  busqueda: z.string().trim().max(120).optional(),
});

const esquemaAsignarSuscripcion = z.object({
  planId: uuid,
  estado: z.enum(["PRUEBA", "ACTIVA"]),
  fechaInicio: z.coerce.date().optional(),
  fechaFin: z.coerce.date().optional().nullable(),
  motivo: z.string().trim().max(500).optional().nullable(),
  notasInternas: z.string().trim().max(2000).optional().nullable(),
  referenciaManual: z.string().trim().max(200).optional().nullable(),
});

const esquemaActualizarSuscripcion = z.object({
  planId: uuid.optional(),
  estado: z.enum(["PRUEBA", "ACTIVA", "SUSPENDIDA"]).optional(),
  fechaInicio: z.coerce.date().optional(),
  fechaFin: z.coerce.date().optional().nullable(),
  motivo: z.string().trim().max(500).optional().nullable(),
  notasInternas: z.string().trim().max(2000).optional().nullable(),
  referenciaManual: z.string().trim().max(200).optional().nullable(),
});

const esquemaCancelarSuscripcion = z.object({
  motivoCancelacion: z.string().trim().max(500).optional().nullable(),
  notas: z.string().trim().max(2000).optional().nullable(),
});

function obtenerActorAdminGlobal(req: SolicitudAutenticada): { usuarioId: string } {
  const sesion = req.sesion as
    | { usuarioId?: string; tipoAcceso?: string; rolPlataforma?: string; mfaVerificado?: boolean }
    | undefined;
  if (!sesion?.usuarioId) {
    throw new ErrorHttp(401, "Se requiere autenticación");
  }
  if (
    sesion.tipoAcceso !== "ADMIN_GLOBAL" ||
    sesion.rolPlataforma !== "ADMIN_GLOBAL" ||
    sesion.mfaVerificado !== true
  ) {
    throw new ErrorHttp(403, "Acceso restringido a ADMIN_GLOBAL con MFA verificado");
  }
  return { usuarioId: sesion.usuarioId };
}

rutasAdminSuscripciones.get("/planes", async (req: SolicitudAutenticada, res) => {
  obtenerActorAdminGlobal(req);
  const query = esquemaListarPlanes.parse(req.query);
  const resultado = await listarPlanesSuscripcion(query);
  res.json(resultado);
});

rutasAdminSuscripciones.post("/planes", async (req: SolicitudAutenticada, res) => {
  const actor = obtenerActorAdminGlobal(req);
  const datos = esquemaCrearPlan.parse(req.body);
  const resultado = await crearPlanSuscripcion(
    {
      ...datos,
      caracteristicas: datos.caracteristicas as Prisma.InputJsonValue | null | undefined,
    },
    actor
  );
  const ctx = extraerContextoRequestAuditoria(req);
  await registrarAuditoriaAdmin({
    actorUsuarioId: actor.usuarioId,
    accion: "PLAN_SUSCRIPCION_CREADO",
    entidad: "PlanSuscripcion",
    entidadId: resultado.plan.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadatos: { codigo: resultado.plan.codigo, nombre: resultado.plan.nombre },
  });
  res.status(201).json(resultado);
});

rutasAdminSuscripciones.patch("/planes/:planId", async (req: SolicitudAutenticada, res) => {
  const actor = obtenerActorAdminGlobal(req);
  const planId = uuid.parse(req.params.planId);
  const datos = esquemaActualizarPlan.parse(req.body);
  const resultado = await actualizarPlanSuscripcion(
    planId,
    {
      ...datos,
      caracteristicas: datos.caracteristicas as Prisma.InputJsonValue | null | undefined,
    },
    actor
  );
  const ctx = extraerContextoRequestAuditoria(req);
  await registrarAuditoriaAdmin({
    actorUsuarioId: actor.usuarioId,
    accion: "PLAN_SUSCRIPCION_ACTUALIZADO",
    entidad: "PlanSuscripcion",
    entidadId: resultado.plan.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadatos: { codigo: resultado.plan.codigo, activo: resultado.plan.activo },
  });
  res.json(resultado);
});

rutasAdminSuscripciones.get("/", async (req: SolicitudAutenticada, res) => {
  obtenerActorAdminGlobal(req);
  const query = esquemaListarSuscripciones.parse(req.query);
  const resultado = await listarSuscripcionesOrganizaciones(query);
  res.json(resultado);
});

rutasAdminSuscripciones.get(
  "/organizaciones/:organizacionId",
  async (req: SolicitudAutenticada, res) => {
    obtenerActorAdminGlobal(req);
    const organizacionId = uuid.parse(req.params.organizacionId);
    const resultado = await obtenerSuscripcionOrganizacion(organizacionId);
    res.json(resultado);
  }
);

rutasAdminSuscripciones.post(
  "/organizaciones/:organizacionId/asignar",
  async (req: SolicitudAutenticada, res) => {
    const actor = obtenerActorAdminGlobal(req);
    const organizacionId = uuid.parse(req.params.organizacionId);
    const datos = esquemaAsignarSuscripcion.parse(req.body);
    const resultado = await asignarSuscripcionManual(organizacionId, datos, actor);
    const ctx = extraerContextoRequestAuditoria(req);
    await registrarAuditoriaAdmin({
      actorUsuarioId: actor.usuarioId,
      accion: "SUSCRIPCION_MANUAL_ASIGNADA",
      entidad: "SuscripcionOrganizacion",
      entidadId: resultado.suscripcion.id,
      organizacionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadatos: {
        estado: resultado.suscripcion.estado,
        planId: resultado.suscripcion.plan?.id ?? null,
        modalidadGestion: resultado.modalidadGestion,
      },
    });
    res.status(resultado.creada ? 201 : 200).json({
      suscripcion: resultado.suscripcion,
      modalidadGestion: resultado.modalidadGestion,
      etiquetaCobro: resultado.etiquetaCobro,
    });
  }
);

rutasAdminSuscripciones.patch(
  "/organizaciones/:organizacionId",
  async (req: SolicitudAutenticada, res) => {
    const actor = obtenerActorAdminGlobal(req);
    const organizacionId = uuid.parse(req.params.organizacionId);
    const datos = esquemaActualizarSuscripcion.parse(req.body);
    const resultado = await actualizarSuscripcionManual(organizacionId, datos, actor);
    const ctx = extraerContextoRequestAuditoria(req);
    await registrarAuditoriaAdmin({
      actorUsuarioId: actor.usuarioId,
      accion: "SUSCRIPCION_MANUAL_ACTUALIZADA",
      entidad: "SuscripcionOrganizacion",
      entidadId: resultado.suscripcion.id,
      organizacionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadatos: {
        estado: resultado.suscripcion.estado,
        planId: resultado.suscripcion.plan?.id ?? null,
        modalidadGestion: resultado.modalidadGestion,
      },
    });
    res.json(resultado);
  }
);

rutasAdminSuscripciones.post(
  "/organizaciones/:organizacionId/cancelar",
  async (req: SolicitudAutenticada, res) => {
    const actor = obtenerActorAdminGlobal(req);
    const organizacionId = uuid.parse(req.params.organizacionId);
    const datos = esquemaCancelarSuscripcion.parse(req.body ?? {});
    const resultado = await cancelarSuscripcionManual(organizacionId, datos, actor);
    const ctx = extraerContextoRequestAuditoria(req);
    await registrarAuditoriaAdmin({
      actorUsuarioId: actor.usuarioId,
      accion: "SUSCRIPCION_MANUAL_CANCELADA",
      entidad: "SuscripcionOrganizacion",
      entidadId: resultado.suscripcion.id,
      organizacionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadatos: {
        motivoCancelacion: resultado.suscripcion.motivoCancelacion,
        modalidadGestion: resultado.modalidadGestion,
      },
    });
    res.json(resultado);
  }
);

rutasAdminSuscripciones.get(
  "/organizaciones/:organizacionId/historial",
  async (req: SolicitudAutenticada, res) => {
    obtenerActorAdminGlobal(req);
    const organizacionId = uuid.parse(req.params.organizacionId);
    const query = esquemaPaginacionQuery.parse(req.query);
    const resultado = await listarHistorialSuscripcion(organizacionId, query);
    res.json(resultado);
  }
);
