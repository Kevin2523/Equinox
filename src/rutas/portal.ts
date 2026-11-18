import fs from "fs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";
import { resolverRutaSegura } from "../servicios/almacenamiento-fotos.js";

export const rutasPortal = Router();
const uuid = z.string().uuid();
const esquemaComentario = z.strictObject({ contenido: z.string().trim().min(1).max(2000) });

function contexto(req: SolicitudAutenticada) {
  const sesion = req.sesion!;
  if (sesion.tipoAcceso !== "CLIENTE") throw new ErrorHttp(403, "Acceso restringido a cuentas de cliente");
  return {
    clienteId: sesion.clienteId,
    organizacionId: sesion.organizacionId,
    usuarioId: sesion.usuarioId,
    rolCliente: sesion.rolCliente,
  };
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
        organizacion: {
          select: {
            nombre: true,
            logoUrl: true,
            colorPrimario: true,
            colorSecundario: true,
            tipografia: true,
            portalMensajeBienvenida: true,
            tipoFreelance: true,
          },
        },
      },
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
    const { clienteId, organizacionId, rolCliente } = contexto(req);
    if (rolCliente !== "TITULAR") {
      throw new ErrorHttp(403, "Solo el titular del cliente tiene acceso a las facturas");
    }
    const organizacion = await prisma.organizacion.findUnique({
      where: { id: organizacionId },
      select: { portalMostrarFinanzas: true },
    });
    const habilitado = Boolean(organizacion?.portalMostrarFinanzas);
    res.setHeader("X-Portal-Finanzas", habilitado ? "habilitado" : "deshabilitado");
    if (!habilitado) return res.json([]);
    res.json(await prisma.factura.findMany({
      where: { clienteId, organizacionId, estado: { in: ["ENVIADA", "PAGADA", "VENCIDA"] } },
      select: { id: true, proyectoId: true, numero: true, concepto: true, monto: true, moneda: true,
        estado: true, fechaEmision: true, fechaVencimiento: true, pagadaEn: true },
      orderBy: { fechaEmision: "desc" },
    }));
  } catch (err) { next(err); }
});

async function sesionFotograficaPortalAutorizada(req: SolicitudAutenticada) {
  const sesionId = uuid.parse(req.params.sesionId);
  const { clienteId, organizacionId } = contexto(req);
  const sesion = await prisma.sesionFotografica.findFirst({
    where: { id: sesionId, clienteId, organizacionId, estado: "PUBLICADA" },
    include: { _count: { select: { fotos: true } } },
  });
  if (!sesion) throw new ErrorHttp(404, "Sesión fotográfica no encontrada");
  return sesion;
}

rutasPortal.get("/sesiones-fotograficas", async (req: SolicitudAutenticada, res, next) => {
  try {
    const { clienteId, organizacionId } = contexto(req);
    const sesiones = await prisma.sesionFotografica.findMany({
      where: { clienteId, organizacionId, estado: "PUBLICADA" },
      include: { _count: { select: { fotos: true } } },
      orderBy: { actualizadoEn: "desc" },
    });
    res.json(sesiones.map((s) => ({
      id: s.id,
      organizacionId: s.organizacionId,
      clienteId: s.clienteId,
      nombre: s.nombre,
      descripcion: s.descripcion,
      fecha: s.fecha ? s.fecha.toISOString().split("T")[0] : null,
      estado: s.estado,
      portadaFotoId: s.portadaFotoId,
      cantidadFotos: s._count.fotos,
      creadoEn: s.creadoEn,
      actualizadoEn: s.actualizadoEn,
    })));
  } catch (err) { next(err); }
});

rutasPortal.get("/sesiones-fotograficas/:sesionId", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await sesionFotograficaPortalAutorizada(req);
    res.json({
      id: sesion.id,
      organizacionId: sesion.organizacionId,
      clienteId: sesion.clienteId,
      nombre: sesion.nombre,
      descripcion: sesion.descripcion,
      fecha: sesion.fecha ? sesion.fecha.toISOString().split("T")[0] : null,
      estado: sesion.estado,
      portadaFotoId: sesion.portadaFotoId,
      cantidadFotos: sesion._count.fotos,
      creadoEn: sesion.creadoEn,
      actualizadoEn: sesion.actualizadoEn,
    });
  } catch (err) { next(err); }
});

rutasPortal.get("/sesiones-fotograficas/:sesionId/fotos", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await sesionFotograficaPortalAutorizada(req);
    const pagina = Math.max(1, parseInt(req.query.pagina as string, 10) || 1);
    const limite = Math.min(100, Math.max(1, parseInt(req.query.limite as string, 10) || 20));

    const total = await prisma.fotoSesion.count({
      where: { sesionId: sesion.id },
    });

    const fotos = await prisma.fotoSesion.findMany({
      where: { sesionId: sesion.id },
      orderBy: [{ orden: "asc" }, { creadoEn: "asc" }],
      skip: (pagina - 1) * limite,
      take: limite,
      select: {
        id: true,
        sesionId: true,
        nombreOriginal: true,
        tipoMime: true,
        tamanoBytes: true,
        orden: true,
        creadoEn: true,
      },
    });

    const items = fotos.map((f) => ({
      ...f,
      esPortada: f.id === sesion.portadaFotoId,
    }));

    res.json({
      items,
      total,
      pagina,
      limite,
    });
  } catch (err) { next(err); }
});

rutasPortal.get("/sesiones-fotograficas/:sesionId/fotos/:fotoId/contenido", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await sesionFotograficaPortalAutorizada(req);
    const fotoId = uuid.parse(req.params.fotoId);
    const foto = await prisma.fotoSesion.findFirst({
      where: { id: fotoId, sesionId: sesion.id },
    });
    if (!foto) throw new ErrorHttp(404, "Foto no encontrada");

    const variante = req.query.variante === "miniatura" ? "miniatura" : "original";
    const claveAUsar = variante === "miniatura" && foto.miniaturaKey ? foto.miniaturaKey : foto.almacenamientoKey;
    const rutaArchivo = resolverRutaSegura(claveAUsar);

    if (!fs.existsSync(rutaArchivo)) {
      throw new ErrorHttp(404, "El archivo de imagen no se encuentra en el almacenamiento");
    }

    const stat = await fs.promises.stat(rutaArchivo);

    res.setHeader("Content-Type", foto.tipoMime);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(foto.nombreOriginal)}"`);
    res.setHeader("Cache-Control", "private, no-transform, max-age=3600");

    const stream = fs.createReadStream(rutaArchivo);
    stream.on("error", (err) => next(err));
    stream.pipe(res);
  } catch (err) { next(err); }
});
