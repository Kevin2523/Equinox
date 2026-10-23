import { randomUUID } from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import {
  exigirAutenticacion,
  firmarToken,
  hashToken,
} from "../middleware/autenticacion.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";

export const rutasAutenticacion = Router();

// Hash bcrypt ficticio válido para mitigar ataques de timing / enumeración de cuentas
const HASH_FICTICIO_BCRYPT = "$2a$12$e80yq9e/tGf0zE1k7oW79.vN80n7P83XQh3q3w3o5sE1p2r3t4u5v";

const cuentaRegistro = z.object({
  correo: z.string().email(),
  contrasena: z.string().min(8),
  nombre: z.string().min(2),
  apellido: z.string().optional(),
  nombreEstudio: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
});

const seleccionContexto = z.discriminatedUnion("tipoAcceso", [
  z.object({
    tipoAcceso: z.literal("ORGANIZACION"),
    organizacionId: z.string().uuid(),
  }),
  z.object({
    tipoAcceso: z.literal("CLIENTE"),
    organizacionId: z.string().uuid(),
    clienteId: z.string().uuid(),
  }),
]);

const inicioSesionEsquema = z.object({
  correo: z.string().email(),
  contrasena: z.string().min(1),
  seleccion: seleccionContexto.optional(),
});

rutasAutenticacion.post("/registro", async (req, res, next) => {
  try {
    const datos = cuentaRegistro.parse(req.body);
    const correoNormalizado = datos.correo.trim().toLowerCase();

    const existeCorreo = await prisma.usuario.findUnique({
      where: { correo: correoNormalizado },
    });
    if (existeCorreo) {
      throw new ErrorHttp(409, "Ya existe una cuenta con ese correo");
    }

    const existeSlug = await prisma.organizacion.findUnique({
      where: { slug: datos.slug },
    });
    if (existeSlug) {
      throw new ErrorHttp(409, "Ya existe una organización con ese slug");
    }

    const contrasenaHash = await bcrypt.hash(datos.contrasena, 12);
    const sesionId = randomUUID();

    try {
      const resultado = await prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.create({
          data: {
            correo: correoNormalizado,
            contrasenaHash,
            nombre: datos.nombre,
            apellido: datos.apellido,
          },
        });

        const organizacion = await tx.organizacion.create({
          data: {
            nombre: datos.nombreEstudio,
            slug: datos.slug,
          },
        });

        await tx.miembroOrganizacion.create({
          data: {
            usuarioId: usuario.id,
            organizacionId: organizacion.id,
            rol: "PROPIETARIO",
          },
        });

        const sesionToken = firmarToken(
          {
            tipoAcceso: "ORGANIZACION",
            usuarioId: usuario.id,
            organizacionId: organizacion.id,
            rolOrganizacion: "PROPIETARIO",
          },
          sesionId
        );

        const tokenCalculadoHash = hashToken(sesionToken.token);

        await tx.sesion.create({
          data: {
            id: sesionId,
            usuarioId: usuario.id,
            tokenHash: tokenCalculadoHash,
            expiraEn: sesionToken.expiraEn,
          },
        });

        return {
          token: sesionToken.token,
          usuario: {
            id: usuario.id,
            correo: usuario.correo,
            nombre: usuario.nombre,
            apellido: usuario.apellido,
          },
          organizacion: {
            id: organizacion.id,
            nombre: organizacion.nombre,
            slug: organizacion.slug,
          },
        };
      });

      res.status(201).json(resultado);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ErrorHttp(409, "Conflicto con un registro existente");
      }
      throw error;
    }
  } catch (err) {
    next(err);
  }
});

rutasAutenticacion.post("/inicio-sesion", async (req, res, next) => {
  try {
    const datos = inicioSesionEsquema.parse(req.body);
    const correoNormalizado = datos.correo.trim().toLowerCase();

    const usuario = await prisma.usuario.findUnique({
      where: { correo: correoNormalizado },
      include: {
        membresias: {
          include: {
            organizacion: {
              select: { id: true, nombre: true, slug: true },
            },
          },
        },
        accesosCliente: {
          where: { activo: true },
          include: {
            cliente: {
              select: { id: true, nombre: true, empresa: true },
            },
            organizacion: {
              select: { id: true, nombre: true, slug: true },
            },
          },
        },
      },
    });

    if (!usuario) {
      // Trabajo criptográfico comparable para evitar enumeración de cuentas
      await bcrypt.compare(datos.contrasena, HASH_FICTICIO_BCRYPT);
      throw new ErrorHttp(401, "Correo o contraseña incorrectos");
    }

    const contrasenaValida = await bcrypt.compare(datos.contrasena, usuario.contrasenaHash);
    if (!contrasenaValida) {
      throw new ErrorHttp(401, "Correo o contraseña incorrectos");
    }

    // Construir contextos disponibles seguros
    const contextosOrganizacion = usuario.membresias.map((m) => ({
      tipoAcceso: "ORGANIZACION" as const,
      organizacionId: m.organizacionId,
      rolOrganizacion: m.rol,
      organizacion: m.organizacion,
    }));

    const contextosCliente = usuario.accesosCliente.map((a) => ({
      tipoAcceso: "CLIENTE" as const,
      organizacionId: a.organizacionId,
      clienteId: a.clienteId,
      rolCliente: a.rol,
      cliente: a.cliente,
      organizacion: a.organizacion,
    }));

    const totalContextos = contextosOrganizacion.length + contextosCliente.length;

    if (totalContextos === 0) {
      throw new ErrorHttp(403, "La cuenta no tiene accesos disponibles");
    }

    // Determinación del contexto a utilizar
    let contextoElegido:
      | { tipoAcceso: "ORGANIZACION"; organizacionId: string; rolOrganizacion: "PROPIETARIO" | "COLABORADOR" }
      | { tipoAcceso: "CLIENTE"; organizacionId: string; clienteId: string; rolCliente: "TITULAR" | "COLABORADOR" };

    if (datos.seleccion) {
      const seleccion = datos.seleccion;
      if (seleccion.tipoAcceso === "ORGANIZACION") {
        const match = contextosOrganizacion.find(
          (c) => c.organizacionId === seleccion.organizacionId
        );
        if (!match) {
          throw new ErrorHttp(403, "No tienes acceso a la organización seleccionada");
        }
        contextoElegido = {
          tipoAcceso: "ORGANIZACION",
          organizacionId: match.organizacionId,
          rolOrganizacion: match.rolOrganizacion,
        };
      } else {
        const match = contextosCliente.find(
          (c) =>
            c.organizacionId === seleccion.organizacionId &&
            c.clienteId === seleccion.clienteId
        );
        if (!match) {
          throw new ErrorHttp(403, "No tienes acceso al cliente u organización seleccionados");
        }
        contextoElegido = {
          tipoAcceso: "CLIENTE",
          organizacionId: match.organizacionId,
          clienteId: match.clienteId,
          rolCliente: match.rolCliente,
        };
      }
    } else if (totalContextos === 1) {
      if (contextosOrganizacion.length === 1) {
        contextoElegido = {
          tipoAcceso: "ORGANIZACION",
          organizacionId: contextosOrganizacion[0].organizacionId,
          rolOrganizacion: contextosOrganizacion[0].rolOrganizacion,
        };
      } else {
        contextoElegido = {
          tipoAcceso: "CLIENTE",
          organizacionId: contextosCliente[0].organizacionId,
          clienteId: contextosCliente[0].clienteId,
          rolCliente: contextosCliente[0].rolCliente,
        };
      }
    } else {
      // Si existen varios contextos y no se especificó selección, responder 409 con la lista de opciones
      // Sin crear sesión en la base de datos
      return res.status(409).json({
        error: "Se requiere seleccionar un contexto de acceso",
        contextos: {
          organizaciones: contextosOrganizacion.map((c) => ({
            tipoAcceso: c.tipoAcceso,
            organizacionId: c.organizacionId,
            rol: c.rolOrganizacion,
            organizacion: c.organizacion,
          })),
          clientes: contextosCliente.map((c) => ({
            tipoAcceso: c.tipoAcceso,
            organizacionId: c.organizacionId,
            clienteId: c.clienteId,
            rol: c.rolCliente,
            cliente: c.cliente,
            organizacion: c.organizacion,
          })),
        },
      });
    }

    // Crear la sesión en BD de manera revocable
    const sesionId = randomUUID();
    const { token, expiraEn } = firmarToken(
      contextoElegido.tipoAcceso === "ORGANIZACION"
        ? {
            tipoAcceso: "ORGANIZACION",
            usuarioId: usuario.id,
            organizacionId: contextoElegido.organizacionId,
            rolOrganizacion: contextoElegido.rolOrganizacion,
          }
        : {
            tipoAcceso: "CLIENTE",
            usuarioId: usuario.id,
            organizacionId: contextoElegido.organizacionId,
            clienteId: contextoElegido.clienteId,
            rolCliente: contextoElegido.rolCliente,
          },
      sesionId
    );

    const tokenCalculadoHash = hashToken(token);

    await prisma.$transaction(async (tx) => {
      await tx.sesion.create({
        data: {
          id: sesionId,
          usuarioId: usuario.id,
          tokenHash: tokenCalculadoHash,
          expiraEn,
        },
      });

      await tx.usuario.update({
        where: { id: usuario.id },
        data: { ultimoAccesoEn: new Date() },
      });
    });

    res.json({
      token,
      contexto: contextoElegido,
      usuario: {
        id: usuario.id,
        correo: usuario.correo,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
      },
    });
  } catch (err) {
    next(err);
  }
});

rutasAutenticacion.post("/cerrar-sesion", exigirAutenticacion, async (req: SolicitudAutenticada, res, next) => {
  try {
    const sesionId = req.sesion!.sesionId;

    await prisma.sesion.updateMany({
      where: {
        id: sesionId,
        usuarioId: req.sesion!.usuarioId,
        revocadaEn: null,
      },
      data: {
        revocadaEn: new Date(),
      },
    });

    res.json({ mensaje: "Sesión cerrada exitosamente" });
  } catch (err) {
    next(err);
  }
});

rutasAutenticacion.get("/yo", exigirAutenticacion, async (req: SolicitudAutenticada, res, next) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.sesion!.usuarioId },
      select: {
        id: true,
        correo: true,
        nombre: true,
        apellido: true,
        telefono: true,
        avatarUrl: true,
        zonaHoraria: true,
      },
    });

    res.json({
      usuario,
      sesion: req.sesion,
    });
  } catch (err) {
    next(err);
  }
});
