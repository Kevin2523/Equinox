import { Router } from "express";
import fs from "fs";
import { Readable } from "stream";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";
import {
  guardarArchivoFoto,
  eliminarArchivoFoto,
  resolverRutaSegura,
} from "../servicios/almacenamiento-fotos.js";

export const rutasFotografia = Router();

const uuid = z.string().uuid();

function paramStr(param: string | string[] | undefined, nombre = "id"): string {
  if (typeof param !== "string") throw new ErrorHttp(400, `Parámetro '${nombre}' inválido`);
  return param;
}

const esquemaCrearSesion = z.strictObject({
  nombre: z.string().trim().min(1, "El nombre de la sesión es obligatorio").max(200),
  descripcion: z.string().trim().max(2000).optional().nullable(),
  fecha: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD").optional().nullable(),
  estado: z.enum(["BORRADOR", "PUBLICADA"]).optional(),
});

const esquemaActualizarSesion = z.strictObject({
  nombre: z.string().trim().min(1).max(200).optional(),
  descripcion: z.string().trim().max(2000).optional().nullable(),
  fecha: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD").optional().nullable(),
  estado: z.enum(["BORRADOR", "PUBLICADA"]).optional(),
  portadaFotoId: z.string().uuid().optional().nullable(),
});

const esquemaActualizarFoto = z.strictObject({
  orden: z.number().int().min(0).optional(),
  esPortada: z.boolean().optional(),
});

async function verificarClientePropio(clienteId: string, organizacionId: string) {
  const cId = uuid.parse(clienteId);
  const cliente = await prisma.cliente.findFirst({
    where: { id: cId, organizacionId },
  });
  if (!cliente) {
    throw new ErrorHttp(404, "Cliente no encontrado");
  }
  return cliente;
}

async function verificarSesionPropia(sesionId: string, clienteId: string, organizacionId: string) {
  const sId = uuid.parse(sesionId);
  const cliente = await verificarClientePropio(clienteId, organizacionId);
  const sesion = await prisma.sesionFotografica.findFirst({
    where: { id: sId, clienteId: cliente.id, organizacionId },
    include: { _count: { select: { fotos: true } } },
  });
  if (!sesion) {
    throw new ErrorHttp(404, "Sesión fotográfica no encontrada");
  }
  return sesion;
}

function serializarSesion(sesion: any) {
  return {
    id: sesion.id,
    organizacionId: sesion.organizacionId,
    clienteId: sesion.clienteId,
    nombre: sesion.nombre,
    descripcion: sesion.descripcion,
    fecha: sesion.fecha ? sesion.fecha.toISOString().split("T")[0] : null,
    estado: sesion.estado,
    portadaFotoId: sesion.portadaFotoId,
    cantidadFotos: sesion._count ? sesion._count.fotos : (sesion.cantidadFotos ?? 0),
    creadoEn: sesion.creadoEn,
    actualizadoEn: sesion.actualizadoEn,
  };
}

// 1. GET lista de sesiones fotográficas de un cliente
rutasFotografia.get("/:clienteId/sesiones-fotograficas", async (req: SolicitudAutenticada, res, next) => {
  try {
    const cliente = await verificarClientePropio(paramStr(req.params.clienteId, "clienteId"), req.sesion!.organizacionId);
    const sesiones = await prisma.sesionFotografica.findMany({
      where: { clienteId: cliente.id, organizacionId: req.sesion!.organizacionId },
      include: { _count: { select: { fotos: true } } },
      orderBy: { actualizadoEn: "desc" },
    });
    res.json(sesiones.map(serializarSesion));
  } catch (err) {
    next(err);
  }
});

// 2. POST crea sesión fotográfica para un cliente
rutasFotografia.post("/:clienteId/sesiones-fotograficas", async (req: SolicitudAutenticada, res, next) => {
  try {
    const cliente = await verificarClientePropio(paramStr(req.params.clienteId, "clienteId"), req.sesion!.organizacionId);
    const datos = esquemaCrearSesion.parse(req.body);
    const fecha = datos.fecha ? new Date(`${datos.fecha}T00:00:00Z`) : null;

    const sesion = await prisma.sesionFotografica.create({
      data: {
        organizacionId: req.sesion!.organizacionId,
        clienteId: cliente.id,
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        fecha,
        estado: datos.estado || "BORRADOR",
      },
      include: { _count: { select: { fotos: true } } },
    });

    await registrarActividad({
      organizacionId: req.sesion!.organizacionId,
      usuarioId: req.sesion!.usuarioId,
      entidad: "sesion_fotografica",
      entidadId: sesion.id,
      accion: "CREAR",
      descripcion: `Creó la sesión fotográfica ${sesion.nombre}`,
    });

    res.status(201).json(serializarSesion(sesion));
  } catch (err) {
    next(err);
  }
});

// 3. GET detalle de sesión fotográfica
rutasFotografia.get("/:clienteId/sesiones-fotograficas/:sesionId", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await verificarSesionPropia(
      paramStr(req.params.sesionId, "sesionId"),
      paramStr(req.params.clienteId, "clienteId"),
      req.sesion!.organizacionId
    );
    res.json(serializarSesion(sesion));
  } catch (err) {
    next(err);
  }
});

// 4. PATCH actualiza sesión fotográfica (incluido publicar/despublicar)
rutasFotografia.patch("/:clienteId/sesiones-fotograficas/:sesionId", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await verificarSesionPropia(
      paramStr(req.params.sesionId, "sesionId"),
      paramStr(req.params.clienteId, "clienteId"),
      req.sesion!.organizacionId
    );
    const datos = esquemaActualizarSesion.parse(req.body);

    if (datos.portadaFotoId) {
      const fotoExiste = await prisma.fotoSesion.findFirst({
        where: { id: datos.portadaFotoId, sesionId: sesion.id },
      });
      if (!fotoExiste) {
        throw new ErrorHttp(400, "La foto seleccionada como portada no pertenece a esta sesión");
      }
    }

    const dataActualizacion: any = {};
    if (datos.nombre !== undefined) dataActualizacion.nombre = datos.nombre;
    if (datos.descripcion !== undefined) dataActualizacion.descripcion = datos.descripcion;
    if (datos.fecha !== undefined) {
      dataActualizacion.fecha = datos.fecha ? new Date(`${datos.fecha}T00:00:00Z`) : null;
    }
    if (datos.estado !== undefined) dataActualizacion.estado = datos.estado;
    if (datos.portadaFotoId !== undefined) dataActualizacion.portadaFotoId = datos.portadaFotoId;

    const actualizada = await prisma.sesionFotografica.update({
      where: { id: sesion.id },
      data: dataActualizacion,
      include: { _count: { select: { fotos: true } } },
    });

    await registrarActividad({
      organizacionId: req.sesion!.organizacionId,
      usuarioId: req.sesion!.usuarioId,
      entidad: "sesion_fotografica",
      entidadId: actualizada.id,
      accion: "ACTUALIZAR",
      descripcion: `Actualizó la sesión fotográfica ${actualizada.nombre}`,
    });

    res.json(serializarSesion(actualizada));
  } catch (err) {
    next(err);
  }
});

// 5. DELETE sesión fotográfica si es seguro (solo en BORRADOR)
rutasFotografia.delete("/:clienteId/sesiones-fotograficas/:sesionId", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await verificarSesionPropia(
      paramStr(req.params.sesionId, "sesionId"),
      paramStr(req.params.clienteId, "clienteId"),
      req.sesion!.organizacionId
    );

    if (sesion.estado === "PUBLICADA") {
      throw new ErrorHttp(
        409,
        "No se puede eliminar una sesión fotográfica publicada. Debe despublicarla (cambiar a borrador) primero."
      );
    }

    const fotos = await prisma.fotoSesion.findMany({
      where: { sesionId: sesion.id },
      select: { id: true, almacenamientoKey: true, miniaturaKey: true },
    });

    await prisma.sesionFotografica.delete({
      where: { id: sesion.id },
    });

    for (const foto of fotos) {
      await eliminarArchivoFoto(foto.almacenamientoKey);
      if (foto.miniaturaKey) {
        await eliminarArchivoFoto(foto.miniaturaKey);
      }
    }

    await registrarActividad({
      organizacionId: req.sesion!.organizacionId,
      usuarioId: req.sesion!.usuarioId,
      entidad: "sesion_fotografica",
      entidadId: sesion.id,
      accion: "ELIMINAR",
      descripcion: `Eliminó la sesión fotográfica ${sesion.nombre}`,
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// 6. GET fotos paginado de una sesión
rutasFotografia.get("/:clienteId/sesiones-fotograficas/:sesionId/fotos", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await verificarSesionPropia(
      paramStr(req.params.sesionId, "sesionId"),
      paramStr(req.params.clienteId, "clienteId"),
      req.sesion!.organizacionId
    );
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
  } catch (err) {
    next(err);
  }
});

// 7. POST carga multipart de una foto
rutasFotografia.post("/:clienteId/sesiones-fotograficas/:sesionId/fotos", async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesion = await verificarSesionPropia(
      paramStr(req.params.sesionId, "sesionId"),
      paramStr(req.params.clienteId, "clienteId"),
      req.sesion!.organizacionId
    );

    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      throw new ErrorHttp(400, "La petición debe ser multipart/form-data");
    }

    const webReq = new Request("http://localhost" + req.originalUrl, {
      method: req.method,
      headers: req.headers as any,
      body: Readable.toWeb(req) as any,
      duplex: "half",
    } as any);

    const formData = await webReq.formData();

    let archivoEncontrado: File | null = null;
    for (const [clave, valor] of formData.entries()) {
      if (valor instanceof File && (clave === "foto" || clave === "archivo" || clave === "file" || !archivoEncontrado)) {
        archivoEncontrado = valor;
        if (clave === "foto") break;
      }
    }

    if (!archivoEncontrado) {
      throw new ErrorHttp(400, "No se encontró ningún archivo de foto en el formulario");
    }

    const ordenRaw = formData.get("orden");
    let orden = 0;
    if (ordenRaw !== null && ordenRaw !== undefined && ordenRaw !== "") {
      const num = Number(ordenRaw);
      if (!Number.isNaN(num) && num >= 0) orden = Math.floor(num);
    } else {
      const ultimaFoto = await prisma.fotoSesion.findFirst({
        where: { sesionId: sesion.id },
        orderBy: { orden: "desc" },
        select: { orden: true },
      });
      orden = (ultimaFoto?.orden ?? -1) + 1;
    }

    const esPortadaParam = formData.get("esPortada") === "true" || formData.get("portada") === "true";

    const guardado = await guardarArchivoFoto(archivoEncontrado.stream(), archivoEncontrado.name);

    let fotoCreada: any;
    try {
      fotoCreada = await prisma.$transaction(async (tx) => {
        const foto = await tx.fotoSesion.create({
          data: {
            sesionId: sesion.id,
            almacenamientoKey: guardado.almacenamientoKey,
            nombreOriginal: archivoEncontrado.name || "foto.bin",
            tipoMime: guardado.tipoMime,
            tamanoBytes: guardado.tamanoBytes,
            orden,
          },
        });

        if (esPortadaParam || !sesion.portadaFotoId) {
          await tx.sesionFotografica.update({
            where: { id: sesion.id },
            data: { portadaFotoId: foto.id },
          });
        }

        return foto;
      });
    } catch (dbError) {
      await eliminarArchivoFoto(guardado.almacenamientoKey);
      throw dbError;
    }

    res.status(201).json({
      id: fotoCreada.id,
      sesionId: fotoCreada.sesionId,
      nombreOriginal: fotoCreada.nombreOriginal,
      tipoMime: fotoCreada.tipoMime,
      tamanoBytes: fotoCreada.tamanoBytes,
      orden: fotoCreada.orden,
      esPortada: esPortadaParam || !sesion.portadaFotoId,
      creadoEn: fotoCreada.creadoEn,
    });
  } catch (err) {
    next(err);
  }
});

// Función auxiliar para buscar foto y verificar que pertenezca a la organización
async function obtenerFotoYValidar(
  clienteId: string,
  fotoId: string,
  organizacionId: string,
  sesionId?: string
) {
  const fId = uuid.parse(fotoId);
  const cliente = await verificarClientePropio(clienteId, organizacionId);

  const foto = await prisma.fotoSesion.findFirst({
    where: {
      id: fId,
      sesion: {
        clienteId: cliente.id,
        organizacionId,
        ...(sesionId ? { id: uuid.parse(sesionId) } : {}),
      },
    },
    include: {
      sesion: {
        select: {
          id: true,
          portadaFotoId: true,
          estado: true,
        },
      },
    },
  });

  if (!foto) {
    throw new ErrorHttp(404, "Foto no encontrada");
  }

  return foto;
}

// 8. DELETE foto (soporta ambas rutas: con y sin sesionId)
async function manejadorEliminarFoto(req: SolicitudAutenticada, res: any, next: any) {
  try {
    const foto = await obtenerFotoYValidar(
      paramStr(req.params.clienteId, "clienteId"),
      paramStr(req.params.fotoId, "fotoId"),
      req.sesion!.organizacionId,
      req.params.sesionId ? paramStr(req.params.sesionId, "sesionId") : undefined
    );

    await prisma.$transaction(async (tx) => {
      if (foto.sesion.portadaFotoId === foto.id) {
        await tx.sesionFotografica.update({
          where: { id: foto.sesion.id },
          data: { portadaFotoId: null },
        });
      }
      await tx.fotoSesion.delete({
        where: { id: foto.id },
      });
    });

    await eliminarArchivoFoto(foto.almacenamientoKey);
    if (foto.miniaturaKey) {
      await eliminarArchivoFoto(foto.miniaturaKey);
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

rutasFotografia.delete("/:clienteId/sesiones-fotograficas/:sesionId/fotos/:fotoId", manejadorEliminarFoto);
rutasFotografia.delete("/:clienteId/sesiones-fotograficas/fotos/:fotoId", manejadorEliminarFoto);

// 9. PATCH foto orden/portada (soporta ambas rutas: con y sin sesionId)
async function manejadorActualizarFoto(req: SolicitudAutenticada, res: any, next: any) {
  try {
    const foto = await obtenerFotoYValidar(
      paramStr(req.params.clienteId, "clienteId"),
      paramStr(req.params.fotoId, "fotoId"),
      req.sesion!.organizacionId,
      req.params.sesionId ? paramStr(req.params.sesionId, "sesionId") : undefined
    );

    const datos = esquemaActualizarFoto.parse(req.body);

    const fotoActualizada = await prisma.$transaction(async (tx) => {
      if (datos.esPortada === true) {
        await tx.sesionFotografica.update({
          where: { id: foto.sesion.id },
          data: { portadaFotoId: foto.id },
        });
      } else if (datos.esPortada === false && foto.sesion.portadaFotoId === foto.id) {
        await tx.sesionFotografica.update({
          where: { id: foto.sesion.id },
          data: { portadaFotoId: null },
        });
      }

      if (datos.orden !== undefined) {
        return await tx.fotoSesion.update({
          where: { id: foto.id },
          data: { orden: datos.orden },
        });
      }

      return foto;
    });

    const esPortada = datos.esPortada !== undefined ? datos.esPortada : foto.sesion.portadaFotoId === foto.id;

    res.json({
      id: fotoActualizada.id,
      sesionId: fotoActualizada.sesionId,
      nombreOriginal: fotoActualizada.nombreOriginal,
      tipoMime: fotoActualizada.tipoMime,
      tamanoBytes: fotoActualizada.tamanoBytes,
      orden: fotoActualizada.orden,
      esPortada,
      creadoEn: fotoActualizada.creadoEn,
    });
  } catch (err) {
    next(err);
  }
}

rutasFotografia.patch("/:clienteId/sesiones-fotograficas/:sesionId/fotos/:fotoId", manejadorActualizarFoto);
rutasFotografia.patch("/:clienteId/sesiones-fotograficas/fotos/:fotoId", manejadorActualizarFoto);

// 10. GET contenido binario de la foto (autenticado)
async function manejadorContenidoFoto(req: SolicitudAutenticada, res: any, next: any) {
  try {
    const foto = await obtenerFotoYValidar(
      paramStr(req.params.clienteId, "clienteId"),
      paramStr(req.params.fotoId, "fotoId"),
      req.sesion!.organizacionId,
      req.params.sesionId ? paramStr(req.params.sesionId, "sesionId") : undefined
    );

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
  } catch (err) {
    next(err);
  }
}

rutasFotografia.get("/:clienteId/sesiones-fotograficas/:sesionId/fotos/:fotoId/contenido", manejadorContenidoFoto);
rutasFotografia.get("/:clienteId/sesiones-fotograficas/fotos/:fotoId/contenido", manejadorContenidoFoto);
