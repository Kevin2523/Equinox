import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { exigirRolOrganizacion } from "../middleware/autenticacion.js";
import type { SolicitudAutenticada } from "../tipos.js";

const textoOpcionalNulable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v));

export const rutasOrganizacion = Router();
const esquema = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  descripcion: textoOpcionalNulable(500),
  moneda: z.string().trim().toUpperCase().length(3).optional(),
  ruc: textoOpcionalNulable(60),
  direccion: textoOpcionalNulable(240),
  telefono: textoOpcionalNulable(40),
  correoContacto: z
    .union([z.string().trim().email().max(120), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  logoUrl: z.string().url().optional().nullable(),
  colorPrimario: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  colorSecundario: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  // La tipografía del portal es fija en el producto; no se acepta cambio vía API (campo legado en DB).
  portalMensajeBienvenida: textoOpcionalNulable(400),
  dominioPortal: z.string().optional().nullable(),
  portalMostrarFinanzas: z.boolean().optional(),
  tipoFreelance: z
    .enum(["GENERAL", "DESARROLLO_SOFTWARE", "FOTOGRAFIA", "DISENO_GRAFICO"])
    .optional(),
});

rutasOrganizacion.get("/", async (req: SolicitudAutenticada, res) =>
  res.json(
    await prisma.organizacion.findUnique({
      where: { id: req.sesion!.organizacionId },
      include: {
        miembros: {
          include: {
            usuario: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                correo: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    })
  )
);

// Solo PROPIETARIO puede modificar los datos de la organización
rutasOrganizacion.patch(
  "/",
  exigirRolOrganizacion("PROPIETARIO"),
  async (req: SolicitudAutenticada, res, next) => {
    try {
      res.json(
        await prisma.organizacion.update({
          where: { id: req.sesion!.organizacionId },
          data: esquema.parse(req.body) as any,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

rutasOrganizacion.patch(
  "/tipo-freelance",
  exigirRolOrganizacion("PROPIETARIO"),
  async (req: SolicitudAutenticada, res, next) => {
    try {
      const { tipoFreelance } = z
        .object({
          tipoFreelance: z.enum([
            "GENERAL",
            "DESARROLLO_SOFTWARE",
            "FOTOGRAFIA",
            "DISENO_GRAFICO",
          ]),
        })
        .parse(req.body);

      res.json(
        await prisma.organizacion.update({
          where: { id: req.sesion!.organizacionId },
          data: { tipoFreelance } as any,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

rutasOrganizacion.get("/panel", async (req: SolicitudAutenticada, res) => {
  const organizacionId = req.sesion!.organizacionId;
  const hoy = new Date();
  const [clientesActivos, proyectosEnCurso, tareasVencidas, proximasTareas, actividadReciente] =
    await Promise.all([
      prisma.cliente.count({ where: { organizacionId, estado: "ACTIVO" } }),
      prisma.proyecto.count({
        where: { organizacionId, estado: { in: ["ACTIVO", "PAUSADO"] } },
      }),
      prisma.tarea.count({
        where: {
          proyecto: { organizacionId },
          estado: { notIn: ["COMPLETADA", "CANCELADA"] },
          fechaVencimiento: { lt: hoy },
        },
      }),
      prisma.tarea.findMany({
        where: {
          proyecto: { organizacionId },
          estado: { notIn: ["COMPLETADA", "CANCELADA"] },
          fechaVencimiento: { not: null },
        },
        include: { proyecto: { select: { id: true, nombre: true } } },
        orderBy: { fechaVencimiento: "asc" },
        take: 8,
      }),
      prisma.actividad.findMany({
        where: { organizacionId },
        include: { usuario: { select: { nombre: true, apellido: true } } },
        orderBy: { creadoEn: "desc" },
        take: 10,
      }),
    ]);
  res.json({
    metricas: { clientesActivos, proyectosEnCurso, tareasVencidas },
    proximasTareas,
    actividadReciente,
  });
});

// Resumen real para la vista previa de configuración, estrictamente aislado por organizacionId
rutasOrganizacion.get("/vista-previa", async (req: SolicitudAutenticada, res, next) => {
  try {
    const organizacionId = req.sesion!.organizacionId;
    const org = await prisma.organizacion.findUnique({
      where: { id: organizacionId },
      select: { tipoFreelance: true, portalMostrarFinanzas: true },
    });
    const modalidad = org?.tipoFreelance || "GENERAL";

    if (modalidad === "FOTOGRAFIA") {
      const sesionSelect = {
        id: true,
        nombre: true,
        descripcion: true,
        estado: true,
        fecha: true,
        clienteId: true,
        cliente: { select: { nombre: true } },
        _count: { select: { fotos: true } },
      } as const;

      const sesionPublicada = await prisma.sesionFotografica.findFirst({
        where: { organizacionId, estado: "PUBLICADA" },
        orderBy: { actualizadoEn: "desc" },
        select: sesionSelect,
      });
      const sesion =
        sesionPublicada ??
        (await prisma.sesionFotografica.findFirst({
          where: { organizacionId },
          orderBy: { actualizadoEn: "desc" },
          select: sesionSelect,
        }));

      const facturas = sesion && org?.portalMostrarFinanzas
        ? await prisma.factura.findMany({
            where: {
              organizacionId,
              clienteId: sesion.clienteId,
              estado: { in: ["ENVIADA", "PAGADA", "VENCIDA"] },
            },
            select: {
              id: true,
              numero: true,
              concepto: true,
              monto: true,
              moneda: true,
              estado: true,
              fechaEmision: true,
              fechaVencimiento: true,
            },
            orderBy: { fechaEmision: "desc" },
            take: 3,
          })
        : [];

      return res.json({
        modalidad,
        clienteNombre: sesion?.cliente?.nombre ?? null,
        sesion: sesion
          ? {
              id: sesion.id,
              nombre: sesion.nombre,
              descripcion: sesion.descripcion,
              estado: sesion.estado,
              fecha: sesion.fecha,
              totalFotos: sesion._count.fotos,
            }
          : null,
        proyecto: null,
        facturas,
      });
    }

    const proyectoSelect = {
      id: true,
      nombre: true,
      descripcion: true,
      estado: true,
      fechaInicio: true,
      fechaEntrega: true,
      clienteId: true,
      cliente: { select: { nombre: true } },
      hitos: {
        where: { visibleEnPortal: true },
        select: { estado: true },
      },
      _count: {
        select: {
          archivos: { where: { visibilidad: "CLIENTE" } },
          comentarios: true,
        },
      },
    } as const;

    const proyectoActivo = await prisma.proyecto.findFirst({
      where: { organizacionId, estado: "ACTIVO" },
      orderBy: { actualizadoEn: "desc" },
      select: proyectoSelect,
    });
    const proyecto =
      proyectoActivo ??
      (await prisma.proyecto.findFirst({
        where: { organizacionId },
        orderBy: { actualizadoEn: "desc" },
        select: proyectoSelect,
      }));

    const facturas = proyecto && org?.portalMostrarFinanzas
      ? await prisma.factura.findMany({
          where: {
            organizacionId,
            clienteId: proyecto.clienteId,
            estado: { in: ["ENVIADA", "PAGADA", "VENCIDA"] },
          },
          select: {
            id: true,
            numero: true,
            concepto: true,
            monto: true,
            moneda: true,
            estado: true,
            fechaEmision: true,
            fechaVencimiento: true,
          },
          orderBy: { fechaEmision: "desc" },
          take: 3,
        })
      : [];

    res.json({
      modalidad,
      clienteNombre: proyecto?.cliente?.nombre ?? null,
      sesion: null,
      proyecto: proyecto
        ? {
            id: proyecto.id,
            nombre: proyecto.nombre,
            descripcion: proyecto.descripcion,
            estado: proyecto.estado,
            fechaInicio: proyecto.fechaInicio,
            fechaEntrega: proyecto.fechaEntrega,
            totalHitos: proyecto.hitos.length,
            hitosCompletados: proyecto.hitos.filter((h) => h.estado === "COMPLETADO").length,
            totalArchivos: proyecto._count.archivos,
            totalComentarios: proyecto._count.comentarios,
          }
        : null,
      facturas,
    });
  } catch (err) {
    next(err);
  }
});
