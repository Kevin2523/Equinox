import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";

export const rutasPortal = Router();
const uuid = z.string().uuid();
const esquemaComentario = z.strictObject({ contenido: z.string().trim().min(1).max(2000) });

function contexto(req: SolicitudAutenticada) {
  const sesion = req.sesion!;
  if (sesion.tipoAcceso !== "CLIENTE") throw new ErrorHttp(403, "Acceso restringido a cuentas de cliente");
  return { clienteId: sesion.clienteId, organizacionId: sesion.organizacionId, usuarioId: sesion.usuarioId };
}

async function proyectoAutorizado(req: SolicitudAutenticada) {
  const proyectoId = uuid.parse(req.params.proyectoId);
  const { clienteId, organizacionId } = contexto(req);
  const proyecto = await prisma.proyecto.findFirst({
    where: { id: proyectoId, clienteId, organizacionId },
    select: { id: true, nombre: true, descripcion: true, estado: true, fechaInicio: true, fechaEntrega: true },
  });
  if (!proyecto) throw new ErrorHttp(404, "Proyecto no encontrado");
  return proyecto;
}

rutasPortal.get("/", async (req: SolicitudAutenticada, res, next) => {
  try {
    const { clienteId, organizacionId } = contexto(req);
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, organizacionId },
      select: { id: true, nombre: true, empresa: true,
        organizacion: { select: { nombre: true, logoUrl: true, colorPrimario: true, colorSecundario: true, tipografia: true } } },
    });
    if (!cliente) throw new ErrorHttp(404, "Cliente no encontrado");
    res.json({ cliente: { id: cliente.id, nombre: cliente.nombre, empresa: cliente.empresa }, estudio: cliente.organizacion });
  } catch (err) { next(err); }
});

rutasPortal.get("/proyectos", async (req: SolicitudAutenticada, res, next) => {
  try {
    const { clienteId, organizacionId } = contexto(req);
    res.json(await prisma.proyecto.findMany({
      where: { clienteId, organizacionId },
      select: { id: true, nombre: true, descripcion: true, estado: true, fechaInicio: true, fechaEntrega: true },
      orderBy: { actualizadoEn: "desc" },
    }));
  } catch (err) { next(err); }
});

rutasPortal.get("/proyectos/:proyectoId", async (req: SolicitudAutenticada, res, next) => {
  try { res.json(await proyectoAutorizado(req)); } catch (err) { next(err); }
});

rutasPortal.get("/proyectos/:proyectoId/hitos", async (req: SolicitudAutenticada, res, next) => {
  try {
    const proyecto = await proyectoAutorizado(req);
    res.json(await prisma.hito.findMany({
      where: { proyectoId: proyecto.id, visibleEnPortal: true },
      select: { id: true, titulo: true, descripcion: true, estado: true, orden: true, fechaObjetivo: true, completadoEn: true },
      orderBy: [{ orden: "asc" }, { creadoEn: "asc" }],
    }));
  } catch (err) { next(err); }
});

rutasPortal.get("/proyectos/:proyectoId/archivos", async (req: SolicitudAutenticada, res, next) => {
  try {
    const proyecto = await proyectoAutorizado(req);
    res.json(await prisma.archivo.findMany({
      where: { proyectoId: proyecto.id, visibilidad: "CLIENTE" },
      select: { id: true, nombre: true, descripcion: true, url: true, tipoMime: true, tamanoBytes: true, tipo: true, publicadoEn: true },
      orderBy: { creadoEn: "desc" },
    }));
  } catch (err) { next(err); }
});

rutasPortal.get("/proyectos/:proyectoId/comentarios", async (req: SolicitudAutenticada, res, next) => {
  try {
    const proyecto = await proyectoAutorizado(req);
    res.json(await prisma.comentario.findMany({
      where: { proyectoId: proyecto.id },
      select: { id: true, autor: true, contenido: true, creadoEn: true,
        usuario: { select: { nombre: true, apellido: true } } },
      orderBy: { creadoEn: "asc" },
    }));
  } catch (err) { next(err); }
});

rutasPortal.post("/proyectos/:proyectoId/comentarios", async (req: SolicitudAutenticada, res, next) => {
  try {
    const proyectoId = uuid.parse(req.params.proyectoId);
    const { contenido } = esquemaComentario.parse(req.body);
    const { clienteId, organizacionId, usuarioId } = contexto(req);
    const comentario = await prisma.$transaction(async (tx) => {
      const acceso = await tx.accesoCliente.findFirst({ where: { clienteId, organizacionId, usuarioId, activo: true }, select: { id: true } });
      if (!acceso) throw new ErrorHttp(403, "Acceso de cliente inactivo o no autorizado");
      const proyecto = await tx.proyecto.findFirst({ where: { id: proyectoId, clienteId, organizacionId }, select: { id: true } });
      if (!proyecto) throw new ErrorHttp(404, "Proyecto no encontrado");
      const creado = await tx.comentario.create({
        data: { proyectoId: proyecto.id, usuarioId, autor: "CLIENTE", contenido },
        select: { id: true, autor: true, contenido: true, creadoEn: true,
          usuario: { select: { nombre: true, apellido: true } } },
      });
      await registrarActividad({ organizacionId, usuarioId, entidad: "comentario", entidadId: creado.id,
        accion: "COMENTAR", metadatos: { proyectoId: proyecto.id } }, tx);
      return creado;
    });
    res.status(201).json(comentario);
  } catch (err) { next(err); }
});

rutasPortal.get("/facturas", async (req: SolicitudAutenticada, res, next) => {
  try {
    const { clienteId, organizacionId } = contexto(req);
    const organizacion = await prisma.organizacion.findUnique({ where: { id: organizacionId }, select: { portalMostrarFinanzas: true } });
    if (!organizacion?.portalMostrarFinanzas) return res.json([]);
    res.json(await prisma.factura.findMany({
      where: { clienteId, organizacionId, estado: { in: ["ENVIADA", "PAGADA", "VENCIDA"] } },
      select: { id: true, proyectoId: true, numero: true, concepto: true, monto: true, moneda: true,
        estado: true, fechaEmision: true, fechaVencimiento: true, pagadaEn: true },
      orderBy: { fechaEmision: "desc" },
    }));
  } catch (err) { next(err); }
});
