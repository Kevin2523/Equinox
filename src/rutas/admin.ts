import { Router } from "express";
import type { NextFunction, Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import {
  extraerContextoRequestAuditoria,
  registrarAuditoriaAdmin,
} from "../servicios/auditoria.js";

export const rutasAdmin = Router();

const TIPOS_FREELANCE = [
  "GENERAL",
  "DESARROLLO_SOFTWARE",
  "FOTOGRAFIA",
  "DISENO_GRAFICO",
] as const;

const ESTADOS_SUSCRIPCION = [
  "SIN_SUSCRIPCION",
  "PRUEBA",
  "ACTIVA",
  "SUSPENDIDA",
  "CANCELADA",
] as const;

const esquemaUuid = z.string().uuid();

const esquemaPaginacion = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

const esquemaListarOrganizaciones = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(120).optional(),
  tipoFreelance: z.enum(TIPOS_FREELANCE).optional(),
  estadoSuscripcion: z.enum(ESTADOS_SUSCRIPCION).optional(),
  suspendida: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

const esquemaSuspenderOrganizacion = z.object({
  confirmar: z.literal(true),
  motivo: z.string().trim().min(3).max(500),
});

const esquemaReactivarOrganizacion = z.object({
  confirmar: z.literal(true),
  motivo: z.string().trim().max(500).optional(),
});

const textoOpcionalNulable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v));

const esquemaActualizarOrganizacion = z
  .object({
    nombre: z.string().trim().min(2).max(120).optional(),
    correoContacto: z
      .union([z.string().trim().email().max(120), z.literal("")])
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    ruc: textoOpcionalNulable(60),
    moneda: z.string().trim().toUpperCase().length(3).optional(),
    tipoFreelance: z.enum(TIPOS_FREELANCE).optional(),
    portalMostrarFinanzas: z.boolean().optional(),
    motivo: z.string().trim().max(500).optional(),
  })
  .refine(
    (datos) =>
      datos.nombre !== undefined ||
      datos.correoContacto !== undefined ||
      datos.ruc !== undefined ||
      datos.moneda !== undefined ||
      datos.tipoFreelance !== undefined ||
      datos.portalMostrarFinanzas !== undefined,
    { message: "Debe especificar al menos un campo para actualizar" }
  );

const esquemaListarUsuarios = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(120).optional(),
  rolPlataforma: z.enum(["USUARIO", "ADMIN_GLOBAL"]).optional(),
  tipoAcceso: z.enum(["ORGANIZACION", "CLIENTE", "ADMIN_GLOBAL"]).optional(),
  organizacionId: esquemaUuid.optional(),
});

const esquemaRevocarSesiones = z.object({
  sesionId: esquemaUuid.optional(),
  motivo: z.string().trim().max(500).optional(),
});

const esquemaActualizarAccesoCliente = z.object({
  activo: z.boolean(),
  motivo: z.string().trim().max(500).optional(),
});

const esquemaActualizarRolMiembro = z.object({
  rol: z.enum(["PROPIETARIO", "COLABORADOR"]),
  motivo: z.string().trim().max(500).optional(),
});

const esquemaListarAuditoria = esquemaPaginacion.extend({
  accion: z.string().trim().max(120).optional(),
  entidad: z.string().trim().max(120).optional(),
  entidadId: z.string().trim().max(128).optional(),
  actorUsuarioId: esquemaUuid.optional(),
  organizacionId: esquemaUuid.optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  busqueda: z.string().trim().max(120).optional(),
});

function construirPaginacion(pagina: number, limite: number, total: number) {
  return {
    pagina,
    limite,
    total,
    totalPaginas: total === 0 ? 0 : Math.ceil(total / limite),
  };
}

function formatearSuscripcionResumen(
  suscripcion: {
    id: string;
    estado: (typeof ESTADOS_SUSCRIPCION)[number];
    fechaInicio: Date | null;
    fechaFin: Date | null;
    plan: { id: string; codigo: string; nombre: string } | null;
  } | null
) {
  if (!suscripcion) {
    return {
      id: null,
      estado: "SIN_SUSCRIPCION" as const,
      plan: null,
      fechaInicio: null,
      fechaFin: null,
      modalidadGestion: "MANUAL_SIN_COBRO" as const,
    };
  }

  return {
    id: suscripcion.id,
    estado: suscripcion.estado,
    plan: suscripcion.plan,
    fechaInicio: suscripcion.fechaInicio,
    fechaFin: suscripcion.fechaFin,
    modalidadGestion: "MANUAL_SIN_COBRO" as const,
  };
}

async function obtenerActorCorreo(usuarioId: string): Promise<string | null> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { correo: true },
  });
  return usuario?.correo ?? null;
}

// Defensa en profundidad: exige sesión ADMIN_GLOBAL con MFA verificado aunque el router se monte de forma aislada.
rutasAdmin.use((req: SolicitudAutenticada, _res: Response, next: NextFunction) => {
  const sesion = req.sesion as
    | {
        tipoAcceso?: string;
        rolPlataforma?: string;
        mfaVerificado?: boolean;
      }
    | undefined;

  if (!sesion) {
    return next(new ErrorHttp(401, "Se requiere autenticación"));
  }
  if (
    sesion.tipoAcceso !== "ADMIN_GLOBAL" ||
    sesion.rolPlataforma !== "ADMIN_GLOBAL" ||
    sesion.mfaVerificado !== true
  ) {
    return next(new ErrorHttp(403, "Acceso restringido a superadministradores con MFA verificado"));
  }
  next();
});

rutasAdmin.get("/resumen", async (_req: SolicitudAutenticada, res, next) => {
  try {
    const ahora = new Date();
    const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalOrganizaciones,
      organizacionesSuspendidas,
      orgsPorTipo,
      suscripcionesPorEstado,
      totalUsuarios,
      usuariosVerificados,
      usuariosConOrg,
      usuariosConCliente,
      adminsGlobales,
      sesionesActivas,
      clientes,
      proyectos,
      facturas,
      sesionesFotograficas,
      fotos,
      eventosTotales,
      eventosUltimas24h,
      actividadReciente,
    ] = await Promise.all([
      prisma.organizacion.count(),
      prisma.organizacion.count({ where: { suspendidaEn: { not: null } } }),
      prisma.organizacion.groupBy({ by: ["tipoFreelance"], _count: { _all: true } }),
      prisma.suscripcionOrganizacion.groupBy({ by: ["estado"], _count: { _all: true } }),
      prisma.usuario.count(),
      prisma.usuario.count({ where: { correoVerificadoEn: { not: null } } }),
      prisma.usuario.count({ where: { membresias: { some: {} } } }),
      prisma.usuario.count({ where: { accesosCliente: { some: { activo: true } } } }),
      prisma.usuario.count({ where: { rolPlataforma: "ADMIN_GLOBAL" } }),
      prisma.sesion.count({ where: { revocadaEn: null, expiraEn: { gt: ahora } } }),
      prisma.cliente.count(),
      prisma.proyecto.count(),
      prisma.factura.count(),
      prisma.sesionFotografica.count(),
      prisma.fotoSesion.count(),
      prisma.auditoriaAdmin.count(),
      prisma.auditoriaAdmin.count({ where: { creadoEn: { gte: hace24h } } }),
      prisma.auditoriaAdmin.findMany({
        orderBy: { creadoEn: "desc" },
        take: 10,
        select: {
          id: true,
          accion: true,
          entidad: true,
          entidadId: true,
          organizacionId: true,
          resultado: true,
          actorUsuarioId: true,
          actorCorreo: true,
          actorUsuario: {
            select: {
              nombre: true,
              apellido: true,
            },
          },
          creadoEn: true,
        },
      }),
    ]);

    const porTipoFreelance = Object.fromEntries(
      TIPOS_FREELANCE.map((tipo) => [tipo, 0])
    ) as Record<(typeof TIPOS_FREELANCE)[number], number>;
    for (const fila of orgsPorTipo) {
      porTipoFreelance[fila.tipoFreelance] = fila._count._all;
    }

    const porEstadoSuscripcion = Object.fromEntries(
      ESTADOS_SUSCRIPCION.map((estado) => [estado, 0])
    ) as Record<(typeof ESTADOS_SUSCRIPCION)[number], number>;
    let orgsConRegistroSuscripcion = 0;
    for (const fila of suscripcionesPorEstado) {
      porEstadoSuscripcion[fila.estado] = fila._count._all;
      orgsConRegistroSuscripcion += fila._count._all;
    }
    porEstadoSuscripcion.SIN_SUSCRIPCION += Math.max(
      0,
      totalOrganizaciones - orgsConRegistroSuscripcion
    );

    const actividadRecienteMapeada = actividadReciente.map(({ actorUsuario, ...ev }) => ({
      ...ev,
      actorNombre: actorUsuario
        ? [actorUsuario.nombre, actorUsuario.apellido].filter(Boolean).join(" ").trim() || null
        : null,
    }));

    res.json({
      organizaciones: {
        total: totalOrganizaciones,
        activas: Math.max(0, totalOrganizaciones - organizacionesSuspendidas),
        suspendidas: organizacionesSuspendidas,
        porTipoFreelance,
        porEstadoSuscripcion,
      },
      usuarios: {
        total: totalUsuarios,
        verificados: usuariosVerificados,
        conAccesoOrganizacion: usuariosConOrg,
        conAccesoCliente: usuariosConCliente,
        adminsGlobales,
        sesionesActivas,
      },
      operacion: {
        clientes,
        proyectos,
        facturas,
        sesionesFotograficas,
        fotos,
      },
      auditoria: {
        eventosTotales,
        eventosUltimas24h,
      },
      actividadReciente: actividadRecienteMapeada,
    });
  } catch (err) {
    next(err);
  }
});

rutasAdmin.get("/organizaciones", async (req: SolicitudAutenticada, res, next) => {
  try {
    const query = esquemaListarOrganizaciones.parse(req.query);
    const condiciones: Prisma.OrganizacionWhereInput[] = [];

    if (query.busqueda) {
      condiciones.push({
        OR: [
          { nombre: { contains: query.busqueda, mode: "insensitive" } },
          { slug: { contains: query.busqueda, mode: "insensitive" } },
          { correoContacto: { contains: query.busqueda, mode: "insensitive" } },
          { ruc: { contains: query.busqueda, mode: "insensitive" } },
          {
            miembros: {
              some: {
                rol: "PROPIETARIO",
                usuario: { correo: { contains: query.busqueda, mode: "insensitive" } },
              },
            },
          },
        ],
      });
    }
    if (query.tipoFreelance) {
      condiciones.push({ tipoFreelance: query.tipoFreelance });
    }
    if (query.estadoSuscripcion) {
      if (query.estadoSuscripcion === "SIN_SUSCRIPCION") {
        condiciones.push({
          OR: [
            { suscripcion: { is: null } },
            { suscripcion: { is: { estado: "SIN_SUSCRIPCION" } } },
          ],
        });
      } else {
        condiciones.push({ suscripcion: { is: { estado: query.estadoSuscripcion } } });
      }
    }
    if (query.suspendida !== undefined) {
      condiciones.push(
        query.suspendida
          ? { suspendidaEn: { not: null } }
          : { suspendidaEn: null }
      );
    }

    const where: Prisma.OrganizacionWhereInput = condiciones.length > 0 ? { AND: condiciones } : {};

    const [total, totalGlobal, suspendidasGlobal, organizaciones] = await Promise.all([
      prisma.organizacion.count({ where }),
      prisma.organizacion.count(),
      prisma.organizacion.count({ where: { suspendidaEn: { not: null } } }),
      prisma.organizacion.findMany({
        where,
        orderBy: { creadoEn: "desc" },
        skip: (query.pagina - 1) * query.limite,
        take: query.limite,
        select: {
          id: true,
          nombre: true,
          slug: true,
          correoContacto: true,
          ruc: true,
          moneda: true,
          tipoFreelance: true,
          portalMostrarFinanzas: true,
          suspendidaEn: true,
          motivoSuspension: true,
          suspendidaPorUsuarioId: true,
          creadoEn: true,
          actualizadoEn: true,
          _count: {
            select: {
              miembros: true,
              clientes: true,
              proyectos: true,
              facturas: true,
              sesionesFotograficas: true,
            },
          },
          miembros: {
            where: { rol: "PROPIETARIO" },
            select: {
              usuario: {
                select: { id: true, nombre: true, apellido: true, correo: true },
              },
            },
          },
          suscripcion: {
            select: {
              id: true,
              estado: true,
              fechaInicio: true,
              fechaFin: true,
              plan: { select: { id: true, codigo: true, nombre: true } },
            },
          },
        },
      }),
    ]);

    const orgIds = organizaciones.map((org) => org.id);
    const fotosPorOrg = new Map<string, number>();
    if (orgIds.length > 0) {
      const sesionesConFotos = await prisma.sesionFotografica.findMany({
        where: { organizacionId: { in: orgIds } },
        select: {
          organizacionId: true,
          _count: { select: { fotos: true } },
        },
      });
      for (const sesion of sesionesConFotos) {
        fotosPorOrg.set(
          sesion.organizacionId,
          (fotosPorOrg.get(sesion.organizacionId) ?? 0) + sesion._count.fotos
        );
      }
    }

    res.json({
      datos: organizaciones.map((org) => ({
        id: org.id,
        nombre: org.nombre,
        slug: org.slug,
        correoContacto: org.correoContacto,
        ruc: org.ruc,
        moneda: org.moneda,
        tipoFreelance: org.tipoFreelance,
        portalMostrarFinanzas: org.portalMostrarFinanzas,
        suspendida: org.suspendidaEn !== null,
        suspendidaEn: org.suspendidaEn,
        motivoSuspension: org.motivoSuspension,
        suspendidaPorUsuarioId: org.suspendidaPorUsuarioId,
        creadoEn: org.creadoEn,
        actualizadoEn: org.actualizadoEn,
        conteos: {
          ...org._count,
          fotos: fotosPorOrg.get(org.id) ?? 0,
        },
        propietarios: org.miembros.map((m) => m.usuario),
        suscripcion: formatearSuscripcionResumen(org.suscripcion),
      })),
      resumen: {
        total: totalGlobal,
        activas: Math.max(0, totalGlobal - suspendidasGlobal),
        suspendidas: suspendidasGlobal,
      },
      paginacion: construirPaginacion(query.pagina, query.limite, total),
    });
  } catch (err) {
    next(err);
  }
});

async function cargarDetalleOrganizacion(organizacionId: string) {
  const [org, totalFotos, auditoriaReciente] = await Promise.all([
    prisma.organizacion.findUnique({
      where: { id: organizacionId },
      select: {
        id: true,
        nombre: true,
        slug: true,
        descripcion: true,
        moneda: true,
        ruc: true,
        direccion: true,
        telefono: true,
        correoContacto: true,
        tipoFreelance: true,
        portalMostrarFinanzas: true,
        dominioPortal: true,
        suspendidaEn: true,
        motivoSuspension: true,
        suspendidaPorUsuarioId: true,
        creadoEn: true,
        actualizadoEn: true,
        _count: {
          select: {
            miembros: true,
            clientes: true,
            proyectos: true,
            facturas: true,
            sesionesFotograficas: true,
          },
        },
        miembros: {
          orderBy: { creadoEn: "asc" },
          select: {
            id: true,
            usuarioId: true,
            rol: true,
            creadoEn: true,
            usuario: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                correo: true,
                rolPlataforma: true,
                ultimoAccesoEn: true,
              },
            },
          },
        },
        suscripcion: {
          select: {
            id: true,
            estado: true,
            fechaInicio: true,
            fechaFin: true,
            plan: { select: { id: true, codigo: true, nombre: true } },
          },
        },
      },
    }),
    prisma.fotoSesion.count({
      where: { sesion: { organizacionId } },
    }),
    prisma.auditoriaAdmin.findMany({
      where: {
        OR: [
          { organizacionId },
          { entidad: "Organizacion", entidadId: organizacionId },
        ],
      },
      orderBy: { creadoEn: "desc" },
      take: 10,
      select: {
        id: true,
        actorUsuarioId: true,
        actorCorreo: true,
        accion: true,
        entidad: true,
        entidadId: true,
        resultado: true,
        metadatos: true,
        creadoEn: true,
      },
    }),
  ]);

  if (!org) return null;

  return {
    id: org.id,
    nombre: org.nombre,
    slug: org.slug,
    descripcion: org.descripcion,
    moneda: org.moneda,
    ruc: org.ruc,
    direccion: org.direccion,
    telefono: org.telefono,
    correoContacto: org.correoContacto,
    tipoFreelance: org.tipoFreelance,
    portalMostrarFinanzas: org.portalMostrarFinanzas,
    dominioPortal: org.dominioPortal,
    suspendida: org.suspendidaEn !== null,
    suspendidaEn: org.suspendidaEn,
    motivoSuspension: org.motivoSuspension,
    suspendidaPorUsuarioId: org.suspendidaPorUsuarioId,
    creadoEn: org.creadoEn,
    actualizadoEn: org.actualizadoEn,
    conteos: {
      ...org._count,
      fotos: totalFotos,
    },
    miembros: org.miembros,
    suscripcion: {
      ...formatearSuscripcionResumen(org.suscripcion),
      etiquetaCobro: "Manual, sin cobro procesado" as const,
    },
    auditoriaReciente,
  };
}

rutasAdmin.get("/organizaciones/:organizacionId", async (req: SolicitudAutenticada, res, next) => {
  try {
    const organizacionId = esquemaUuid.parse(req.params.organizacionId);
    const organizacion = await cargarDetalleOrganizacion(organizacionId);
    if (!organizacion) {
      throw new ErrorHttp(404, "Organización no encontrada");
    }
    res.json({ organizacion });
  } catch (err) {
    next(err);
  }
});

rutasAdmin.patch("/organizaciones/:organizacionId", async (req: SolicitudAutenticada, res, next) => {
  try {
    const organizacionId = esquemaUuid.parse(req.params.organizacionId);
    const { motivo, ...cambios } = esquemaActualizarOrganizacion.parse(req.body);
    const contextoReq = extraerContextoRequestAuditoria(req);
    const actorCorreo = await obtenerActorCorreo(req.sesion!.usuarioId);

    await prisma.$transaction(async (tx) => {
      const actual = await tx.organizacion.findUnique({
        where: { id: organizacionId },
        select: {
          id: true,
          nombre: true,
          correoContacto: true,
          ruc: true,
          moneda: true,
          tipoFreelance: true,
          portalMostrarFinanzas: true,
        },
      });
      if (!actual) {
        throw new ErrorHttp(404, "Organización no encontrada");
      }

      const actualizada = await tx.organizacion.update({
        where: { id: organizacionId },
        data: cambios,
        select: {
          nombre: true,
          correoContacto: true,
          ruc: true,
          moneda: true,
          tipoFreelance: true,
          portalMostrarFinanzas: true,
        },
      });

      await registrarAuditoriaAdmin(
        {
          actorUsuarioId: req.sesion!.usuarioId,
          actorCorreo,
          accion: "ORGANIZACION_ACTUALIZADA",
          entidad: "Organizacion",
          entidadId: organizacionId,
          organizacionId,
          resultado: "EXITO",
          ...contextoReq,
          metadatos: {
            antes: {
              nombre: actual.nombre,
              correoContacto: actual.correoContacto,
              ruc: actual.ruc,
              moneda: actual.moneda,
              tipoFreelance: actual.tipoFreelance,
              portalMostrarFinanzas: actual.portalMostrarFinanzas,
            },
            despues: actualizada,
            motivo: motivo ?? null,
          } as Prisma.InputJsonValue,
        },
        tx
      );
    });

    const organizacion = await cargarDetalleOrganizacion(organizacionId);
    res.json({ organizacion });
  } catch (err) {
    next(err);
  }
});

rutasAdmin.patch(
  "/organizaciones/:organizacionId/miembros/:miembroId",
  async (req: SolicitudAutenticada, res, next) => {
    try {
      const organizacionId = esquemaUuid.parse(req.params.organizacionId);
      const miembroId = esquemaUuid.parse(req.params.miembroId);
      const { rol, motivo } = esquemaActualizarRolMiembro.parse(req.body);
      const contextoReq = extraerContextoRequestAuditoria(req);
      const actorCorreo = await obtenerActorCorreo(req.sesion!.usuarioId);

      const miembroActualizado = await prisma.$transaction(async (tx) => {
        const miembro = await tx.miembroOrganizacion.findFirst({
          where: { id: miembroId, organizacionId },
          select: { id: true, usuarioId: true, organizacionId: true, rol: true },
        });
        if (!miembro) {
          throw new ErrorHttp(404, "Miembro no encontrado en esta organización");
        }

        if (miembro.rol === "PROPIETARIO" && rol !== "PROPIETARIO") {
          const totalPropietarios = await tx.miembroOrganizacion.count({
            where: { organizacionId, rol: "PROPIETARIO" },
          });
          if (totalPropietarios <= 1) {
            throw new ErrorHttp(
              422,
              "No se puede degradar al último propietario de la organización"
            );
          }
        }

        const actualizado = await tx.miembroOrganizacion.update({
          where: { id: miembro.id },
          data: { rol },
          select: {
            id: true,
            usuarioId: true,
            organizacionId: true,
            rol: true,
            creadoEn: true,
            usuario: {
              select: { id: true, nombre: true, apellido: true, correo: true },
            },
          },
        });

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: req.sesion!.usuarioId,
            actorCorreo,
            accion: "MIEMBRO_ROL_ACTUALIZADO",
            entidad: "MiembroOrganizacion",
            entidadId: miembro.id,
            organizacionId,
            resultado: "EXITO",
            ...contextoReq,
            metadatos: {
              usuarioId: miembro.usuarioId,
              antes: { rol: miembro.rol },
              despues: { rol: actualizado.rol },
              motivo: motivo ?? null,
            } as Prisma.InputJsonValue,
          },
          tx
        );

        return actualizado;
      });

      res.json({ miembro: miembroActualizado });
    } catch (err) {
      next(err);
    }
  }
);

rutasAdmin.post(
  "/organizaciones/:organizacionId/suspender",
  async (req: SolicitudAutenticada, res, next) => {
    try {
      const organizacionId = esquemaUuid.parse(req.params.organizacionId);
      const { motivo } = esquemaSuspenderOrganizacion.parse(req.body);
      const contextoReq = extraerContextoRequestAuditoria(req);
      const actorCorreo = await obtenerActorCorreo(req.sesion!.usuarioId);

      const sesionesRevocadas = await prisma.$transaction(async (tx) => {
        const org = await tx.organizacion.findUnique({
          where: { id: organizacionId },
          select: { id: true, nombre: true, suspendidaEn: true },
        });
        if (!org) {
          throw new ErrorHttp(404, "Organización no encontrada");
        }
        if (org.suspendidaEn !== null) {
          throw new ErrorHttp(409, "La organización ya se encuentra suspendida");
        }

        const ahora = new Date();
        await tx.organizacion.update({
          where: { id: organizacionId },
          data: {
            suspendidaEn: ahora,
            motivoSuspension: motivo,
            suspendidaPorUsuarioId: req.sesion!.usuarioId,
          },
        });

        const [miembros, accesosCliente] = await Promise.all([
          tx.miembroOrganizacion.findMany({
            where: { organizacionId },
            select: { usuarioId: true },
          }),
          tx.accesoCliente.findMany({
            where: { organizacionId },
            select: { usuarioId: true },
          }),
        ]);

        const usuariosVinculados = Array.from(
          new Set([
            ...miembros.map((m) => m.usuarioId),
            ...accesosCliente.map((a) => a.usuarioId),
          ])
        );

        let revocadas = 0;
        if (usuariosVinculados.length > 0) {
          const resultado = await tx.sesion.updateMany({
            where: {
              usuarioId: { in: usuariosVinculados },
              tipoAcceso: { in: ["ORGANIZACION", "CLIENTE"] },
              revocadaEn: null,
              expiraEn: { gt: ahora },
              id: { not: req.sesion!.sesionId },
            },
            data: { revocadaEn: ahora },
          });
          revocadas = resultado.count;
        }

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: req.sesion!.usuarioId,
            actorCorreo,
            accion: "ORGANIZACION_SUSPENDIDA",
            entidad: "Organizacion",
            entidadId: organizacionId,
            organizacionId,
            resultado: "EXITO",
            ...contextoReq,
            metadatos: {
              motivo,
              sesionesRevocadas: revocadas,
            } as Prisma.InputJsonValue,
          },
          tx
        );

        return revocadas;
      });

      const organizacion = await cargarDetalleOrganizacion(organizacionId);
      res.json({ organizacion, sesionesRevocadas });
    } catch (err) {
      next(err);
    }
  }
);

rutasAdmin.post(
  "/organizaciones/:organizacionId/reactivar",
  async (req: SolicitudAutenticada, res, next) => {
    try {
      const organizacionId = esquemaUuid.parse(req.params.organizacionId);
      const { motivo } = esquemaReactivarOrganizacion.parse(req.body);
      const contextoReq = extraerContextoRequestAuditoria(req);
      const actorCorreo = await obtenerActorCorreo(req.sesion!.usuarioId);

      await prisma.$transaction(async (tx) => {
        const org = await tx.organizacion.findUnique({
          where: { id: organizacionId },
          select: { id: true, suspendidaEn: true, motivoSuspension: true },
        });
        if (!org) {
          throw new ErrorHttp(404, "Organización no encontrada");
        }
        if (org.suspendidaEn === null) {
          throw new ErrorHttp(409, "La organización no está suspendida");
        }

        await tx.organizacion.update({
          where: { id: organizacionId },
          data: {
            suspendidaEn: null,
            motivoSuspension: null,
            suspendidaPorUsuarioId: null,
          },
        });

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: req.sesion!.usuarioId,
            actorCorreo,
            accion: "ORGANIZACION_REACTIVADA",
            entidad: "Organizacion",
            entidadId: organizacionId,
            organizacionId,
            resultado: "EXITO",
            ...contextoReq,
            metadatos: {
              motivoAnterior: org.motivoSuspension,
              motivo: motivo ?? null,
            } as Prisma.InputJsonValue,
          },
          tx
        );
      });

      const organizacion = await cargarDetalleOrganizacion(organizacionId);
      res.json({ organizacion });
    } catch (err) {
      next(err);
    }
  }
);

rutasAdmin.get("/usuarios", async (req: SolicitudAutenticada, res, next) => {
  try {
    const query = esquemaListarUsuarios.parse(req.query);
    const ahora = new Date();
    const condiciones: Prisma.UsuarioWhereInput[] = [];

    if (query.busqueda) {
      condiciones.push({
        OR: [
          { correo: { contains: query.busqueda, mode: "insensitive" } },
          { nombre: { contains: query.busqueda, mode: "insensitive" } },
          { apellido: { contains: query.busqueda, mode: "insensitive" } },
        ],
      });
    }
    if (query.rolPlataforma) {
      condiciones.push({ rolPlataforma: query.rolPlataforma });
    }
    if (query.tipoAcceso === "ADMIN_GLOBAL") {
      condiciones.push({ rolPlataforma: "ADMIN_GLOBAL" });
    } else if (query.tipoAcceso === "ORGANIZACION") {
      condiciones.push({ membresias: { some: {} } });
    } else if (query.tipoAcceso === "CLIENTE") {
      condiciones.push({ accesosCliente: { some: {} } });
    }
    if (query.organizacionId) {
      condiciones.push({
        OR: [
          { membresias: { some: { organizacionId: query.organizacionId } } },
          { accesosCliente: { some: { organizacionId: query.organizacionId } } },
        ],
      });
    }

    const where: Prisma.UsuarioWhereInput = condiciones.length > 0 ? { AND: condiciones } : {};

    const [total, usuarios] = await Promise.all([
      prisma.usuario.count({ where }),
      prisma.usuario.findMany({
        where,
        orderBy: { creadoEn: "desc" },
        skip: (query.pagina - 1) * query.limite,
        take: query.limite,
        select: {
          id: true,
          correo: true,
          nombre: true,
          apellido: true,
          telefono: true,
          rolPlataforma: true,
          correoVerificadoEn: true,
          ultimoAccesoEn: true,
          creadoEn: true,
          _count: {
            select: {
              sesiones: {
                where: { revocadaEn: null, expiraEn: { gt: ahora } },
              },
            },
          },
          membresias: {
            select: {
              id: true,
              organizacionId: true,
              rol: true,
              organizacion: { select: { nombre: true, slug: true, tipoFreelance: true } },
            },
          },
          accesosCliente: {
            select: {
              id: true,
              organizacionId: true,
              clienteId: true,
              rol: true,
              activo: true,
              organizacion: { select: { nombre: true, tipoFreelance: true } },
              cliente: { select: { nombre: true } },
            },
          },
        },
      }),
    ]);

    res.json({
      datos: usuarios.map((u) => ({
        id: u.id,
        correo: u.correo,
        nombre: u.nombre,
        apellido: u.apellido,
        telefono: u.telefono,
        rolPlataforma: u.rolPlataforma,
        correoVerificadoEn: u.correoVerificadoEn,
        ultimoAccesoEn: u.ultimoAccesoEn,
        creadoEn: u.creadoEn,
        sesionesActivasCount: u._count.sesiones,
        membresias: u.membresias.map((m) => ({
          id: m.id,
          organizacionId: m.organizacionId,
          organizacionNombre: m.organizacion.nombre,
          organizacionSlug: m.organizacion.slug,
          tipoFreelance: m.organizacion.tipoFreelance,
          rol: m.rol,
        })),
        accesosCliente: u.accesosCliente.map((a) => ({
          id: a.id,
          organizacionId: a.organizacionId,
          organizacionNombre: a.organizacion.nombre,
          tipoFreelance: a.organizacion.tipoFreelance,
          clienteId: a.clienteId,
          clienteNombre: a.cliente.nombre,
          rol: a.rol,
          activo: a.activo,
        })),
      })),
      paginacion: construirPaginacion(query.pagina, query.limite, total),
    });
  } catch (err) {
    next(err);
  }
});

rutasAdmin.get("/usuarios/:usuarioId", async (req: SolicitudAutenticada, res, next) => {
  try {
    const usuarioId = esquemaUuid.parse(req.params.usuarioId);
    const ahora = new Date();

    const [usuario, auditoriaReciente] = await Promise.all([
      prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: {
          id: true,
          correo: true,
          nombre: true,
          apellido: true,
          telefono: true,
          zonaHoraria: true,
          rolPlataforma: true,
          mfaHabilitado: true,
          correoVerificadoEn: true,
          ultimoAccesoEn: true,
          creadoEn: true,
          actualizadoEn: true,
          membresias: {
            select: {
              id: true,
              organizacionId: true,
              rol: true,
              creadoEn: true,
              organizacion: { select: { nombre: true, slug: true, tipoFreelance: true } },
            },
          },
          accesosCliente: {
            select: {
              id: true,
              organizacionId: true,
              clienteId: true,
              rol: true,
              activo: true,
              ultimoAccesoEn: true,
              creadoEn: true,
              organizacion: { select: { nombre: true, tipoFreelance: true } },
              cliente: { select: { nombre: true } },
            },
          },
          sesiones: {
            where: { revocadaEn: null, expiraEn: { gt: ahora } },
            orderBy: { creadoEn: "desc" },
            select: {
              id: true,
              tipoAcceso: true,
              mfaVerificado: true,
              creadoEn: true,
              expiraEn: true,
            },
          },
        },
      }),
      prisma.auditoriaAdmin.findMany({
        where: {
          OR: [
            { actorUsuarioId: usuarioId },
            { entidad: "Usuario", entidadId: usuarioId },
          ],
        },
        orderBy: { creadoEn: "desc" },
        take: 10,
        select: {
          id: true,
          actorUsuarioId: true,
          actorCorreo: true,
          accion: true,
          entidad: true,
          entidadId: true,
          resultado: true,
          metadatos: true,
          creadoEn: true,
        },
      }),
    ]);

    if (!usuario) {
      throw new ErrorHttp(404, "Usuario no encontrado");
    }

    res.json({
      usuario: {
        id: usuario.id,
        correo: usuario.correo,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        telefono: usuario.telefono,
        zonaHoraria: usuario.zonaHoraria,
        rolPlataforma: usuario.rolPlataforma,
        mfaHabilitado: usuario.mfaHabilitado,
        correoVerificadoEn: usuario.correoVerificadoEn,
        ultimoAccesoEn: usuario.ultimoAccesoEn,
        creadoEn: usuario.creadoEn,
        actualizadoEn: usuario.actualizadoEn,
        membresias: usuario.membresias.map((m) => ({
          id: m.id,
          organizacionId: m.organizacionId,
          organizacionNombre: m.organizacion.nombre,
          organizacionSlug: m.organizacion.slug,
          tipoFreelance: m.organizacion.tipoFreelance,
          rol: m.rol,
          creadoEn: m.creadoEn,
        })),
        accesosCliente: usuario.accesosCliente.map((a) => ({
          id: a.id,
          organizacionId: a.organizacionId,
          organizacionNombre: a.organizacion.nombre,
          tipoFreelance: a.organizacion.tipoFreelance,
          clienteId: a.clienteId,
          clienteNombre: a.cliente.nombre,
          rol: a.rol,
          activo: a.activo,
          ultimoAccesoEn: a.ultimoAccesoEn,
          creadoEn: a.creadoEn,
        })),
        sesionesActivas: usuario.sesiones,
        auditoriaReciente,
      },
    });
  } catch (err) {
    next(err);
  }
});

rutasAdmin.post(
  "/usuarios/:usuarioId/revocar-sesiones",
  async (req: SolicitudAutenticada, res, next) => {
    try {
      const usuarioId = esquemaUuid.parse(req.params.usuarioId);
      const { sesionId, motivo } = esquemaRevocarSesiones.parse(req.body ?? {});
      const contextoReq = extraerContextoRequestAuditoria(req);
      const actorCorreo = await obtenerActorCorreo(req.sesion!.usuarioId);

      if (sesionId && sesionId === req.sesion!.sesionId) {
        throw new ErrorHttp(422, "No puedes revocar tu sesión administrativa actual");
      }

      const sesionesRevocadas = await prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.findUnique({
          where: { id: usuarioId },
          select: { id: true, correo: true },
        });
        if (!usuario) {
          throw new ErrorHttp(404, "Usuario no encontrado");
        }

        const ahora = new Date();
        let count = 0;

        if (sesionId) {
          const sesion = await tx.sesion.findFirst({
            where: { id: sesionId, usuarioId },
            select: { id: true, revocadaEn: true },
          });
          if (!sesion) {
            throw new ErrorHttp(404, "Sesión no encontrada para este usuario");
          }
          if (!sesion.revocadaEn) {
            await tx.sesion.update({
              where: { id: sesionId },
              data: { revocadaEn: ahora },
            });
            count = 1;
          }
        } else {
          const resultado = await tx.sesion.updateMany({
            where: {
              usuarioId,
              revocadaEn: null,
              expiraEn: { gt: ahora },
              id: { not: req.sesion!.sesionId },
            },
            data: { revocadaEn: ahora },
          });
          count = resultado.count;
        }

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: req.sesion!.usuarioId,
            actorCorreo,
            accion: sesionId ? "SESION_REVOCADA" : "SESIONES_REVOCADAS",
            entidad: "Usuario",
            entidadId: usuarioId,
            resultado: "EXITO",
            ...contextoReq,
            metadatos: {
              usuarioObjetivoCorreo: usuario.correo,
              sesionId: sesionId ?? null,
              sesionesRevocadas: count,
              motivo: motivo ?? null,
            } as Prisma.InputJsonValue,
          },
          tx
        );

        return count;
      });

      res.json({ usuarioId, sesionesRevocadas });
    } catch (err) {
      next(err);
    }
  }
);

rutasAdmin.patch(
  "/usuarios/:usuarioId/accesos-cliente/:accesoId",
  async (req: SolicitudAutenticada, res, next) => {
    try {
      const usuarioId = esquemaUuid.parse(req.params.usuarioId);
      const accesoId = esquemaUuid.parse(req.params.accesoId);
      const { activo, motivo } = esquemaActualizarAccesoCliente.parse(req.body);
      const contextoReq = extraerContextoRequestAuditoria(req);
      const actorCorreo = await obtenerActorCorreo(req.sesion!.usuarioId);

      const accesoActualizado = await prisma.$transaction(async (tx) => {
        const acceso = await tx.accesoCliente.findFirst({
          where: { id: accesoId, usuarioId },
          select: {
            id: true,
            usuarioId: true,
            organizacionId: true,
            clienteId: true,
            rol: true,
            activo: true,
          },
        });

        if (!acceso) {
          throw new ErrorHttp(404, "Acceso de cliente no encontrado para este usuario");
        }

        const actualizado = await tx.accesoCliente.update({
          where: { id: acceso.id },
          data: { activo },
          select: {
            id: true,
            usuarioId: true,
            organizacionId: true,
            clienteId: true,
            rol: true,
            activo: true,
            actualizadoEn: true,
          },
        });

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: req.sesion!.usuarioId,
            actorCorreo,
            accion: "ACCESO_CLIENTE_ACTUALIZADO",
            entidad: "AccesoCliente",
            entidadId: acceso.id,
            organizacionId: acceso.organizacionId,
            resultado: "EXITO",
            ...contextoReq,
            metadatos: {
              usuarioId,
              clienteId: acceso.clienteId,
              antes: { activo: acceso.activo },
              despues: { activo: actualizado.activo },
              motivo: motivo ?? null,
            } as Prisma.InputJsonValue,
          },
          tx
        );

        return actualizado;
      });

      res.json({ acceso: accesoActualizado });
    } catch (err) {
      next(err);
    }
  }
);

rutasAdmin.get("/auditoria", async (req: SolicitudAutenticada, res, next) => {
  try {
    const query = esquemaListarAuditoria.parse(req.query);
    if (query.desde && query.hasta && query.desde > query.hasta) {
      throw new ErrorHttp(422, "La fecha 'desde' no puede ser posterior a 'hasta'");
    }

    const condiciones: Prisma.AuditoriaAdminWhereInput[] = [];

    if (query.accion) {
      condiciones.push({ accion: query.accion });
    }
    if (query.entidad) {
      condiciones.push({ entidad: query.entidad });
    }
    if (query.entidadId) {
      condiciones.push({ entidadId: query.entidadId });
    }
    if (query.actorUsuarioId) {
      condiciones.push({ actorUsuarioId: query.actorUsuarioId });
    }
    if (query.organizacionId) {
      condiciones.push({
        OR: [
          { organizacionId: query.organizacionId },
          { entidad: "Organizacion", entidadId: query.organizacionId },
        ],
      });
    }
    if (query.desde || query.hasta) {
      condiciones.push({
        creadoEn: {
          ...(query.desde ? { gte: query.desde } : {}),
          ...(query.hasta ? { lte: query.hasta } : {}),
        },
      });
    }
    if (query.busqueda) {
      condiciones.push({
        OR: [
          { accion: { contains: query.busqueda, mode: "insensitive" } },
          { entidad: { contains: query.busqueda, mode: "insensitive" } },
          { entidadId: { contains: query.busqueda, mode: "insensitive" } },
          { actorCorreo: { contains: query.busqueda, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.AuditoriaAdminWhereInput = condiciones.length > 0 ? { AND: condiciones } : {};

    const [total, eventos] = await Promise.all([
      prisma.auditoriaAdmin.count({ where }),
      prisma.auditoriaAdmin.findMany({
        where,
        orderBy: { creadoEn: "desc" },
        skip: (query.pagina - 1) * query.limite,
        take: query.limite,
        select: {
          id: true,
          actorUsuarioId: true,
          actorCorreo: true,
          accion: true,
          entidad: true,
          entidadId: true,
          organizacionId: true,
          resultado: true,
          ip: true,
          userAgent: true,
          metadatos: true,
          creadoEn: true,
        },
      }),
    ]);

    res.json({
      datos: eventos,
      paginacion: construirPaginacion(query.pagina, query.limite, total),
    });
  } catch (err) {
    next(err);
  }
});
