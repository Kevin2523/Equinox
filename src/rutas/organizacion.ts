import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";

export const rutasOrganizacion = Router();
const esquema = z.object({ nombre: z.string().min(2).optional(), descripcion: z.string().optional().nullable(), moneda: z.string().length(3).optional(), ruc: z.string().optional().nullable(), direccion: z.string().optional().nullable(), telefono: z.string().optional().nullable(), correoContacto: z.string().email().optional().nullable(), logoUrl: z.string().url().optional().nullable(), colorPrimario: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), colorSecundario: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), tipografia: z.string().min(1).optional(), dominioPortal: z.string().optional().nullable() });

rutasOrganizacion.get("/", async (req: SolicitudAutenticada, res) => res.json(await prisma.organizacion.findUnique({ where: { id: req.sesion!.organizacionId }, include: { miembros: { include: { usuario: { select: { id: true, nombre: true, apellido: true, correo: true, avatarUrl: true } } } } } })));
rutasOrganizacion.patch("/", async (req: SolicitudAutenticada, res) => res.json(await prisma.organizacion.update({ where: { id: req.sesion!.organizacionId }, data: esquema.parse(req.body) })));
rutasOrganizacion.get("/panel", async (req: SolicitudAutenticada, res) => {
  const organizacionId = req.sesion!.organizacionId; const hoy = new Date();
  const [clientesActivos, proyectosEnCurso, tareasVencidas, proximasTareas, actividadReciente] = await Promise.all([
    prisma.cliente.count({ where: { organizacionId, estado: "ACTIVO" } }),
    prisma.proyecto.count({ where: { organizacionId, estado: { in: ["ACTIVO", "PAUSADO"] } } }),
    prisma.tarea.count({ where: { proyecto: { organizacionId }, estado: { notIn: ["COMPLETADA", "CANCELADA"] }, fechaVencimiento: { lt: hoy } } }),
    prisma.tarea.findMany({ where: { proyecto: { organizacionId }, estado: { notIn: ["COMPLETADA", "CANCELADA"] }, fechaVencimiento: { not: null } }, include: { proyecto: { select: { id: true, nombre: true } } }, orderBy: { fechaVencimiento: "asc" }, take: 8 }),
    prisma.actividad.findMany({ where: { organizacionId }, include: { usuario: { select: { nombre: true, apellido: true } } }, orderBy: { creadoEn: "desc" }, take: 10 })
  ]);
  res.json({ metricas: { clientesActivos, proyectosEnCurso, tareasVencidas }, proximasTareas, actividadReciente });
});
