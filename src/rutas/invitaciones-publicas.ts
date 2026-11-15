import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";
import { hashTokenInvitacion } from "../utilidades/invitaciones.js";
import { LimitadorMemoria } from "../middleware/rate-limit.js";
import { hooksPruebas } from "../utilidades/hooks-pruebas.js";

export const rutasInvitacionesPublicas = Router();

// Rate limiting de dos niveles para rutas públicas:
// 1. Límite global por IP (mitiga atacantes rotando tokens):
//    - Consulta: 60 solicitudes por minuto por IP
//    - Aceptación: 15 solicitudes por minuto por IP (más estricto)
// 2. Límite específico por IP + tokenHash (mitiga ataques dirigidos a una invitación):
//    - Consulta: 30 solicitudes por minuto por IP+hash
//    - Aceptación: 5 solicitudes por minuto por IP+hash (muy estricto)
export const limitadorConsultaGlobalIp = new LimitadorMemoria(
  60 * 1000,
  60,
  "Demasiadas solicitudes de consulta desde esta dirección IP. Por favor espere un momento.",
  5000,
  "consulta-global-ip"
);

export const limitadorConsultaEspecifico = new LimitadorMemoria(
  60 * 1000,
  30,
  "Demasiadas consultas para este enlace de invitación. Por favor espere un momento.",
  5000,
  "consulta-especifico-token"
);

export const limitadorAceptacionGlobalIp = new LimitadorMemoria(
  60 * 1000,
  15,
  "Demasiados intentos de aceptación desde esta dirección IP. Por favor espere un momento.",
  5000,
  "aceptacion-global-ip"
);

export const limitadorAceptacionEspecifico = new LimitadorMemoria(
  60 * 1000,
  5,
  "Demasiados intentos de aceptación para este enlace. Por favor espere un momento.",
  5000,
  "aceptacion-especifico-token"
);

export function generarClaveIp(req: { ip?: string }): string {
  return `ip:${req.ip || "127.0.0.1"}`;
}

export function generarClaveIpTokenHash(req: { ip?: string; params: { token?: string } }): string {
  const ip = req.ip || "127.0.0.1";
  const token = typeof req.params.token === "string" ? req.params.token.trim() : "";
  // Clave no reversible con hash SHA-256: nunca almacenar el token plano
  const tokenHash = token ? hashTokenInvitacion(token) : "notoken";
  return `iptoken:${ip}:${tokenHash}`;
}

const esquemaAceptarNuevo = z.object({
  nombre: z.string().min(2),
  apellido: z.string().optional(),
  contrasena: z.string().min(8),
});

const esquemaAceptarExistente = z.object({
  contrasena: z.string().min(1),
  nombre: z.string().min(2).optional(),
  apellido: z.string().optional(),
});

function enmascararCorreo(correo: string): string {
  const [usuario, dominio] = correo.split("@");
  if (!dominio) return correo;
  const parteVisible = usuario.length > 2 ? usuario.slice(0, 2) : usuario.slice(0, 1);
  return `${parteVisible}***@${dominio}`;
}

// 1. Consultar una invitación: GET /api/invitaciones/:token
rutasInvitacionesPublicas.get(
  "/:token",
  limitadorConsultaGlobalIp.limitar(generarClaveIp),
  limitadorConsultaEspecifico.limitar(generarClaveIpTokenHash),
  async (req, res, next) => {
    try {
      const tokenPlano = typeof req.params.token === "string" ? req.params.token : "";
      if (!tokenPlano || tokenPlano.trim().length < 10) {
        throw new ErrorHttp(404, "Enlace de invitación inválido o no encontrado");
      }

      const tokenHash = hashTokenInvitacion(tokenPlano.trim());

      const invitacion = await prisma.invitacionCliente.findUnique({
        where: { tokenHash },
        include: {
          cliente: {
            select: { nombre: true, empresa: true },
          },
          organizacion: {
            select: { nombre: true, logoUrl: true },
          },
        },
      });

      if (!invitacion) {
        throw new ErrorHttp(404, "Enlace de invitación inválido o no encontrado");
      }

      const ahora = hooksPruebas.obtenerAhora();

      // Si está expirada por fecha (expiraEn <= ahora) pero sigue figurando como PENDIENTE:
      // Actualización CAS condicional para no sobrescribir una aceptación concurrente
      if (invitacion.expiraEn <= ahora && invitacion.estado === "PENDIENTE") {
        await prisma.invitacionCliente.updateMany({
          where: {
            id: invitacion.id,
            estado: "PENDIENTE",
            tokenHash,
            expiraEn: { lte: ahora },
          },
          data: { estado: "EXPIRADA" },
        });
        throw new ErrorHttp(410, "La invitación ha expirado");
      }

      if (invitacion.estado === "EXPIRADA") {
        throw new ErrorHttp(410, "La invitación ha expirado");
      }

      if (invitacion.estado === "REVOCADA") {
        throw new ErrorHttp(410, "La invitación ha sido revocada");
      }

      if (invitacion.estado === "ACEPTADA") {
        throw new ErrorHttp(409, "La invitación ya fue aceptada previamente");
      }

      // Verificamos si existe usuario exclusivamente para adaptar los campos del formulario del cliente invitado
      const usuarioExistente = await prisma.usuario.findUnique({
        where: { correo: invitacion.correo },
        select: { id: true },
      });

      // Respuesta pública mínima: NUNCA devolver correo completo, contraseñas, hashes ni IDs internos
      res.json({
        correoEnmascarado: enmascararCorreo(invitacion.correo),
        rol: invitacion.rol,
        expiraEn: invitacion.expiraEn,
        cliente: {
          nombre: invitacion.cliente.nombre,
          empresa: invitacion.cliente.empresa,
        },
        organizacion: {
          nombre: invitacion.organizacion.nombre,
          logoUrl: invitacion.organizacion.logoUrl,
        },
        esUsuarioExistente: Boolean(usuarioExistente),
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Aceptar una invitación: POST /api/invitaciones/:token/aceptar
rutasInvitacionesPublicas.post(
  "/:token/aceptar",
  limitadorAceptacionGlobalIp.limitar(generarClaveIp),
  limitadorAceptacionEspecifico.limitar(generarClaveIpTokenHash),
  async (req, res, next) => {
    try {
      const tokenPlano = typeof req.params.token === "string" ? req.params.token : "";
      if (!tokenPlano || tokenPlano.trim().length < 10) {
        throw new ErrorHttp(404, "Enlace de invitación inválido o no encontrado");
      }

      const tokenHash = hashTokenInvitacion(tokenPlano.trim());

      // 1. Localizar la invitación por hash
      const invitacion = await prisma.invitacionCliente.findUnique({
        where: { tokenHash },
      });

      if (!invitacion) {
        throw new ErrorHttp(404, "Enlace de invitación inválido o no encontrado");
      }

      const ahora = hooksPruebas.obtenerAhora();

      if (invitacion.expiraEn <= ahora || invitacion.estado === "EXPIRADA") {
        if (invitacion.estado === "PENDIENTE") {
          await prisma.invitacionCliente.updateMany({
            where: {
              id: invitacion.id,
              estado: "PENDIENTE",
              tokenHash,
              expiraEn: { lte: ahora },
            },
            data: { estado: "EXPIRADA" },
          });
        }
        throw new ErrorHttp(410, "La invitación ha expirado");
      }

      if (invitacion.estado === "REVOCADA") {
        throw new ErrorHttp(410, "La invitación ha sido revocada");
      }

      if (invitacion.estado === "ACEPTADA") {
        throw new ErrorHttp(409, "La invitación ya fue aceptada previamente");
      }

      // Comprobar si el usuario existe para bifurcar validación
      const usuarioExistente = await prisma.usuario.findUnique({
        where: { correo: invitacion.correo },
      });

      if (usuarioExistente) {
        // Caso B: Usuario existente
        const datos = esquemaAceptarExistente.parse(req.body);
        const coincide = await bcrypt.compare(datos.contrasena, usuarioExistente.contrasenaHash);
        if (!coincide) {
          throw new ErrorHttp(401, "Contraseña incorrecta para el usuario existente");
        }
      } else {
        // Caso A: Usuario nuevo
        esquemaAceptarNuevo.parse(req.body);
      }

      try {
        const resultado = await prisma.$transaction(async (tx) => {
          await hooksPruebas.ejecutar("antes_aceptar_invitacion");

          // Revalida el vencimiento dentro de la transacción usando un instante actual controlable
          const ahoraTransaccion = hooksPruebas.obtenerAhora();

          // ACTUALIZACIÓN CONDICIONAL ATÓMICA DE CONCURRENCIA:
          // Comprueba: id, estado PENDIENTE, expiraEn > ahoraTransaccion Y tokenHash = hash del token presentado
          const actualizacionConcurrente = await tx.invitacionCliente.updateMany({
            where: {
              id: invitacion.id,
              estado: "PENDIENTE",
              tokenHash, // Comprueba que el token presentado siga siendo el activo
              expiraEn: { gt: ahoraTransaccion },
            },
            data: {
              estado: "ACEPTADA",
              aceptadaEn: ahoraTransaccion,
            },
          });

          if (actualizacionConcurrente.count === 0) {
            // Si el CAS devuelve count === 0, vuelve a consultar dentro de la transacción.
            const invActual = await tx.invitacionCliente.findUnique({
              where: { id: invitacion.id },
            });

            // Si continúa PENDIENTE y expiraEn <= ahoraTransaccion, actualízala a EXPIRADA y devuelve resultado discriminado
            if (invActual && invActual.estado === "PENDIENTE" && invActual.expiraEn <= ahoraTransaccion) {
              await tx.invitacionCliente.updateMany({
                where: {
                  id: invitacion.id,
                  estado: "PENDIENTE",
                  tokenHash,
                  expiraEn: { lte: ahoraTransaccion },
                },
                data: { estado: "EXPIRADA" },
              });
              return { tipo: "EXPIRADA" as const };
            }

            if (invActual && invActual.estado === "EXPIRADA") {
              return { tipo: "EXPIRADA" as const };
            }

            throw new ErrorHttp(409, "La invitación no pudo ser aceptada o ya fue procesada");
          }

          let usuarioFinalId = usuarioExistente?.id;

          if (!usuarioExistente) {
            const datosNuevo = esquemaAceptarNuevo.parse(req.body);
            const contrasenaHash = await bcrypt.hash(datosNuevo.contrasena, 12);
            const nuevoUsuario = await tx.usuario.create({
              data: {
                correo: invitacion.correo,
                contrasenaHash,
                nombre: datosNuevo.nombre,
                apellido: datosNuevo.apellido,
              },
            });
            usuarioFinalId = nuevoUsuario.id;
          }

          // Crear o reactivar AccesoCliente de forma idempotente
          const accesoExistente = await tx.accesoCliente.findUnique({
            where: {
              usuarioId_clienteId: {
                usuarioId: usuarioFinalId!,
                clienteId: invitacion.clienteId,
              },
            },
          });

          let accesoClienteResultado;
          if (accesoExistente) {
            accesoClienteResultado = await tx.accesoCliente.update({
              where: { id: accesoExistente.id },
              data: {
                activo: true,
                rol: invitacion.rol,
                organizacionId: invitacion.organizacionId,
              },
            });
          } else {
            accesoClienteResultado = await tx.accesoCliente.create({
              data: {
                usuarioId: usuarioFinalId!,
                clienteId: invitacion.clienteId,
                organizacionId: invitacion.organizacionId,
                rol: invitacion.rol,
                activo: true,
              },
            });
          }

          // Marcar aceptadaPorId en la invitación
          await tx.invitacionCliente.update({
            where: { id: invitacion.id },
            data: {
              aceptadaPorId: usuarioFinalId!,
            },
          });

          // Registrar actividad atómica
          await registrarActividad(
            {
              organizacionId: invitacion.organizacionId,
              usuarioId: usuarioFinalId!,
              entidad: "invitacion_cliente",
              entidadId: invitacion.id,
              accion: "ACEPTAR",
              descripcion: `Aceptó invitación para el cliente`,
              metadatos: {
                clienteId: invitacion.clienteId,
                rol: invitacion.rol,
              },
            },
            tx
          );

          return {
            tipo: "EXITOSA" as const,
            mensaje: "Invitación aceptada exitosamente",
            clienteId: invitacion.clienteId,
            rol: accesoClienteResultado.rol,
          };
        });

        if (resultado.tipo === "EXPIRADA") {
          throw new ErrorHttp(410, "La invitación ha expirado");
        }

        res.status(200).json({
          mensaje: resultado.mensaje,
          clienteId: resultado.clienteId,
          rol: resultado.rol,
        });
      } catch (txError) {
        if (txError instanceof Prisma.PrismaClientKnownRequestError && txError.code === "P2002") {
          throw new ErrorHttp(409, "Conflicto con un registro existente");
        }
        throw txError;
      }
    } catch (err) {
      next(err);
    }
  }
);
