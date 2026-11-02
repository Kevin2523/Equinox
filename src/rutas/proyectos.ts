import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";
import { almacenArchivos, claveDeArchivo, detectarArchivo, recibirMultipart } from "../almacenamiento/archivos.js";
import { enviarArchivo } from "../almacenamiento/descarga.js";

export const rutasProyectos = Router();
const uuid = z.string().uuid();
const proyectoSchema = z.object({ clienteId: uuid, nombre: z.string().min(2), descripcion: z.string().optional().nullable(), estado: z.enum(["BORRADOR", "ACTIVO", "PAUSADO", "COMPLETADO", "CANCELADO"]).optional(), presupuesto: z.coerce.number().nonnegative().optional().nullable(), moneda: z.string().length(3).optional(), fechaInicio: z.coerce.date().optional().nullable(), fechaEntrega: z.coerce.date().optional().nullable() });
const tareaSchema = z.object({ titulo: z.string().min(2), descripcion: z.string().optional().nullable(), estado: z.enum(["PENDIENTE", "EN_PROGRESO", "BLOQUEADA", "COMPLETADA", "CANCELADA"]).optional(), prioridad: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]).optional(), orden: z.number().int().optional(), fechaVencimiento: z.coerce.date().optional().nullable(), hitoId: uuid.optional().nullable(), asignadoAId: uuid.optional().nullable() });
const hitoSchema = z.object({ titulo: z.string().min(2), descripcion: z.string().optional().nullable(), estado: z.enum(["PENDIENTE", "EN_PROGRESO", "COMPLETADO", "VENCIDO"]).optional(), orden: z.number().int().optional(), fechaObjetivo: z.coerce.date().optional().nullable(), visibleEnPortal: z.boolean().optional() });
const archivoSchema = z.strictObject({ nombre: z.string().trim().min(1).max(180).optional(), descripcion: z.string().trim().max(1000).optional(), tipo: z.enum(["ARCHIVO", "ENTREGABLE", "IMAGEN", "DOCUMENTO"]).optional(), visibilidad: z.enum(["INTERNA", "CLIENTE"]).optional() });
const camposArchivo = { id: true, proyectoId: true, nombre: true, nombreOriginal: true, tipoMime: true, tamanoBytes: true, tipo: true, visibilidad: true, descripcion: true, publicadoEn: true, creadoEn: true } as const;
const proyectoPropio = async (id: string, organizacionId: string) => { const p = await prisma.proyecto.findFirst({ where: { id, organizacionId } }); if (!p) throw new ErrorHttp(404, "Proyecto no encontrado"); return p; };
async function validarAsignacion(asignadoAId: string | null | undefined, organizacionId: string) {
  if (!asignadoAId) return;
  const miembro = await prisma.miembroOrganizacion.findUnique({ where: { usuarioId_organizacionId: { usuarioId: asignadoAId, organizacionId } }, select: { usuarioId: true } });
  if (!miembro) throw new ErrorHttp(422, "La persona asignada no pertenece a la organización");
}

rutasProyectos.get("/", async (req: SolicitudAutenticada, res) => res.json(await prisma.proyecto.findMany({ where: { organizacionId: req.sesion!.organizacionId, ...(typeof req.query.estado === "string" && { estado: req.query.estado as never }), ...(typeof req.query.clienteId === "string" && { clienteId: req.query.clienteId }) }, include: { cliente: { select: { id: true, nombre: true, empresa: true } }, _count: { select: { tareas: true, hitos: true } } }, orderBy: { actualizadoEn: "desc" } })));
rutasProyectos.post("/", async (req: SolicitudAutenticada, res) => {
  const datos = proyectoSchema.parse(req.body); const organizacionId = req.sesion!.organizacionId;
  if (!await prisma.cliente.findFirst({ where: { id: datos.clienteId, organizacionId } })) throw new ErrorHttp(422, "El cliente no pertenece a tu organización");
  const proyecto = await prisma.proyecto.create({ data: { ...datos, organizacionId, creadoPorId: req.sesion!.usuarioId } });
  await registrarActividad({ organizacionId, usuarioId: req.sesion!.usuarioId, entidad: "proyecto", entidadId: proyecto.id, accion: "CREAR", descripcion: `Creó el proyecto ${proyecto.nombre}` }); res.status(201).json(proyecto);
});
rutasProyectos.get("/:id", async (req: SolicitudAutenticada, res) => { const id = uuid.parse(req.params.id); await proyectoPropio(id, req.sesion!.organizacionId); res.json(await prisma.proyecto.findUnique({ where: { id }, include: { cliente: true, tareas: { orderBy: [{ orden: "asc" }, { creadoEn: "asc" }] }, hitos: { orderBy: { orden: "asc" } }, archivos: { select: camposArchivo, orderBy: { creadoEn: "desc" } }, comentarios: { include: { usuario: { select: { nombre: true, apellido: true } }, accesoPortal: { select: { nombre: true, correo: true } } }, orderBy: { creadoEn: "asc" } }, accesosPortal: true } })); });
rutasProyectos.patch("/:id", async (req: SolicitudAutenticada, res) => { const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId); const datos = proyectoSchema.partial().parse(req.body); if (datos.clienteId && !await prisma.cliente.findFirst({ where: { id: datos.clienteId, organizacionId: p.organizacionId } })) throw new ErrorHttp(422, "El cliente no pertenece a tu organización"); res.json(await prisma.proyecto.update({ where: { id: p.id }, data: { ...datos, ...(datos.estado === "COMPLETADO" && { completadoEn: new Date() }) } })); });
rutasProyectos.delete("/:id", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  await prisma.$transaction(async (tx) => {
    const bloqueado = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM proyectos WHERE id = ${p.id}::uuid AND organizacion_id = ${p.organizacionId}::uuid FOR UPDATE`;
    if (!bloqueado.length) throw new ErrorHttp(404, "Proyecto no encontrado");
    if (await tx.archivo.count({ where: { proyectoId: p.id } })) throw new ErrorHttp(409, "Elimina los archivos del proyecto antes de eliminarlo");
    await tx.proyecto.delete({ where: { id: p.id } });
  });
  res.status(204).end();
});

rutasProyectos.get("/:id/tareas", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  res.json(await prisma.tarea.findMany({ where: { proyectoId: p.id }, orderBy: [{ orden: "asc" }, { creadoEn: "asc" }] }));
});
rutasProyectos.post("/:id/tareas", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const datos = tareaSchema.parse(req.body);
  if (datos.hitoId && !await prisma.hito.findFirst({ where: { id: datos.hitoId, proyectoId: p.id } })) throw new ErrorHttp(422, "El hito no pertenece al proyecto");
  await validarAsignacion(datos.asignadoAId, p.organizacionId);
  const creada = await prisma.$transaction(async (tx) => {
    const tarea = await tx.tarea.create({ data: { ...datos, proyectoId: p.id, ...(datos.estado === "COMPLETADA" && { completadaEn: new Date() }) } });
    if (datos.estado === "COMPLETADA") await registrarActividad({ organizacionId: p.organizacionId, usuarioId: req.sesion!.usuarioId, entidad: "tarea", entidadId: tarea.id, accion: "COMPLETAR", metadatos: { proyectoId: p.id } }, tx);
    return tarea;
  });
  res.status(201).json(creada);
});
rutasProyectos.patch("/:id/tareas/:tareaId", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const tarea = await prisma.tarea.findFirst({ where: { id: uuid.parse(req.params.tareaId), proyectoId: p.id } });
  if (!tarea) throw new ErrorHttp(404, "Tarea no encontrada");
  const datos = tareaSchema.partial().parse(req.body);
  if (datos.hitoId && !await prisma.hito.findFirst({ where: { id: datos.hitoId, proyectoId: p.id } })) throw new ErrorHttp(422, "El hito no pertenece al proyecto");
  await validarAsignacion(datos.asignadoAId, p.organizacionId);
  const actualizada = await prisma.$transaction(async (tx) => {
    if (datos.estado === "COMPLETADA") {
      const completadaEn = new Date();
      const cambio = await tx.tarea.updateMany({ where: { id: tarea.id, proyectoId: p.id, estado: { not: "COMPLETADA" } },
        data: { ...datos, completadaEn } });
      if (cambio.count) {
        await registrarActividad({ organizacionId: p.organizacionId, usuarioId: req.sesion!.usuarioId, entidad: "tarea", entidadId: tarea.id, accion: "COMPLETAR", metadatos: { proyectoId: p.id } }, tx);
        return tx.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
      }
      return tx.tarea.update({ where: { id: tarea.id, proyectoId: p.id }, data: datos });
    }
    return tx.tarea.update({ where: { id: tarea.id, proyectoId: p.id }, data: { ...datos,
      ...(datos.estado && { completadaEn: null }) } });
  });
  res.json(actualizada);
});
rutasProyectos.delete("/:id/tareas/:tareaId", async (req: SolicitudAutenticada, res) => { const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId); const tarea = await prisma.tarea.findFirst({ where: { id: uuid.parse(req.params.tareaId), proyectoId: p.id } }); if (!tarea) throw new ErrorHttp(404, "Tarea no encontrada"); await prisma.tarea.delete({ where: { id: tarea.id } }); res.status(204).end(); });

rutasProyectos.get("/:id/hitos", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  res.json(await prisma.hito.findMany({ where: { proyectoId: p.id }, orderBy: [{ orden: "asc" }, { creadoEn: "asc" }] }));
});
rutasProyectos.post("/:id/hitos", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const datos = hitoSchema.parse(req.body);
  res.status(201).json(await prisma.hito.create({ data: { ...datos, proyectoId: p.id, visibleEnPortal: datos.visibleEnPortal ?? false,
    ...(datos.estado === "COMPLETADO" && { completadoEn: new Date() }) } }));
});
rutasProyectos.patch("/:id/hitos/:hitoId", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const hito = await prisma.hito.findFirst({ where: { id: uuid.parse(req.params.hitoId), proyectoId: p.id } });
  if (!hito) throw new ErrorHttp(404, "Hito no encontrado");
  const datos = hitoSchema.partial().parse(req.body);
  res.json(await prisma.hito.update({ where: { id: hito.id }, data: { ...datos,
    ...(datos.estado && { completadoEn: datos.estado === "COMPLETADO" ? hito.completadoEn || new Date() : null }) } }));
});
rutasProyectos.delete("/:id/hitos/:hitoId", async (req: SolicitudAutenticada, res) => { const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId); const h = await prisma.hito.findFirst({ where: { id: uuid.parse(req.params.hitoId), proyectoId: p.id } }); if (!h) throw new ErrorHttp(404, "Hito no encontrado"); await prisma.hito.delete({ where: { id: h.id } }); res.status(204).end(); });

rutasProyectos.get("/:id/archivos", async (req: SolicitudAutenticada, res) => { const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId); res.json(await prisma.archivo.findMany({ where: { proyectoId: p.id }, select: camposArchivo, orderBy: { creadoEn: "desc" } })); });
rutasProyectos.post("/:id/archivos", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const { archivo, campos } = await recibirMultipart(req);
  const datos = archivoSchema.parse(campos);
  const { extension, mime } = detectarArchivo(archivo.nombre, archivo.mime, archivo.bytes);
  const clave = await almacenArchivos.guardar(archivo.bytes, extension);
  try {
    const creado = await prisma.$transaction(async (tx) => {
      const bloqueado = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM proyectos WHERE id = ${p.id}::uuid AND organizacion_id = ${p.organizacionId}::uuid FOR UPDATE`;
      if (!bloqueado.length) throw new ErrorHttp(404, "Proyecto no encontrado");
      return tx.archivo.create({ data: { proyectoId: p.id, nombre: datos.nombre || archivo.nombre,
        nombreOriginal: archivo.nombre, url: `local:${clave}`, tipoMime: mime, tamanoBytes: archivo.bytes.length,
        tipo: datos.tipo || "ARCHIVO", visibilidad: datos.visibilidad || "INTERNA", descripcion: datos.descripcion || null,
        publicadoEn: datos.visibilidad === "CLIENTE" ? new Date() : null }, select: camposArchivo });
    });
    res.status(201).json(creado);
  } catch (error) {
    await almacenArchivos.eliminar(clave).catch(() => { console.error("No se pudo limpiar un archivo cuya metadata falló"); });
    throw error;
  }
});
rutasProyectos.get("/:id/archivos/:archivoId/descargar", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const archivo = await prisma.archivo.findFirst({ where: { id: uuid.parse(req.params.archivoId), proyectoId: p.id }, select: { url: true, nombreOriginal: true, tipoMime: true } });
  if (!archivo) throw new ErrorHttp(404, "Archivo no encontrado");
  await enviarArchivo(res, archivo);
});
rutasProyectos.delete("/:id/archivos/:archivoId", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const archivo = await prisma.archivo.findFirst({ where: { id: uuid.parse(req.params.archivoId), proyectoId: p.id } });
  if (!archivo) throw new ErrorHttp(404, "Archivo no encontrado");
  const apartada = await almacenArchivos.apartar(claveDeArchivo(archivo.url));
  try { await prisma.archivo.delete({ where: { id: archivo.id } }); }
  catch (error) { await apartada.restaurar(); throw error; }
  try { await apartada.confirmar(); }
  catch {
    try { await apartada.restaurar(); await prisma.archivo.create({ data: archivo }); }
    catch { console.error("No se pudo compensar completamente una eliminación de archivo"); }
    throw new ErrorHttp(500, "No se pudo confirmar la eliminación del archivo");
  }
  res.status(204).end();
});

rutasProyectos.get("/:id/comentarios", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  res.json(await prisma.comentario.findMany({ where: { proyectoId: p.id }, select: { id: true, autor: true, contenido: true, creadoEn: true,
    usuario: { select: { nombre: true, apellido: true } } }, orderBy: { creadoEn: "asc" } }));
});
rutasProyectos.post("/:id/comentarios", async (req: SolicitudAutenticada, res) => {
  const p = await proyectoPropio(uuid.parse(req.params.id), req.sesion!.organizacionId);
  const { contenido } = z.strictObject({ contenido: z.string().trim().min(1).max(2000) }).parse(req.body);
  const creado = await prisma.$transaction(async (tx) => {
    const comentario = await tx.comentario.create({ data: { proyectoId: p.id, usuarioId: req.sesion!.usuarioId, autor: "FREELANCER", contenido },
      select: { id: true, autor: true, contenido: true, creadoEn: true, usuario: { select: { nombre: true, apellido: true } } } });
    await registrarActividad({ organizacionId: p.organizacionId, usuarioId: req.sesion!.usuarioId, entidad: "comentario", entidadId: comentario.id,
      accion: "COMENTAR", metadatos: { proyectoId: p.id } }, tx);
    return comentario;
  });
  res.status(201).json(creado);
});
