import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ErrorHttp } from "../utilidades/errores.js";

export const MODALIDAD_GESTION_MANUAL = "MANUAL_SIN_COBRO" as const;
export const ETIQUETA_COBRO_MANUAL = "Manual, sin cobro procesado" as const;

export const ESTADOS_SUSCRIPCION = [
  "SIN_SUSCRIPCION",
  "PRUEBA",
  "ACTIVA",
  "SUSPENDIDA",
  "CANCELADA",
] as const;

export type EstadoSuscripcion = (typeof ESTADOS_SUSCRIPCION)[number];

export const TRANSICIONES_SUSCRIPCION_VALIDAS: Record<EstadoSuscripcion, readonly EstadoSuscripcion[]> = {
  SIN_SUSCRIPCION: ["PRUEBA", "ACTIVA"],
  PRUEBA: ["PRUEBA", "ACTIVA", "SUSPENDIDA", "CANCELADA"],
  ACTIVA: ["ACTIVA", "PRUEBA", "SUSPENDIDA", "CANCELADA"],
  SUSPENDIDA: ["ACTIVA", "PRUEBA", "CANCELADA"],
  CANCELADA: ["PRUEBA", "ACTIVA"],
};

export interface ActorAdminGlobal {
  usuarioId: string;
}

export interface ParametrosPaginacion {
  pagina?: number;
  limite?: number;
}

export interface MetadatosPaginacion {
  pagina: number;
  limite: number;
  total: number;
  totalPaginas: number;
}

export interface PlanSuscripcionDTO {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  esPlanPrueba: boolean;
  duracionSugeridaDias: number | null;
  caracteristicas: Prisma.JsonValue | null;
  orden: number;
  modalidadGestion: typeof MODALIDAD_GESTION_MANUAL;
  etiquetaCobro: typeof ETIQUETA_COBRO_MANUAL;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface ResumenPlanDTO {
  id: string;
  codigo: string;
  nombre: string;
  esPlanPrueba: boolean;
}

export interface ResumenUsuarioAdminDTO {
  id: string;
  nombre: string;
  correo: string;
}

export interface SuscripcionOrganizacionDTO {
  id: string | null;
  organizacionId: string;
  estado: EstadoSuscripcion;
  plan: ResumenPlanDTO | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  motivo: string | null;
  notasInternas: string | null;
  referenciaManual: string | null;
  asignadoEn: Date | null;
  asignadoPor: ResumenUsuarioAdminDTO | null;
  canceladaEn: Date | null;
  canceladaPor: ResumenUsuarioAdminDTO | null;
  motivoCancelacion: string | null;
  modalidadGestion: typeof MODALIDAD_GESTION_MANUAL;
  etiquetaCobro: typeof ETIQUETA_COBRO_MANUAL;
  creadoEn: Date | null;
  actualizadoEn: Date | null;
}

export function normalizarPaginacion(params?: ParametrosPaginacion): {
  pagina: number;
  limite: number;
  skip: number;
} {
  const paginaRaw = Number(params?.pagina ?? 1);
  const limiteRaw = Number(params?.limite ?? 20);
  const pagina = Number.isFinite(paginaRaw) ? Math.max(1, Math.trunc(paginaRaw)) : 1;
  const limite = Number.isFinite(limiteRaw) ? Math.min(100, Math.max(1, Math.trunc(limiteRaw))) : 20;
  return { pagina, limite, skip: (pagina - 1) * limite };
}

export function construirMetadatosPaginacion(
  pagina: number,
  limite: number,
  total: number
): MetadatosPaginacion {
  return {
    pagina,
    limite,
    total,
    totalPaginas: Math.ceil(total / limite),
  };
}

export function validarTransicionSuscripcion(
  estadoActual: EstadoSuscripcion,
  estadoNuevo: EstadoSuscripcion
): void {
  const permitidos = TRANSICIONES_SUSCRIPCION_VALIDAS[estadoActual] ?? [];
  if (!permitidos.includes(estadoNuevo)) {
    throw new ErrorHttp(
      422,
      `Transición de suscripción no permitida: ${estadoActual} -> ${estadoNuevo}`
    );
  }
}

export function validarYResolverFechasSuscripcion(opciones: {
  estado: EstadoSuscripcion;
  fechaInicio?: Date | null;
  fechaFin?: Date | null;
  duracionSugeridaDias?: number | null;
  usarAhoraSiFaltaInicio?: boolean;
}): { fechaInicio: Date | null; fechaFin: Date | null } {
  const fechaInicio =
    opciones.fechaInicio !== undefined
      ? opciones.fechaInicio
      : opciones.usarAhoraSiFaltaInicio
        ? new Date()
        : null;

  let fechaFin = opciones.fechaFin !== undefined ? opciones.fechaFin : null;

  if (
    opciones.estado === "PRUEBA" &&
    opciones.fechaFin === undefined &&
    fechaInicio &&
    opciones.duracionSugeridaDias &&
    opciones.duracionSugeridaDias > 0
  ) {
    fechaFin = new Date(fechaInicio.getTime() + opciones.duracionSugeridaDias * 86_400_000);
  }

  if (fechaFin !== null && fechaInicio !== null && fechaFin.getTime() <= fechaInicio.getTime()) {
    throw new ErrorHttp(422, "La fecha de fin debe ser posterior a la fecha de inicio");
  }

  return { fechaInicio, fechaFin };
}

function mapearPlanDTO(plan: {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  esPlanPrueba: boolean;
  duracionSugeridaDias: number | null;
  caracteristicas: Prisma.JsonValue | null;
  orden: number;
  creadoEn: Date;
  actualizadoEn: Date;
}): PlanSuscripcionDTO {
  return {
    id: plan.id,
    codigo: plan.codigo,
    nombre: plan.nombre,
    descripcion: plan.descripcion,
    activo: plan.activo,
    esPlanPrueba: plan.esPlanPrueba,
    duracionSugeridaDias: plan.duracionSugeridaDias,
    caracteristicas: plan.caracteristicas,
    orden: plan.orden,
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
    creadoEn: plan.creadoEn,
    actualizadoEn: plan.actualizadoEn,
  };
}

const seleccionSuscripcion = {
  id: true,
  organizacionId: true,
  estado: true,
  fechaInicio: true,
  fechaFin: true,
  motivo: true,
  notasInternas: true,
  referenciaManual: true,
  asignadoEn: true,
  canceladaEn: true,
  motivoCancelacion: true,
  creadoEn: true,
  actualizadoEn: true,
  plan: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      esPlanPrueba: true,
    },
  },
  asignadoPorUsuario: {
    select: {
      id: true,
      nombre: true,
      correo: true,
    },
  },
  canceladaPorUsuario: {
    select: {
      id: true,
      nombre: true,
      correo: true,
    },
  },
} satisfies Prisma.SuscripcionOrganizacionSelect;

type RegistroSuscripcionSeleccionado = Prisma.SuscripcionOrganizacionGetPayload<{
  select: typeof seleccionSuscripcion;
}>;

function mapearSuscripcionDTO(
  organizacionId: string,
  registro: RegistroSuscripcionSeleccionado | null
): SuscripcionOrganizacionDTO {
  if (!registro) {
    return {
      id: null,
      organizacionId,
      estado: "SIN_SUSCRIPCION",
      plan: null,
      fechaInicio: null,
      fechaFin: null,
      motivo: null,
      notasInternas: null,
      referenciaManual: null,
      asignadoEn: null,
      asignadoPor: null,
      canceladaEn: null,
      canceladaPor: null,
      motivoCancelacion: null,
      modalidadGestion: MODALIDAD_GESTION_MANUAL,
      etiquetaCobro: ETIQUETA_COBRO_MANUAL,
      creadoEn: null,
      actualizadoEn: null,
    };
  }

  return {
    id: registro.id,
    organizacionId: registro.organizacionId,
    estado: registro.estado,
    plan: registro.plan,
    fechaInicio: registro.fechaInicio,
    fechaFin: registro.fechaFin,
    motivo: registro.motivo,
    notasInternas: registro.notasInternas,
    referenciaManual: registro.referenciaManual,
    asignadoEn: registro.asignadoEn,
    asignadoPor: registro.asignadoPorUsuario,
    canceladaEn: registro.canceladaEn,
    canceladaPor: registro.canceladaPorUsuario,
    motivoCancelacion: registro.motivoCancelacion,
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
    creadoEn: registro.creadoEn,
    actualizadoEn: registro.actualizadoEn,
  };
}

export async function listarPlanesSuscripcion(filtros: {
  pagina?: number;
  limite?: number;
  activo?: boolean;
  busqueda?: string;
}) {
  const { pagina, limite, skip } = normalizarPaginacion(filtros);
  const where: Prisma.PlanSuscripcionWhereInput = {};

  if (filtros.activo !== undefined) {
    where.activo = filtros.activo;
  }

  const busqueda = filtros.busqueda?.trim();
  if (busqueda) {
    where.OR = [
      { codigo: { contains: busqueda, mode: "insensitive" } },
      { nombre: { contains: busqueda, mode: "insensitive" } },
      { descripcion: { contains: busqueda, mode: "insensitive" } },
    ];
  }

  const [total, planes] = await Promise.all([
    prisma.planSuscripcion.count({ where }),
    prisma.planSuscripcion.findMany({
      where,
      orderBy: [{ orden: "asc" }, { creadoEn: "asc" }],
      skip,
      take: limite,
    }),
  ]);

  return {
    datos: planes.map(mapearPlanDTO),
    paginacion: construirMetadatosPaginacion(pagina, limite, total),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function crearPlanSuscripcion(
  datos: {
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    activo?: boolean;
    esPlanPrueba?: boolean;
    duracionSugeridaDias?: number | null;
    caracteristicas?: Prisma.InputJsonValue | null;
    orden?: number;
  },
  actor: ActorAdminGlobal
) {
  const codigoNormalizado = datos.codigo.trim().toUpperCase();
  const existente = await prisma.planSuscripcion.findUnique({
    where: { codigo: codigoNormalizado },
    select: { id: true },
  });
  if (existente) {
    throw new ErrorHttp(409, `Ya existe un plan con el código ${codigoNormalizado}`);
  }

  const plan = await prisma.planSuscripcion.create({
    data: {
      codigo: codigoNormalizado,
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion?.trim() || null,
      activo: datos.activo ?? true,
      esPlanPrueba: datos.esPlanPrueba ?? false,
      duracionSugeridaDias: datos.duracionSugeridaDias ?? null,
      caracteristicas: datos.caracteristicas ?? undefined,
      orden: datos.orden ?? 0,
      creadoPorUsuarioId: actor.usuarioId,
      actualizadoPorUsuarioId: actor.usuarioId,
    },
  });

  return {
    plan: mapearPlanDTO(plan),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function actualizarPlanSuscripcion(
  planId: string,
  datos: {
    codigo?: string;
    nombre?: string;
    descripcion?: string | null;
    activo?: boolean;
    esPlanPrueba?: boolean;
    duracionSugeridaDias?: number | null;
    caracteristicas?: Prisma.InputJsonValue | null;
    orden?: number;
  },
  actor: ActorAdminGlobal
) {
  const actual = await prisma.planSuscripcion.findUnique({ where: { id: planId } });
  if (!actual) {
    throw new ErrorHttp(404, "Plan de suscripción no encontrado");
  }

  let codigoFinal: string | undefined;
  if (datos.codigo !== undefined) {
    codigoFinal = datos.codigo.trim().toUpperCase();
    if (codigoFinal !== actual.codigo) {
      const duplicado = await prisma.planSuscripcion.findUnique({
        where: { codigo: codigoFinal },
        select: { id: true },
      });
      if (duplicado) {
        throw new ErrorHttp(409, `Ya existe un plan con el código ${codigoFinal}`);
      }
    }
  }

  const plan = await prisma.planSuscripcion.update({
    where: { id: planId },
    data: {
      codigo: codigoFinal,
      nombre: datos.nombre !== undefined ? datos.nombre.trim() : undefined,
      descripcion:
        datos.descripcion !== undefined ? datos.descripcion?.trim() || null : undefined,
      activo: datos.activo,
      esPlanPrueba: datos.esPlanPrueba,
      duracionSugeridaDias: datos.duracionSugeridaDias,
      caracteristicas: datos.caracteristicas === null ? undefined : datos.caracteristicas,
      orden: datos.orden,
      actualizadoPorUsuarioId: actor.usuarioId,
    },
  });

  return {
    plan: mapearPlanDTO(plan),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function listarSuscripcionesOrganizaciones(filtros: {
  pagina?: number;
  limite?: number;
  estado?: EstadoSuscripcion;
  planId?: string;
  busqueda?: string;
}) {
  const { pagina, limite, skip } = normalizarPaginacion(filtros);
  const where: Prisma.OrganizacionWhereInput = {};

  if (filtros.estado === "SIN_SUSCRIPCION") {
    where.OR = [
      { suscripcion: { is: null } },
      { suscripcion: { is: { estado: "SIN_SUSCRIPCION" } } },
    ];
  } else if (filtros.estado) {
    where.suscripcion = { is: { estado: filtros.estado } };
  }

  if (filtros.planId) {
    where.suscripcion = {
      is: {
        ...(where.suscripcion && "is" in where.suscripcion ? where.suscripcion.is : {}),
        planId: filtros.planId,
      },
    };
  }

  const busqueda = filtros.busqueda?.trim();
  if (busqueda) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { nombre: { contains: busqueda, mode: "insensitive" } },
          { slug: { contains: busqueda, mode: "insensitive" } },
          { correoContacto: { contains: busqueda, mode: "insensitive" } },
        ],
      },
    ];
  }

  const [total, organizaciones, totalOrgs, conteoPorEstado] = await Promise.all([
    prisma.organizacion.count({ where }),
    prisma.organizacion.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        slug: true,
        correoContacto: true,
        tipoFreelance: true,
        creadoEn: true,
        suscripcion: {
          select: seleccionSuscripcion,
        },
      },
      orderBy: [{ creadoEn: "desc" }],
      skip,
      take: limite,
    }),
    prisma.organizacion.count(),
    prisma.suscripcionOrganizacion.groupBy({
      by: ["estado"],
      _count: { _all: true },
    }),
  ]);

  const resumenEstados: Record<EstadoSuscripcion, number> = {
    SIN_SUSCRIPCION: 0,
    PRUEBA: 0,
    ACTIVA: 0,
    SUSPENDIDA: 0,
    CANCELADA: 0,
  };

  let conRegistro = 0;
  for (const fila of conteoPorEstado) {
    resumenEstados[fila.estado] = fila._count._all;
    conRegistro += fila._count._all;
  }
  resumenEstados.SIN_SUSCRIPCION += Math.max(0, totalOrgs - conRegistro);

  return {
    datos: organizaciones.map((org) => ({
      organizacion: {
        id: org.id,
        nombre: org.nombre,
        slug: org.slug,
        correoContacto: org.correoContacto,
        tipoFreelance: org.tipoFreelance,
      },
      suscripcion: mapearSuscripcionDTO(org.id, org.suscripcion),
    })),
    paginacion: construirMetadatosPaginacion(pagina, limite, total),
    resumenEstados,
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function obtenerSuscripcionOrganizacion(organizacionId: string) {
  const org = await prisma.organizacion.findUnique({
    where: { id: organizacionId },
    select: {
      id: true,
      nombre: true,
      slug: true,
      correoContacto: true,
      tipoFreelance: true,
      suscripcion: {
        select: seleccionSuscripcion,
      },
    },
  });

  if (!org) {
    throw new ErrorHttp(404, "Organización no encontrada");
  }

  return {
    organizacion: {
      id: org.id,
      nombre: org.nombre,
      slug: org.slug,
      correoContacto: org.correoContacto,
      tipoFreelance: org.tipoFreelance,
    },
    suscripcion: mapearSuscripcionDTO(org.id, org.suscripcion),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function asignarSuscripcionManual(
  organizacionId: string,
  datos: {
    planId: string;
    estado: "PRUEBA" | "ACTIVA";
    fechaInicio?: Date;
    fechaFin?: Date | null;
    motivo?: string | null;
    notasInternas?: string | null;
    referenciaManual?: string | null;
  },
  actor: ActorAdminGlobal
) {
  const [org, plan] = await Promise.all([
    prisma.organizacion.findUnique({ where: { id: organizacionId }, select: { id: true } }),
    prisma.planSuscripcion.findUnique({ where: { id: datos.planId } }),
  ]);

  if (!org) {
    throw new ErrorHttp(404, "Organización no encontrada");
  }
  if (!plan) {
    throw new ErrorHttp(404, "Plan de suscripción no encontrado");
  }
  if (!plan.activo) {
    throw new ErrorHttp(422, "No se puede asignar un plan inactivo");
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const [existente, usuarioActor] = await Promise.all([
      tx.suscripcionOrganizacion.findUnique({ where: { organizacionId } }),
      tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { correo: true } }),
    ]);

    const estadoAnterior: EstadoSuscripcion = existente?.estado ?? "SIN_SUSCRIPCION";
    validarTransicionSuscripcion(estadoAnterior, datos.estado);

    const { fechaInicio, fechaFin } = validarYResolverFechasSuscripcion({
      estado: datos.estado,
      fechaInicio: datos.fechaInicio,
      fechaFin: datos.fechaFin,
      duracionSugeridaDias: plan.duracionSugeridaDias,
      usarAhoraSiFaltaInicio: true,
    });

    const ahora = new Date();
    const suscripcion = existente
      ? await tx.suscripcionOrganizacion.update({
          where: { id: existente.id },
          data: {
            planId: plan.id,
            estado: datos.estado,
            fechaInicio,
            fechaFin,
            motivo: datos.motivo?.trim() || null,
            notasInternas: datos.notasInternas?.trim() || null,
            referenciaManual: datos.referenciaManual?.trim() || null,
            asignadoPorUsuarioId: actor.usuarioId,
            asignadoEn: ahora,
            canceladaPorUsuarioId: null,
            canceladaEn: null,
            motivoCancelacion: null,
          },
          select: seleccionSuscripcion,
        })
      : await tx.suscripcionOrganizacion.create({
          data: {
            organizacionId,
            planId: plan.id,
            estado: datos.estado,
            fechaInicio,
            fechaFin,
            motivo: datos.motivo?.trim() || null,
            notasInternas: datos.notasInternas?.trim() || null,
            referenciaManual: datos.referenciaManual?.trim() || null,
            asignadoPorUsuarioId: actor.usuarioId,
            asignadoEn: ahora,
          },
          select: seleccionSuscripcion,
        });

    await tx.historialSuscripcion.create({
      data: {
        suscripcionId: suscripcion.id,
        organizacionId,
        accion: existente ? "CAMBIADA" : "ASIGNADA",
        estadoAnterior,
        estadoNuevo: datos.estado,
        planAnteriorId: existente?.planId ?? null,
        planNuevoId: plan.id,
        fechaInicioAnterior: existente?.fechaInicio ?? null,
        fechaInicioNueva: fechaInicio,
        fechaFinAnterior: existente?.fechaFin ?? null,
        fechaFinNueva: fechaFin,
        motivo: datos.motivo?.trim() || null,
        notas: datos.notasInternas?.trim() || null,
        metadatos: {
          modalidadGestion: MODALIDAD_GESTION_MANUAL,
          referenciaManual: datos.referenciaManual?.trim() || null,
        },
        realizadoPorUsuarioId: actor.usuarioId,
        realizadoPorCorreo: usuarioActor?.correo ?? null,
      },
    });

    return { suscripcion, creada: !existente };
  });

  return {
    creada: resultado.creada,
    suscripcion: mapearSuscripcionDTO(organizacionId, resultado.suscripcion),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function actualizarSuscripcionManual(
  organizacionId: string,
  datos: {
    planId?: string;
    estado?: "PRUEBA" | "ACTIVA" | "SUSPENDIDA";
    fechaInicio?: Date;
    fechaFin?: Date | null;
    motivo?: string | null;
    notasInternas?: string | null;
    referenciaManual?: string | null;
  },
  actor: ActorAdminGlobal
) {
  const org = await prisma.organizacion.findUnique({
    where: { id: organizacionId },
    select: { id: true },
  });
  if (!org) {
    throw new ErrorHttp(404, "Organización no encontrada");
  }

  let planSeleccionado: { id: string; activo: boolean; duracionSugeridaDias: number | null } | null = null;
  if (datos.planId) {
    planSeleccionado = await prisma.planSuscripcion.findUnique({
      where: { id: datos.planId },
      select: { id: true, activo: true, duracionSugeridaDias: true },
    });
    if (!planSeleccionado) {
      throw new ErrorHttp(404, "Plan de suscripción no encontrado");
    }
    if (!planSeleccionado.activo) {
      throw new ErrorHttp(422, "No se puede cambiar a un plan inactivo");
    }
  }

  const suscripcionActualizada = await prisma.$transaction(async (tx) => {
    const [existente, usuarioActor] = await Promise.all([
      tx.suscripcionOrganizacion.findUnique({ where: { organizacionId } }),
      tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { correo: true } }),
    ]);

    if (!existente || existente.estado === "SIN_SUSCRIPCION") {
      throw new ErrorHttp(
        422,
        "La organización no tiene una suscripción asignada; usa la asignación manual primero"
      );
    }

    const estadoNuevo: EstadoSuscripcion = datos.estado ?? existente.estado;
    validarTransicionSuscripcion(existente.estado, estadoNuevo);

    const { fechaInicio, fechaFin } = validarYResolverFechasSuscripcion({
      estado: estadoNuevo,
      fechaInicio: datos.fechaInicio !== undefined ? datos.fechaInicio : existente.fechaInicio,
      fechaFin: datos.fechaFin !== undefined ? datos.fechaFin : existente.fechaFin,
      duracionSugeridaDias: planSeleccionado?.duracionSugeridaDias ?? null,
      usarAhoraSiFaltaInicio: false,
    });

    const planNuevoId = datos.planId ?? existente.planId;
    let accion = "CAMBIADA";
    if (estadoNuevo === "SUSPENDIDA" && existente.estado !== "SUSPENDIDA") {
      accion = "SUSPENDIDA";
    } else if (
      existente.estado === "SUSPENDIDA" &&
      (estadoNuevo === "ACTIVA" || estadoNuevo === "PRUEBA")
    ) {
      accion = "REACTIVADA";
    } else if (
      estadoNuevo === existente.estado &&
      planNuevoId === existente.planId &&
      (datos.fechaInicio !== undefined || datos.fechaFin !== undefined)
    ) {
      accion = "FECHAS_ACTUALIZADAS";
    }

    const actualizada = await tx.suscripcionOrganizacion.update({
      where: { id: existente.id },
      data: {
        planId: planNuevoId,
        estado: estadoNuevo,
        fechaInicio,
        fechaFin,
        motivo: datos.motivo !== undefined ? datos.motivo?.trim() || null : undefined,
        notasInternas:
          datos.notasInternas !== undefined ? datos.notasInternas?.trim() || null : undefined,
        referenciaManual:
          datos.referenciaManual !== undefined
            ? datos.referenciaManual?.trim() || null
            : undefined,
      },
      select: seleccionSuscripcion,
    });

    await tx.historialSuscripcion.create({
      data: {
        suscripcionId: existente.id,
        organizacionId,
        accion,
        estadoAnterior: existente.estado,
        estadoNuevo,
        planAnteriorId: existente.planId,
        planNuevoId,
        fechaInicioAnterior: existente.fechaInicio,
        fechaInicioNueva: fechaInicio,
        fechaFinAnterior: existente.fechaFin,
        fechaFinNueva: fechaFin,
        motivo: datos.motivo !== undefined ? datos.motivo?.trim() || null : null,
        notas: datos.notasInternas !== undefined ? datos.notasInternas?.trim() || null : null,
        metadatos: {
          modalidadGestion: MODALIDAD_GESTION_MANUAL,
        },
        realizadoPorUsuarioId: actor.usuarioId,
        realizadoPorCorreo: usuarioActor?.correo ?? null,
      },
    });

    return actualizada;
  });

  return {
    suscripcion: mapearSuscripcionDTO(organizacionId, suscripcionActualizada),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function cancelarSuscripcionManual(
  organizacionId: string,
  datos: {
    motivoCancelacion?: string | null;
    notas?: string | null;
  },
  actor: ActorAdminGlobal
) {
  const org = await prisma.organizacion.findUnique({
    where: { id: organizacionId },
    select: { id: true },
  });
  if (!org) {
    throw new ErrorHttp(404, "Organización no encontrada");
  }

  const suscripcionCancelada = await prisma.$transaction(async (tx) => {
    const [existente, usuarioActor] = await Promise.all([
      tx.suscripcionOrganizacion.findUnique({ where: { organizacionId } }),
      tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { correo: true } }),
    ]);

    if (!existente || existente.estado === "SIN_SUSCRIPCION") {
      throw new ErrorHttp(422, "La organización no tiene una suscripción activa o en prueba para cancelar");
    }

    validarTransicionSuscripcion(existente.estado, "CANCELADA");

    const ahora = new Date();
    const actualizada = await tx.suscripcionOrganizacion.update({
      where: { id: existente.id },
      data: {
        estado: "CANCELADA",
        canceladaPorUsuarioId: actor.usuarioId,
        canceladaEn: ahora,
        motivoCancelacion: datos.motivoCancelacion?.trim() || null,
      },
      select: seleccionSuscripcion,
    });

    await tx.historialSuscripcion.create({
      data: {
        suscripcionId: existente.id,
        organizacionId,
        accion: "CANCELADA",
        estadoAnterior: existente.estado,
        estadoNuevo: "CANCELADA",
        planAnteriorId: existente.planId,
        planNuevoId: existente.planId,
        fechaInicioAnterior: existente.fechaInicio,
        fechaInicioNueva: existente.fechaInicio,
        fechaFinAnterior: existente.fechaFin,
        fechaFinNueva: existente.fechaFin,
        motivo: datos.motivoCancelacion?.trim() || null,
        notas: datos.notas?.trim() || null,
        metadatos: {
          modalidadGestion: MODALIDAD_GESTION_MANUAL,
        },
        realizadoPorUsuarioId: actor.usuarioId,
        realizadoPorCorreo: usuarioActor?.correo ?? null,
      },
    });

    return actualizada;
  });

  return {
    suscripcion: mapearSuscripcionDTO(organizacionId, suscripcionCancelada),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}

export async function listarHistorialSuscripcion(
  organizacionId: string,
  paginacion?: ParametrosPaginacion
) {
  const org = await prisma.organizacion.findUnique({
    where: { id: organizacionId },
    select: { id: true },
  });
  if (!org) {
    throw new ErrorHttp(404, "Organización no encontrada");
  }

  const { pagina, limite, skip } = normalizarPaginacion(paginacion);

  const [total, filas] = await Promise.all([
    prisma.historialSuscripcion.count({ where: { organizacionId } }),
    prisma.historialSuscripcion.findMany({
      where: { organizacionId },
      select: {
        id: true,
        accion: true,
        estadoAnterior: true,
        estadoNuevo: true,
        fechaInicioAnterior: true,
        fechaInicioNueva: true,
        fechaFinAnterior: true,
        fechaFinNueva: true,
        motivo: true,
        notas: true,
        realizadoPorCorreo: true,
        creadoEn: true,
        planAnterior: {
          select: { id: true, codigo: true, nombre: true },
        },
        planNuevo: {
          select: { id: true, codigo: true, nombre: true },
        },
        realizadoPorUsuario: {
          select: { id: true, nombre: true, correo: true },
        },
      },
      orderBy: [{ creadoEn: "desc" }],
      skip,
      take: limite,
    }),
  ]);

  return {
    datos: filas.map(({ realizadoPorUsuario, ...fila }) => ({
      ...fila,
      realizadoPor: realizadoPorUsuario,
      modalidadGestion: MODALIDAD_GESTION_MANUAL,
      etiquetaCobro: ETIQUETA_COBRO_MANUAL,
    })),
    paginacion: construirMetadatosPaginacion(pagina, limite, total),
    modalidadGestion: MODALIDAD_GESTION_MANUAL,
    etiquetaCobro: ETIQUETA_COBRO_MANUAL,
  };
}
