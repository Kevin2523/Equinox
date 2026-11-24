import { createHash, randomUUID } from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import {
  exigirAutenticacion,
  firmarToken,
  firmarTokenDesafioMfa,
  hashToken,
  verificarTokenDesafioMfa,
} from "../middleware/autenticacion.js";
import { LimitadorMemoria } from "../middleware/rate-limit.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { hooksPruebas } from "../utilidades/hooks-pruebas.js";
import { estaConfiguradoTransporte, enviarCorreoRecuperacion } from "../servicios/correo.js";
import { extraerContextoRequestAuditoria, registrarAuditoriaAdmin } from "../servicios/auditoria.js";
import {
  generarTokenRecuperacion,
  hashTokenRecuperacion,
  calcularFechaExpiracionRecuperacion,
  construirEnlaceRecuperacion,
} from "../utilidades/recuperacion.js";
import {
  cifrarSecretoMfa,
  construirEnlaceRecuperacionMfa,
  construirOtpauthUrl,
  descifrarSecretoMfa,
  generarCodigosRecuperacionMfa,
  generarSecretoBase32,
  generarTokenRecuperacionMfa,
  hashCodigoRecuperacionMfa,
  hashTokenRecuperacionMfa,
  verificarCodigoTotp,
} from "../utilidades/mfa.js";

export const rutasAutenticacion = Router();

// Rate limiters para inicio de sesión y registro
export const limitadorLoginIp = new LimitadorMemoria(
  15 * 60 * 1000,
  20,
  "Demasiados intentos de inicio de sesión desde esta dirección IP. Por favor intente más tarde.",
  5000,
  "login-ip"
);

export const limitadorLoginCuenta = new LimitadorMemoria(
  15 * 60 * 1000,
  5,
  "Demasiados intentos fallidos para esta cuenta. Por favor intente más tarde.",
  5000,
  "login-cuenta"
);

export const limitadorRegistroIp = new LimitadorMemoria(
  15 * 60 * 1000,
  5,
  "Demasiadas solicitudes de registro desde esta dirección IP. Por favor intente más tarde.",
  5000,
  "registro-ip"
);

export const limitadorMfaIp = new LimitadorMemoria(
  15 * 60 * 1000,
  10,
  "Demasiados intentos de verificación MFA desde esta dirección IP. Por favor intente más tarde.",
  5000,
  "mfa-ip"
);

export const limitadorMfaUsuario = new LimitadorMemoria(
  15 * 60 * 1000,
  5,
  "Demasiados intentos fallidos de MFA. Por favor intente más tarde.",
  5000,
  "mfa-usuario"
);

// Rate limiters para el flujo de recuperación de contraseña
export const limitadorRecuperacionIp = new LimitadorMemoria(
  15 * 60 * 1000,
  10,
  "Demasiadas solicitudes de recuperación desde esta dirección IP. Por favor intente más tarde.",
  5000,
  "recuperacion-ip"
);

export const limitadorRecuperacionCuenta = new LimitadorMemoria(
  15 * 60 * 1000,
  3,
  "Demasiadas solicitudes de recuperación para esta cuenta. Por favor intente más tarde.",
  5000,
  "recuperacion-cuenta"
);

export const limitadorValidarTokenIp = new LimitadorMemoria(
  15 * 60 * 1000,
  30,
  "Demasiadas consultas de validación para enlaces de recuperación.",
  5000,
  "recuperacion-validar-ip"
);

export const limitadorRestablecerIp = new LimitadorMemoria(
  15 * 60 * 1000,
  5,
  "Demasiados intentos de restablecimiento de contraseña.",
  5000,
  "recuperacion-restablecer-ip"
);

export function generarClaveIpRecuperacion(req: { ip?: string }): string {
  return `recuperacion:ip:${req.ip || "127.0.0.1"}`;
}

export function generarClaveCuentaRecuperacion(req: { body?: any }): string {
  const correo = typeof req.body?.correo === "string" ? req.body.correo.trim().toLowerCase() : "";
  const hash = correo ? createHash("sha256").update(correo).digest("hex") : "nocorreo";
  return `recuperacion:cuenta:${hash}`;
}

export function generarClaveIpTokenRecuperacion(req: { ip?: string; body?: any; query?: any; params?: any }): string {
  const ip = req.ip || "127.0.0.1";
  const token = typeof req.body?.token === "string"
    ? req.body.token.trim()
    : typeof req.query?.token === "string"
    ? req.query.token.trim()
    : typeof req.params?.token === "string"
    ? req.params.token.trim()
    : "";
  const tokenHash = token ? hashTokenRecuperacion(token) : "notoken";
  return `recuperacion:iptoken:${ip}:${tokenHash}`;
}

const esquemaSolicitarRecuperacion = z.object({
  correo: z.string().email().max(254),
});

const esquemaRestablecerContrasena = z.object({
  token: z.string().min(10).max(512),
  contrasena: z.string().min(8).max(128),
});

// Hash bcrypt ficticio válido para mitigar ataques de timing / enumeración de cuentas
const HASH_FICTICIO_BCRYPT = "$2a$12$e80yq9e/tGf0zE1k7oW79.vN80n7P83XQh3q3w3o5sE1p2r3t4u5v";

const cuentaRegistro = z.object({
  correo: z.string().email().max(254),
  contrasena: z.string().min(8).max(128),
  nombre: z.string().min(2).max(120),
  apellido: z.string().max(120).optional(),
  nombreEstudio: z.string().min(2).max(160),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  tipoFreelance: z
    .enum(["GENERAL", "DESARROLLO_SOFTWARE", "FOTOGRAFIA", "DISENO_GRAFICO"])
    .optional()
    .default("GENERAL"),
  idioma: z.enum(["es", "en", "pt"]).optional(),
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
  z.object({
    tipoAcceso: z.literal("ADMIN_GLOBAL"),
  }),
]);

const inicioSesionEsquema = z.object({
  correo: z.string().email().max(254),
  contrasena: z.string().min(1).max(128),
  seleccion: seleccionContexto.optional(),
});

export function generarClaveIpAuth(prefijo: string) {
  return (req: { ip?: string }) => `${prefijo}:ip:${req.ip || "127.0.0.1"}`;
}

export function generarClaveCuentaLogin(correoNormalizado: string): string {
  const hash = createHash("sha256").update(correoNormalizado).digest("hex");
  return `login:cuenta:${hash}`;
}

rutasAutenticacion.post(
  "/registro",
  limitadorRegistroIp.limitar(generarClaveIpAuth("registro")),
  async (req, res, next) => {
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
            ...(datos.idioma ? { idioma: datos.idioma } : {}),
          },
        });

        const organizacion = await tx.organizacion.create({
          data: {
            nombre: datos.nombreEstudio,
            slug: datos.slug,
            tipoFreelance: datos.tipoFreelance,
          } as any,
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
            idioma: usuario.idioma,
          },
          organizacion: {
            id: organizacion.id,
            nombre: organizacion.nombre,
            slug: organizacion.slug,
            tipoFreelance: (organizacion as any).tipoFreelance ?? "GENERAL",
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

rutasAutenticacion.post(
  "/inicio-sesion",
  limitadorLoginIp.limitar(generarClaveIpAuth("login")),
  async (req, res, next) => {
    try {
      const datos = inicioSesionEsquema.parse(req.body);
      const correoNormalizado = datos.correo.trim().toLowerCase();
      const claveCuenta = generarClaveCuentaLogin(correoNormalizado);

      const estadoBloqueo = await limitadorLoginCuenta.verificarBloqueado(claveCuenta);
      if (estadoBloqueo.bloqueado) {
        if (estadoBloqueo.retryAfterSeg) {
          res.setHeader("Retry-After", String(estadoBloqueo.retryAfterSeg));
        }
        throw new ErrorHttp(429, "Demasiados intentos fallidos para esta cuenta. Por favor intente más tarde.");
      }

      const usuario = await prisma.usuario.findUnique({
        where: { correo: correoNormalizado },
        include: {
          membresias: {
            include: {
              organizacion: {
                select: { id: true, nombre: true, slug: true, suspendidaEn: true },
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
                select: { id: true, nombre: true, slug: true, suspendidaEn: true },
              },
            },
          },
        },
      });

      if (!usuario) {
        // Trabajo criptográfico comparable para evitar enumeración de cuentas
        await bcrypt.compare(datos.contrasena, HASH_FICTICIO_BCRYPT);
        await limitadorLoginCuenta.registrarIntento(claveCuenta);
        throw new ErrorHttp(401, "Correo o contraseña incorrectos");
      }

      const contrasenaValida = await bcrypt.compare(datos.contrasena, usuario.contrasenaHash);
      if (!contrasenaValida) {
        await limitadorLoginCuenta.registrarIntento(claveCuenta);
        throw new ErrorHttp(401, "Correo o contraseña incorrectos");
      }

      // Login con credenciales válidas: limpiar contador de fallos de la cuenta
      await limitadorLoginCuenta.reiniciarClave(claveCuenta);

      // Construir contextos disponibles seguros
      const esAdminGlobal = usuario.rolPlataforma === "ADMIN_GLOBAL";

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

      const totalContextos =
        contextosOrganizacion.length + contextosCliente.length + (esAdminGlobal ? 1 : 0);

      if (totalContextos === 0) {
        throw new ErrorHttp(403, "La cuenta no tiene accesos disponibles");
      }

      // Determinación del contexto a utilizar
      let contextoElegido:
        | { tipoAcceso: "ORGANIZACION"; organizacionId: string; rolOrganizacion: "PROPIETARIO" | "COLABORADOR" }
        | { tipoAcceso: "CLIENTE"; organizacionId: string; clienteId: string; rolCliente: "TITULAR" | "COLABORADOR" }
        | { tipoAcceso: "ADMIN_GLOBAL"; rolPlataforma: "ADMIN_GLOBAL" };

      if (datos.seleccion) {
        const seleccion = datos.seleccion;
        if (seleccion.tipoAcceso === "ADMIN_GLOBAL") {
          if (!esAdminGlobal) {
            throw new ErrorHttp(403, "No tienes acceso de superadministración global");
          }
          contextoElegido = {
            tipoAcceso: "ADMIN_GLOBAL",
            rolPlataforma: "ADMIN_GLOBAL",
          };
        } else if (seleccion.tipoAcceso === "ORGANIZACION") {
          const match = contextosOrganizacion.find(
            (c) => c.organizacionId === seleccion.organizacionId
          );
          if (!match) {
            throw new ErrorHttp(403, "No tienes acceso a la organización seleccionada");
          }
          if (match.organizacion.suspendidaEn !== null) {
            throw new ErrorHttp(403, "Esta organización se encuentra suspendida");
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
          if (match.organizacion.suspendidaEn !== null) {
            throw new ErrorHttp(403, "Esta organización se encuentra suspendida");
          }
          contextoElegido = {
            tipoAcceso: "CLIENTE",
            organizacionId: match.organizacionId,
            clienteId: match.clienteId,
            rolCliente: match.rolCliente,
          };
        }
      } else if (totalContextos === 1) {
        if (esAdminGlobal) {
          contextoElegido = {
            tipoAcceso: "ADMIN_GLOBAL",
            rolPlataforma: "ADMIN_GLOBAL",
          };
        } else if (contextosOrganizacion.length === 1) {
          if (contextosOrganizacion[0].organizacion.suspendidaEn !== null) {
            throw new ErrorHttp(403, "Esta organización se encuentra suspendida");
          }
          contextoElegido = {
            tipoAcceso: "ORGANIZACION",
            organizacionId: contextosOrganizacion[0].organizacionId,
            rolOrganizacion: contextosOrganizacion[0].rolOrganizacion,
          };
        } else {
          if (contextosCliente[0].organizacion.suspendidaEn !== null) {
            throw new ErrorHttp(403, "Esta organización se encuentra suspendida");
          }
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
            adminGlobal: esAdminGlobal,
            organizaciones: contextosOrganizacion.map((c) => ({
              tipoAcceso: c.tipoAcceso,
              organizacionId: c.organizacionId,
              rol: c.rolOrganizacion,
              suspendida: c.organizacion.suspendidaEn !== null,
              organizacion: c.organizacion,
            })),
            clientes: contextosCliente.map((c) => ({
              tipoAcceso: c.tipoAcceso,
              organizacionId: c.organizacionId,
              clienteId: c.clienteId,
              rol: c.rolCliente,
              suspendida: c.organizacion.suspendidaEn !== null,
              cliente: c.cliente,
              organizacion: c.organizacion,
            })),
          },
        });
      }

      // Contexto ADMIN_GLOBAL: NUNCA emite sesión sin completar MFA TOTP obligatorio
      if (contextoElegido.tipoAcceso === "ADMIN_GLOBAL") {
        const estadoMfa = usuario.mfaHabilitado ? "VERIFICAR" : "CONFIGURAR";
        const tokenDesafioMfa = firmarTokenDesafioMfa(usuario.id, estadoMfa);
        const ctxReq = extraerContextoRequestAuditoria(req);
        await registrarAuditoriaAdmin({
          actorUsuarioId: usuario.id,
          actorCorreo: usuario.correo,
          accion: "ADMIN_DESAFIO_MFA_EMITIDO",
          entidad: "Usuario",
          entidadId: usuario.id,
          ip: ctxReq.ip,
          userAgent: ctxReq.userAgent,
          metadatos: { estadoMfa },
        });

        return res.json({
          mfaRequerido: true,
          estadoMfa,
          tokenDesafioMfa,
          contexto: contextoElegido,
          usuario: {
            id: usuario.id,
            correo: usuario.correo,
            nombre: usuario.nombre,
            apellido: usuario.apellido,
            rolPlataforma: usuario.rolPlataforma,
            mfaHabilitado: usuario.mfaHabilitado,
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
      const ctxReq = extraerContextoRequestAuditoria(req);

      await prisma.$transaction(async (tx) => {
        await tx.sesion.create({
          data: {
            id: sesionId,
            usuarioId: usuario.id,
            tokenHash: tokenCalculadoHash,
            tipoAcceso: contextoElegido.tipoAcceso,
            mfaVerificado: false,
            ipOrigen: ctxReq.ip,
            userAgent: ctxReq.userAgent,
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
          idioma: usuario.idioma,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

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

    if (req.sesionAdmin) {
      const ctxReq = extraerContextoRequestAuditoria(req);
      await registrarAuditoriaAdmin({
        actorUsuarioId: req.sesionAdmin.usuarioId,
        accion: "ADMIN_CIERRE_SESION",
        entidad: "Sesion",
        entidadId: sesionId,
        ip: ctxReq.ip,
        userAgent: ctxReq.userAgent,
      });
    }

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
        idioma: true,
        rolPlataforma: true,
        mfaHabilitado: true,
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

// -----------------------------------------------------------------------------
// Flujo de Recuperación de Contraseña
// -----------------------------------------------------------------------------

async function manejarSolicitudRecuperacion(req: any, res: any, next: any) {
  try {
    const datos = esquemaSolicitarRecuperacion.parse(req.body);
    const correoNormalizado = datos.correo.trim().toLowerCase();

    // 1. Verificación del canal de transporte (SMTP / proveedor configurable)
    // No afirmamos envío exitoso si el transporte no está configurado o falla
    if (!estaConfiguradoTransporte()) {
      console.warn(
        `[RECUPERACION] Solicitud rechazada: servicio de correo no configurado (SMTP_HOST ausente).`
      );
      throw new ErrorHttp(
        503,
        "El servicio de recuperación por correo no está configurado o no se encuentra disponible."
      );
    }

    const usuario = await prisma.usuario.findUnique({
      where: { correo: correoNormalizado },
    });

    if (!usuario) {
      // Mismo perfil de latencia sin bcrypt asimétrico para evitar enumeración por timing
      console.info("[RECUPERACION] Solicitud uniforme procesada para cuenta no registrada.");
      return res.json({
        mensaje:
          "Si el correo está registrado en Equinox, recibirás las instrucciones para restablecer tu contraseña en los próximos minutos.",
      });
    }

    // Generar token aleatorio criptográficamente seguro (URL-safe)
    const tokenPlano = generarTokenRecuperacion();
    const tokenHash = hashTokenRecuperacion(tokenPlano);
    const expiraEn = calcularFechaExpiracionRecuperacion();
    const ahora = hooksPruebas.obtenerAhora();

    // Invalidar cualquier solicitud previa activa de este usuario
    await prisma.solicitudRecuperacion.updateMany({
      where: {
        usuarioId: usuario.id,
        usadoEn: null,
      },
      data: {
        usadoEn: ahora,
      },
    });

    // Persistir únicamente el hash del token
    await prisma.solicitudRecuperacion.create({
      data: {
        usuarioId: usuario.id,
        tokenHash,
        expiraEn,
      },
    });

    const enlace = construirEnlaceRecuperacion(tokenPlano);

    try {
      await enviarCorreoRecuperacion({
        destinatario: usuario.correo,
        nombre: usuario.nombre || "Usuario",
        enlace,
        minutosExpiracion: 30,
      });
      console.info(`[RECUPERACION] Enlace de restablecimiento generado y enviado al usuario.`);
    } catch (error: any) {
      console.error("[RECUPERACION] Error al enviar correo SMTP:", error.message);
      // En caso de fallo en el envío, invalidamos el token generado para que no quede huérfano,
      // manteniendo respuesta uniforme 200 para no filtrar existencia de cuenta.
      await prisma.solicitudRecuperacion.updateMany({
        where: { tokenHash },
        data: { usadoEn: ahora },
      });
    }

    return res.json({
      mensaje:
        "Si el correo está registrado en Equinox, recibirás las instrucciones para restablecer tu contraseña en los próximos minutos.",
    });
  } catch (err) {
    next(err);
  }
}

// Solicitud de recuperación de contraseña con rate limiting por IP y cuenta
rutasAutenticacion.post(
  "/solicitar-recuperacion",
  limitadorRecuperacionIp.limitar(generarClaveIpRecuperacion),
  limitadorRecuperacionCuenta.limitar(generarClaveCuentaRecuperacion),
  manejarSolicitudRecuperacion
);

rutasAutenticacion.post(
  "/recuperar-contrasena",
  limitadorRecuperacionIp.limitar(generarClaveIpRecuperacion),
  limitadorRecuperacionCuenta.limitar(generarClaveCuentaRecuperacion),
  manejarSolicitudRecuperacion
);

// Validación de enlace de recuperación (para interfaz de usuario)
async function manejarValidacionToken(req: any, res: any, next: any) {
  try {
    const tokenPlano = typeof req.query.token === "string"
      ? req.query.token
      : typeof req.params.token === "string"
      ? req.params.token
      : "";

    if (!tokenPlano || tokenPlano.trim().length < 10) {
      throw new ErrorHttp(404, "Enlace de recuperación inválido o no encontrado.");
    }

    const tokenHash = hashTokenRecuperacion(tokenPlano.trim());
    const solicitud = await prisma.solicitudRecuperacion.findUnique({
      where: { tokenHash },
    });

    if (!solicitud) {
      throw new ErrorHttp(404, "Enlace de recuperación inválido o no encontrado.");
    }

    const ahora = hooksPruebas.obtenerAhora();

    if (solicitud.usadoEn !== null) {
      throw new ErrorHttp(410, "Este enlace de recuperación ya ha sido utilizado.");
    }

    if (solicitud.expiraEn <= ahora) {
      throw new ErrorHttp(410, "El enlace de recuperación ha expirado. Por favor solicita uno nuevo.");
    }

    // Respuesta segura: no filtrar correo, usuarioId ni metadatos internos
    res.json({ valido: true });
  } catch (err) {
    next(err);
  }
}

rutasAutenticacion.get(
  "/validar-token-recuperacion",
  limitadorValidarTokenIp.limitar(generarClaveIpRecuperacion),
  manejarValidacionToken
);

rutasAutenticacion.get(
  "/validar-token-recuperacion/:token",
  limitadorValidarTokenIp.limitar(generarClaveIpRecuperacion),
  manejarValidacionToken
);

// Restablecer contraseña consumiendo el token
rutasAutenticacion.post(
  "/restablecer-contrasena",
  limitadorRestablecerIp.limitar(generarClaveIpRecuperacion),
  async (req, res, next) => {
    try {
      const datos = esquemaRestablecerContrasena.parse(req.body);
      const tokenHash = hashTokenRecuperacion(datos.token.trim());

      const solicitud = await prisma.solicitudRecuperacion.findUnique({
        where: { tokenHash },
      });

      if (!solicitud) {
        throw new ErrorHttp(404, "Enlace de recuperación inválido o no encontrado.");
      }

      const ahora = hooksPruebas.obtenerAhora();

      if (solicitud.usadoEn !== null) {
        throw new ErrorHttp(410, "Este enlace de recuperación ya ha sido utilizado.");
      }

      if (solicitud.expiraEn <= ahora) {
        throw new ErrorHttp(410, "El enlace de recuperación ha expirado. Por favor solicita uno nuevo.");
      }

      const contrasenaHash = await bcrypt.hash(datos.contrasena, 12);

      // Transacción atómica:
      // 1. Marcar token como consumido
      // 2. Invalidar cualquier otro token de recuperación pendiente para este usuario
      // 3. Actualizar la contraseña del usuario
      // 4. Invalidar todas las sesiones previas activas de esa identidad
      await prisma.$transaction(async (tx) => {
        await tx.solicitudRecuperacion.update({
          where: { id: solicitud.id },
          data: { usadoEn: ahora },
        });

        await tx.solicitudRecuperacion.updateMany({
          where: {
            usuarioId: solicitud.usuarioId,
            usadoEn: null,
          },
          data: { usadoEn: ahora },
        });

        await tx.usuario.update({
          where: { id: solicitud.usuarioId },
          data: { contrasenaHash },
        });

        await tx.sesion.updateMany({
          where: {
            usuarioId: solicitud.usuarioId,
            revocadaEn: null,
          },
          data: { revocadaEn: ahora },
        });
      });

      console.info(`[RECUPERACION] Contraseña actualizada y sesiones previas invalidadas para usuario.`);

      // Retornar mensaje sin iniciar sesión automáticamente
      res.json({
        mensaje: "Contraseña actualizada exitosamente. Por favor inicia sesión con tu nueva contraseña.",
      });
    } catch (err) {
      next(err);
    }
  }
);

// -----------------------------------------------------------------------------
// Flujo de MFA TOTP y Recuperación MFA para ADMIN_GLOBAL
// -----------------------------------------------------------------------------

const esquemaDesafioMfa = z.object({
  tokenDesafioMfa: z.string().min(10).max(2048),
});

const esquemaConfirmarMfa = z.object({
  tokenDesafioMfa: z.string().min(10).max(2048),
  codigoTotp: z.string().regex(/^\d{6}$/, "El código TOTP debe tener 6 dígitos"),
});

const esquemaVerificarMfa = z
  .object({
    tokenDesafioMfa: z.string().min(10).max(2048),
    codigoTotp: z.string().regex(/^\d{6}$/).optional(),
    codigoRecuperacion: z.string().min(6).max(32).optional(),
  })
  .refine((d) => Boolean(d.codigoTotp || d.codigoRecuperacion), {
    message: "Debes proporcionar un código TOTP o un código de recuperación MFA",
  });

const esquemaRestablecerMfa = z.object({
  token: z.string().min(10).max(512),
  contrasena: z.string().min(1).max(128),
});

function extraerTokenDesafio(req: { body?: any; header: (name: string) => string | undefined }): string {
  if (typeof req.body?.tokenDesafioMfa === "string" && req.body.tokenDesafioMfa.trim()) {
    return req.body.tokenDesafioMfa.trim();
  }
  const auth = req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  throw new ErrorHttp(401, "Se requiere token de desafío MFA");
}

rutasAutenticacion.post(
  "/admin/mfa/iniciar-configuracion",
  limitadorMfaIp.limitar(generarClaveIpAuth("mfa-setup")),
  async (req, res, next) => {
    try {
      const tokenDesafio = extraerTokenDesafio(req);
      esquemaDesafioMfa.parse({ tokenDesafioMfa: tokenDesafio });
      const desafio = verificarTokenDesafioMfa(tokenDesafio);
      if (desafio.proposito !== "CONFIGURAR") {
        throw new ErrorHttp(403, "El desafío MFA no corresponde a configuración inicial");
      }

      const usuario = await prisma.usuario.findUnique({
        where: { id: desafio.usuarioId },
        select: { id: true, correo: true, rolPlataforma: true, mfaHabilitado: true },
      });

      if (!usuario || usuario.rolPlataforma !== "ADMIN_GLOBAL") {
        throw new ErrorHttp(403, "Acceso restringido a superadministradores globales");
      }

      if (usuario.mfaHabilitado) {
        throw new ErrorHttp(409, "El MFA ya está habilitado para esta cuenta");
      }

      const secretoBase32 = generarSecretoBase32();
      const secretoCifrado = cifrarSecretoMfa(secretoBase32);

      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { mfaPendienteSecretoCifrado: secretoCifrado },
      });

      const ctxReq = extraerContextoRequestAuditoria(req);
      await registrarAuditoriaAdmin({
        actorUsuarioId: usuario.id,
        actorCorreo: usuario.correo,
        accion: "ADMIN_MFA_CONFIGURACION_INICIADA",
        entidad: "Usuario",
        entidadId: usuario.id,
        ip: ctxReq.ip,
        userAgent: ctxReq.userAgent,
      });

      res.json({
        secretoBase32,
        otpauthUrl: construirOtpauthUrl(usuario.correo, secretoBase32, "Equinox"),
        emisor: "Equinox",
        cuenta: usuario.correo,
      });
    } catch (err) {
      next(err);
    }
  }
);

rutasAutenticacion.post(
  "/admin/mfa/confirmar-configuracion",
  limitadorMfaIp.limitar(generarClaveIpAuth("mfa-confirm")),
  async (req, res, next) => {
    try {
      const datos = esquemaConfirmarMfa.parse(req.body);
      const desafio = verificarTokenDesafioMfa(datos.tokenDesafioMfa);
      if (desafio.proposito !== "CONFIGURAR") {
        throw new ErrorHttp(403, "El desafío MFA no corresponde a configuración inicial");
      }

      const claveUsuario = `mfa:usuario:${desafio.usuarioId}`;
      const bloqueo = await limitadorMfaUsuario.verificarBloqueado(claveUsuario);
      if (bloqueo.bloqueado) {
        if (bloqueo.retryAfterSeg) res.setHeader("Retry-After", String(bloqueo.retryAfterSeg));
        throw new ErrorHttp(429, "Demasiados intentos fallidos de MFA. Por favor intente más tarde.");
      }

      const usuario = await prisma.usuario.findUnique({
        where: { id: desafio.usuarioId },
        select: {
          id: true,
          correo: true,
          nombre: true,
          apellido: true,
          rolPlataforma: true,
          mfaHabilitado: true,
          mfaPendienteSecretoCifrado: true,
        },
      });

      if (!usuario || usuario.rolPlataforma !== "ADMIN_GLOBAL") {
        throw new ErrorHttp(403, "Acceso restringido a superadministradores globales");
      }

      if (usuario.mfaHabilitado || !usuario.mfaPendienteSecretoCifrado) {
        throw new ErrorHttp(409, "No hay una configuración MFA pendiente para confirmar");
      }

      const secretoBase32 = descifrarSecretoMfa(usuario.mfaPendienteSecretoCifrado);
      const ahora = hooksPruebas.obtenerAhora();
      const verificacion = verificarCodigoTotp(secretoBase32, datos.codigoTotp, { fecha: ahora });

      if (!verificacion.valido || verificacion.pasoUsado === undefined) {
        await limitadorMfaUsuario.registrarIntento(claveUsuario);
        throw new ErrorHttp(401, "Código TOTP inválido o expirado");
      }

      await limitadorMfaUsuario.reiniciarClave(claveUsuario);

      const codigosRecuperacion = generarCodigosRecuperacionMfa(8);
      const sesionId = randomUUID();
      const { token, expiraEn } = firmarToken(
        {
          tipoAcceso: "ADMIN_GLOBAL",
          usuarioId: usuario.id,
          rolPlataforma: "ADMIN_GLOBAL",
          mfaVerificado: true,
        },
        sesionId
      );
      const tokenHash = hashToken(token);
      const ctxReq = extraerContextoRequestAuditoria(req);

      await prisma.$transaction(async (tx) => {
        await tx.usuario.update({
          where: { id: usuario.id },
          data: {
            mfaHabilitado: true,
            mfaSecretoCifrado: usuario.mfaPendienteSecretoCifrado,
            mfaPendienteSecretoCifrado: null,
            mfaVerificadoEn: ahora,
            mfaUltimoPasoUsado: BigInt(verificacion.pasoUsado!),
            ultimoAccesoEn: ahora,
          },
        });

        await tx.codigoRecuperacionMfa.deleteMany({
          where: { usuarioId: usuario.id },
        });

        await tx.codigoRecuperacionMfa.createMany({
          data: codigosRecuperacion.map((c) => ({
            usuarioId: usuario.id,
            codigoHash: hashCodigoRecuperacionMfa(c),
          })),
        });

        await tx.sesion.create({
          data: {
            id: sesionId,
            usuarioId: usuario.id,
            tokenHash,
            tipoAcceso: "ADMIN_GLOBAL",
            mfaVerificado: true,
            mfaVerificadoEn: ahora,
            ipOrigen: ctxReq.ip,
            userAgent: ctxReq.userAgent,
            expiraEn,
          },
        });

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: usuario.id,
            actorCorreo: usuario.correo,
            accion: "ADMIN_MFA_CONFIGURADO",
            entidad: "Usuario",
            entidadId: usuario.id,
            ip: ctxReq.ip,
            userAgent: ctxReq.userAgent,
          },
          tx
        );
      });

      res.json({
        token,
        contexto: {
          tipoAcceso: "ADMIN_GLOBAL",
          rolPlataforma: "ADMIN_GLOBAL",
          mfaVerificado: true,
        },
        usuario: {
          id: usuario.id,
          correo: usuario.correo,
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          rolPlataforma: "ADMIN_GLOBAL",
          mfaHabilitado: true,
        },
        codigosRecuperacion,
      });
    } catch (err) {
      next(err);
    }
  }
);

rutasAutenticacion.post(
  "/admin/mfa/verificar",
  limitadorMfaIp.limitar(generarClaveIpAuth("mfa-verify")),
  async (req, res, next) => {
    try {
      const datos = esquemaVerificarMfa.parse(req.body);
      const desafio = verificarTokenDesafioMfa(datos.tokenDesafioMfa);
      if (desafio.proposito !== "VERIFICAR") {
        throw new ErrorHttp(403, "El desafío MFA no corresponde a verificación");
      }

      const claveUsuario = `mfa:usuario:${desafio.usuarioId}`;
      const bloqueo = await limitadorMfaUsuario.verificarBloqueado(claveUsuario);
      if (bloqueo.bloqueado) {
        if (bloqueo.retryAfterSeg) res.setHeader("Retry-After", String(bloqueo.retryAfterSeg));
        throw new ErrorHttp(429, "Demasiados intentos fallidos de MFA. Por favor intente más tarde.");
      }

      const usuario = await prisma.usuario.findUnique({
        where: { id: desafio.usuarioId },
        select: {
          id: true,
          correo: true,
          nombre: true,
          apellido: true,
          rolPlataforma: true,
          mfaHabilitado: true,
          mfaSecretoCifrado: true,
          mfaUltimoPasoUsado: true,
        },
      });

      if (!usuario || usuario.rolPlataforma !== "ADMIN_GLOBAL") {
        throw new ErrorHttp(403, "Acceso restringido a superadministradores globales");
      }

      if (!usuario.mfaHabilitado || !usuario.mfaSecretoCifrado) {
        throw new ErrorHttp(403, "El usuario requiere configurar MFA primero");
      }

      const ahora = hooksPruebas.obtenerAhora();
      const ctxReq = extraerContextoRequestAuditoria(req);
      let pasoUsado: number | undefined;
      let codigoRecUsadoId: string | undefined;

      if (datos.codigoTotp) {
        const secretoBase32 = descifrarSecretoMfa(usuario.mfaSecretoCifrado);
        const verificacion = verificarCodigoTotp(secretoBase32, datos.codigoTotp, {
          fecha: ahora,
          ultimoPasoUsado: usuario.mfaUltimoPasoUsado,
        });
        if (!verificacion.valido || verificacion.pasoUsado === undefined) {
          await limitadorMfaUsuario.registrarIntento(claveUsuario);
          await registrarAuditoriaAdmin({
            actorUsuarioId: usuario.id,
            actorCorreo: usuario.correo,
            accion: "ADMIN_MFA_FALLIDO",
            entidad: "Usuario",
            entidadId: usuario.id,
            resultado: "DENEGADO",
            ip: ctxReq.ip,
            userAgent: ctxReq.userAgent,
            metadatos: { metodo: "TOTP" },
          });
          throw new ErrorHttp(401, "Código TOTP inválido, expirado o ya utilizado");
        }
        pasoUsado = verificacion.pasoUsado;
      } else if (datos.codigoRecuperacion) {
        const hashCodigo = hashCodigoRecuperacionMfa(datos.codigoRecuperacion);
        const codigoReg = await prisma.codigoRecuperacionMfa.findFirst({
          where: {
            usuarioId: usuario.id,
            codigoHash: hashCodigo,
            usadoEn: null,
          },
        });
        if (!codigoReg) {
          await limitadorMfaUsuario.registrarIntento(claveUsuario);
          await registrarAuditoriaAdmin({
            actorUsuarioId: usuario.id,
            actorCorreo: usuario.correo,
            accion: "ADMIN_MFA_FALLIDO",
            entidad: "Usuario",
            entidadId: usuario.id,
            resultado: "DENEGADO",
            ip: ctxReq.ip,
            userAgent: ctxReq.userAgent,
            metadatos: { metodo: "CODIGO_RECUPERACION" },
          });
          throw new ErrorHttp(401, "Código de recuperación MFA inválido o ya utilizado");
        }
        codigoRecUsadoId = codigoReg.id;
      }

      await limitadorMfaUsuario.reiniciarClave(claveUsuario);

      const sesionId = randomUUID();
      const { token, expiraEn } = firmarToken(
        {
          tipoAcceso: "ADMIN_GLOBAL",
          usuarioId: usuario.id,
          rolPlataforma: "ADMIN_GLOBAL",
          mfaVerificado: true,
        },
        sesionId
      );
      const tokenHash = hashToken(token);

      await prisma.$transaction(async (tx) => {
        if (codigoRecUsadoId) {
          const consumido = await tx.codigoRecuperacionMfa.updateMany({
            where: { id: codigoRecUsadoId, usadoEn: null },
            data: { usadoEn: ahora },
          });
          if (consumido.count === 0) {
            throw new ErrorHttp(401, "Código de recuperación MFA ya utilizado");
          }
        }

        await tx.usuario.update({
          where: { id: usuario.id },
          data: {
            mfaVerificadoEn: ahora,
            ultimoAccesoEn: ahora,
            ...(pasoUsado !== undefined ? { mfaUltimoPasoUsado: BigInt(pasoUsado) } : {}),
          },
        });

        await tx.sesion.create({
          data: {
            id: sesionId,
            usuarioId: usuario.id,
            tokenHash,
            tipoAcceso: "ADMIN_GLOBAL",
            mfaVerificado: true,
            mfaVerificadoEn: ahora,
            ipOrigen: ctxReq.ip,
            userAgent: ctxReq.userAgent,
            expiraEn,
          },
        });

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: usuario.id,
            actorCorreo: usuario.correo,
            accion: codigoRecUsadoId
              ? "ADMIN_MFA_RECUPERACION_CODIGO_USADO"
              : "ADMIN_INICIO_SESION",
            entidad: "Sesion",
            entidadId: sesionId,
            ip: ctxReq.ip,
            userAgent: ctxReq.userAgent,
          },
          tx
        );
      });

      res.json({
        token,
        contexto: {
          tipoAcceso: "ADMIN_GLOBAL",
          rolPlataforma: "ADMIN_GLOBAL",
          mfaVerificado: true,
        },
        usuario: {
          id: usuario.id,
          correo: usuario.correo,
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          rolPlataforma: "ADMIN_GLOBAL",
          mfaHabilitado: true,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

rutasAutenticacion.post(
  "/admin/mfa/solicitar-recuperacion",
  limitadorRecuperacionIp.limitar(generarClaveIpRecuperacion),
  limitadorRecuperacionCuenta.limitar(generarClaveCuentaRecuperacion),
  async (req, res, next) => {
    try {
      const datos = esquemaSolicitarRecuperacion.parse(req.body);
      const correoNormalizado = datos.correo.trim().toLowerCase();

      if (!estaConfiguradoTransporte()) {
        throw new ErrorHttp(
          503,
          "El servicio de recuperación por correo no está configurado o no se encuentra disponible."
        );
      }

      const usuario = await prisma.usuario.findUnique({
        where: { correo: correoNormalizado },
        select: { id: true, correo: true, nombre: true, rolPlataforma: true },
      });

      const mensajeUniforme =
        "Si la cuenta corresponde a un superadministrador registrado, recibirás instrucciones para restablecer tu MFA.";

      if (!usuario || usuario.rolPlataforma !== "ADMIN_GLOBAL") {
        return res.json({ mensaje: mensajeUniforme });
      }

      const tokenPlano = generarTokenRecuperacionMfa();
      const tokenHash = hashTokenRecuperacionMfa(tokenPlano);
      const ahora = hooksPruebas.obtenerAhora();
      const expiraEn = new Date(ahora.getTime() + 20 * 60 * 1000);

      await prisma.solicitudRecuperacionMfa.updateMany({
        where: { usuarioId: usuario.id, usadoEn: null },
        data: { usadoEn: ahora },
      });

      await prisma.solicitudRecuperacionMfa.create({
        data: {
          usuarioId: usuario.id,
          tokenHash,
          expiraEn,
        },
      });

      const enlace = construirEnlaceRecuperacionMfa(tokenPlano);
      try {
        await enviarCorreoRecuperacion({
          destinatario: usuario.correo,
          nombre: usuario.nombre || "Administrador",
          enlace,
          minutosExpiracion: 20,
        });
      } catch (err: any) {
        console.error("[MFA_RECUPERACION] Error al enviar correo SMTP:", err?.message || err);
        await prisma.solicitudRecuperacionMfa.updateMany({
          where: { tokenHash },
          data: { usadoEn: ahora },
        });
      }

      return res.json({ mensaje: mensajeUniforme });
    } catch (err) {
      next(err);
    }
  }
);

rutasAutenticacion.post(
  "/admin/mfa/restablecer",
  limitadorRestablecerIp.limitar(generarClaveIpRecuperacion),
  async (req, res, next) => {
    try {
      const datos = esquemaRestablecerMfa.parse(req.body);
      const tokenHash = hashTokenRecuperacionMfa(datos.token.trim());
      const ahora = hooksPruebas.obtenerAhora();

      const solicitud = await prisma.solicitudRecuperacionMfa.findUnique({
        where: { tokenHash },
        include: {
          usuario: {
            select: { id: true, correo: true, contrasenaHash: true, rolPlataforma: true },
          },
        },
      });

      if (!solicitud || solicitud.usuario.rolPlataforma !== "ADMIN_GLOBAL") {
        throw new ErrorHttp(404, "Enlace de recuperación MFA inválido o no encontrado.");
      }

      if (solicitud.usadoEn !== null || solicitud.expiraEn <= ahora) {
        throw new ErrorHttp(410, "El enlace de recuperación MFA ha expirado o ya fue utilizado.");
      }

      const contrasenaValida = await bcrypt.compare(datos.contrasena, solicitud.usuario.contrasenaHash);
      if (!contrasenaValida) {
        throw new ErrorHttp(401, "Credenciales inválidas para restablecer MFA.");
      }

      const ctxReq = extraerContextoRequestAuditoria(req);

      await prisma.$transaction(async (tx) => {
        await tx.solicitudRecuperacionMfa.update({
          where: { id: solicitud.id },
          data: { usadoEn: ahora },
        });

        await tx.solicitudRecuperacionMfa.updateMany({
          where: { usuarioId: solicitud.usuarioId, usadoEn: null },
          data: { usadoEn: ahora },
        });

        await tx.usuario.update({
          where: { id: solicitud.usuarioId },
          data: {
            mfaHabilitado: false,
            mfaSecretoCifrado: null,
            mfaPendienteSecretoCifrado: null,
            mfaVerificadoEn: null,
            mfaUltimoPasoUsado: null,
          },
        });

        await tx.codigoRecuperacionMfa.deleteMany({
          where: { usuarioId: solicitud.usuarioId },
        });

        await tx.sesion.updateMany({
          where: { usuarioId: solicitud.usuarioId, revocadaEn: null },
          data: { revocadaEn: ahora },
        });

        await registrarAuditoriaAdmin(
          {
            actorUsuarioId: solicitud.usuarioId,
            actorCorreo: solicitud.usuario.correo,
            accion: "ADMIN_MFA_RESTABLECIDO",
            entidad: "Usuario",
            entidadId: solicitud.usuarioId,
            ip: ctxReq.ip,
            userAgent: ctxReq.userAgent,
          },
          tx
        );
      });

      res.json({
        mensaje:
          "MFA restablecido y sesiones revocadas. Deberás configurar un nuevo autenticador TOTP en tu próximo ingreso administrativo.",
      });
    } catch (err) {
      next(err);
    }
  }
);
