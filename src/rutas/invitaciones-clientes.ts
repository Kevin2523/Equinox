import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";
import { registrarActividad } from "../utilidades/actividad.js";
import {
  adaptadorInvitaciones,
  calcularFechaExpiracion,
  generarTokenInvitacion,
  hashTokenInvitacion,
} from "../utilidades/invitaciones.js";
import { hooksPruebas } from "../utilidades/hooks-pruebas.js";

export const rutasInvitacionesClientes = Router({ mergeParams: true });

const esquemaCrearInvitacion = z.object({
  correo: z.string().email(),
  rol: z.enum(["TITULAR", "COLABORADOR"]).default("TITULAR"),
});

const uuid = z.string().uuid();

// 1. Crear invitación: POST /api/clientes/:clienteId/invitaciones
rutasInvitacionesClientes.post("/", async (req: SolicitudAutenticada, res, next) => {
  try {
    const clienteId = uuid.parse(req.params.clienteId);
    const organizacionId = req.sesion!.organizacionId;
    const usuarioId = req.sesion!.usuarioId;

    const datos = esquemaCrearInvitacion.parse(req.body);
    const correoNormalizado = datos.correo.trim().toLowerCase();

    // Validar que el cliente pertenezca a la organización actual
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, organizacionId },
      include: { organizacion: { select: { nombre: true } } },
    });

    if (!cliente) {
      throw new ErrorHttp(404, "Cliente no encontrado en tu organización");
    }

    let tokenPlano = generarTokenInvitacion();
    let tokenHash = hashTokenInvitacion(tokenPlano);
    const expiraEn = calcularFechaExpiracion();

    // Hook para sincronizar solicitudes concurrentes en pruebas antes de iniciar transacciones
    await hooksPruebas.ejecutar("antes_crear_invitacion");

    // Estrategia segura y limitada para manejar condiciones de carrera de creación concurrente:
    // Reintentar hasta 5 veces si ocurre colisión con el índice único parcial
    let intento = 0;
    const maxIntentos = 5;

    while (intento < maxIntentos) {
      intento++;
      try {
        const resultado = await prisma.$transaction(async (tx) => {
          // Si existe otra invitación PENDIENTE para el mismo cliente y correo, revocarla transaccionalmente
          await tx.invitacionCliente.updateMany({
            where: {
              clienteId,
              organizacionId,
              correo: correoNormalizado,
              estado: "PENDIENTE",
            },
            data: {
              estado: "REVOCADA",
            },
          });

          await hooksPruebas.ejecutar("en_transaccion_crear_invitacion");

          const invitacion = await tx.invitacionCliente.create({
            data: {
              clienteId,
              organizacionId,
              correo: correoNormalizado,
              rol: datos.rol,
              tokenHash,
              expiraEn,
              invitadoPorId: usuarioId,
              estado: "PENDIENTE",
            },
            select: {
              id: true,
              clienteId: true,
              organizacionId: true,
              correo: true,
              rol: true,
              estado: true,
              expiraEn: true,
              creadoEn: true,
            },
          });

          await registrarActividad(
            {
              organizacionId,
              usuarioId,
              entidad: "invitacion_cliente",
              entidadId: invitacion.id,
              accion: "INVITAR",
              descripcion: `Invitó a ${correoNormalizado} para el cliente ${cliente.nombre}`,
              metadatos: { rol: datos.rol },
            },
            tx
          );

          await hooksPruebas.ejecutar("despues_crear_invitacion");

          return invitacion;
        });

        const entrega = adaptadorInvitaciones.entregar({
          correo: correoNormalizado,
          token: tokenPlano,
          nombreOrganizacion: cliente.organizacion.nombre,
          nombreCliente: cliente.nombre,
        });

        res.setHeader("Cache-Control", "no-store");
        return res.status(201).json({
          invitacion: resultado,
          ...(entrega.enlaceInvitacion ? { enlaceInvitacion: entrega.enlaceInvitacion } : {}),
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const target = String(err.meta?.target || "");
          const esConflictoTokenHash = target.includes("token_hash") || target.includes("tokenHash");

          if (esConflictoTokenHash) {
            // Colisión extremadamente rara de tokenHash: regenerar token sin esperar
            tokenPlano = generarTokenInvitacion();
            tokenHash = hashTokenInvitacion(tokenPlano);
            continue;
          }

          const esConflictoPendiente =
            target.includes("pendiente") ||
            (target.includes("cliente_id") && target.includes("correo")) ||
            target.includes("invitaciones_cliente_cliente_id_correo_pendiente_key");

          if (esConflictoPendiente) {
            if (intento < maxIntentos) {
              // Pequeño backoff con jitter (10-35ms) para desempatar transacciones concurrentes
              const espera = 10 + Math.floor(Math.random() * 25);
              await new Promise((resolve) => setTimeout(resolve, espera));
              continue;
            }
            // Agotados los reintentos: responder 409 controlado, NUNCA 500
            throw new ErrorHttp(
              409,
              "Conflicto concurrente al crear la invitación. Por favor reintente la operación."
            );
          }
        }
        throw err;
      }
    }

    throw new ErrorHttp(
      409,
      "No fue posible generar un token único tras múltiples intentos. Por favor reintente la operación."
    );
  } catch (err) {
    next(err);
  }
});

// 2. Consultar invitaciones: GET /api/clientes/:clienteId/invitaciones
rutasInvitacionesClientes.get("/", async (req: SolicitudAutenticada, res, next) => {
  try {
    const clienteId = uuid.parse(req.params.clienteId);
    const organizacionId = req.sesion!.organizacionId;

    // Validar que el cliente pertenezca a la organización actual
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, organizacionId },
    });

    if (!cliente) {
      throw new ErrorHttp(404, "Cliente no encontrado en tu organización");
    }

    const invitaciones = await prisma.invitacionCliente.findMany({
      where: {
        clienteId,
        organizacionId,
      },
      select: {
        id: true,
        correo: true,
        rol: true,
        estado: true,
        expiraEn: true,
        aceptadaEn: true,
        creadoEn: true,
        actualizadoEn: true,
        invitadoPor: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            correo: true,
          },
        },
        aceptadaPor: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            correo: true,
          },
        },
      },
      orderBy: { creadoEn: "desc" },
    });

    res.json(invitaciones);
  } catch (err) {
    next(err);
  }
});

// 3. Reenviar invitación: POST /api/clientes/:clienteId/invitaciones/:invitacionId/reenviar
rutasInvitacionesClientes.post("/:invitacionId/reenviar", async (req: SolicitudAutenticada, res, next) => {
  try {
    const clienteId = uuid.parse(req.params.clienteId);
    const invitacionId = uuid.parse(req.params.invitacionId);
    const organizacionId = req.sesion!.organizacionId;
    const usuarioId = req.sesion!.usuarioId;

    const invitacionExistente = await prisma.invitacionCliente.findFirst({
      where: {
        id: invitacionId,
        clienteId,
        organizacionId,
      },
      include: {
        cliente: {
          select: { nombre: true },
        },
        organizacion: {
          select: { nombre: true },
        },
      },
    });

    if (!invitacionExistente) {
      throw new ErrorHttp(404, "Invitación no encontrada");
    }

    if (invitacionExistente.estado === "ACEPTADA") {
      throw new ErrorHttp(409, "Una invitación aceptada no puede reenviarse");
    }

    if (invitacionExistente.estado === "REVOCADA") {
      throw new ErrorHttp(409, "Una invitación revocada no puede reenviarse");
    }

    let intentoReenvio = 0;
    const maxIntentosReenvio = 5;

    while (intentoReenvio < maxIntentosReenvio) {
      intentoReenvio++;
      const tokenPlano = generarTokenInvitacion();
      const tokenHashNuevo = hashTokenInvitacion(tokenPlano);

      // COMPARE-AND-SWAP ATÓMICO:
      // Comparar la versión leída completa, incluido estado exacto y vencimiento.
      try {
        const resultado = await prisma.$transaction(async (tx) => {
          await hooksPruebas.ejecutar("antes_reenviar_invitacion");
          await hooksPruebas.ejecutar("en_transaccion_reenviar_invitacion");
          const ahora = hooksPruebas.obtenerAhora();
          const expirada = invitacionExistente.estado === "EXPIRADA" || invitacionExistente.expiraEn <= ahora;
          const expiraEn = calcularFechaExpiracion(ahora);

          // Misma regla para vencimiento por fecha y estado EXPIRADA persistido.
          // El índice parcial protege también inserciones concurrentes tras esta lectura.
          if (expirada) {
            const concurrentePendiente = await tx.invitacionCliente.findFirst({
              where: {
                clienteId,
                organizacionId,
                correo: invitacionExistente.correo,
                estado: "PENDIENTE",
                NOT: { id: invitacionExistente.id },
              },
            });

            if (concurrentePendiente) {
              throw new ErrorHttp(
                409,
                "Ya existe una invitación pendiente activa para este cliente y correo electrónico"
              );
            }
          }

          const actualizacion = await tx.invitacionCliente.updateMany({
            where: {
              id: invitacionExistente.id,
              clienteId,
              organizacionId,
              estado: invitacionExistente.estado,
              tokenHash: invitacionExistente.tokenHash, // CAS: verificar el hash previo
              expiraEn: {
                equals: invitacionExistente.expiraEn,
                ...(invitacionExistente.estado === "PENDIENTE"
                  ? expirada ? { lte: ahora } : { gt: ahora }
                  : {}),
              },
            },
            data: {
              tokenHash: tokenHashNuevo,
              expiraEn,
              estado: "PENDIENTE",
            },
          });

          if (actualizacion.count === 0) {
            throw new ErrorHttp(409, "Conflicto al reenviar invitación: el estado, token o vencimiento ha cambiado");
          }

          await registrarActividad(
            {
              organizacionId,
              usuarioId,
              entidad: "invitacion_cliente",
              entidadId: invitacionExistente.id,
              accion: "REENVIAR",
              descripcion: `Reenvió la invitación a ${invitacionExistente.correo}`,
            },
            tx
          );

          await hooksPruebas.ejecutar("despues_reenviar_invitacion");

          const invitacionActualizada = await tx.invitacionCliente.findUnique({
            where: { id: invitacionExistente.id },
            select: {
              id: true,
              clienteId: true,
              organizacionId: true,
              correo: true,
              rol: true,
              estado: true,
              expiraEn: true,
              creadoEn: true,
              actualizadoEn: true,
            },
          });

          return invitacionActualizada;
        });

        const entrega = adaptadorInvitaciones.entregar({
          correo: invitacionExistente.correo,
          token: tokenPlano,
          nombreOrganizacion: invitacionExistente.organizacion.nombre,
          nombreCliente: invitacionExistente.cliente.nombre,
        });

        res.setHeader("Cache-Control", "no-store");
        return res.json({
          invitacion: resultado,
          ...(entrega.enlaceInvitacion ? { enlaceInvitacion: entrega.enlaceInvitacion } : {}),
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          const target = String(err.meta?.target || "");
          const esConflictoTokenHash = target.includes("token_hash") || target.includes("tokenHash");

          if (esConflictoTokenHash) {
            if (intentoReenvio < maxIntentosReenvio) {
              continue;
            }
            throw new ErrorHttp(
              409,
              "No fue posible regenerar un token único tras múltiples intentos. Por favor reintente la operación."
            );
          }

          if (
            target.includes("pendiente") ||
            target.includes("correo") ||
            target.includes("cliente_id")
          ) {
            throw new ErrorHttp(
              409,
              "Ya existe una invitación pendiente activa para este cliente y correo electrónico"
            );
          }
        }
        throw err;
      }
    }

    throw new ErrorHttp(
      409,
      "No fue posible generar un token único tras múltiples intentos. Por favor reintente la operación."
    );
  } catch (err) {
    next(err);
  }
});

// 4. Revocar invitación: POST /api/clientes/:clienteId/invitaciones/:invitacionId/revocar
rutasInvitacionesClientes.post("/:invitacionId/revocar", async (req: SolicitudAutenticada, res, next) => {
  try {
    const clienteId = uuid.parse(req.params.clienteId);
    const invitacionId = uuid.parse(req.params.invitacionId);
    const organizacionId = req.sesion!.organizacionId;
    const usuarioId = req.sesion!.usuarioId;

    const invitacionExistente = await prisma.invitacionCliente.findFirst({
      where: {
        id: invitacionId,
        clienteId,
        organizacionId,
      },
    });

    if (!invitacionExistente) {
      throw new ErrorHttp(404, "Invitación no encontrada");
    }

    if (invitacionExistente.estado === "ACEPTADA") {
      throw new ErrorHttp(409, "Una invitación aceptada no puede revocarse");
    }

    if (invitacionExistente.estado === "REVOCADA") {
      return res.json({
        mensaje: "La invitación ya se encuentra revocada",
        invitacion: {
          id: invitacionExistente.id,
          estado: "REVOCADA",
        },
      });
    }

    // COMPARE-AND-SWAP ATÓMICO:
    // Solo revocar si sigue PENDIENTE y con el tokenHash esperado
    const revocada = await prisma.$transaction(async (tx) => {
      await hooksPruebas.ejecutar("antes_revocar_invitacion");

      const actualizacion = await tx.invitacionCliente.updateMany({
        where: {
          id: invitacionExistente.id,
          clienteId,
          organizacionId,
          estado: "PENDIENTE",
          tokenHash: invitacionExistente.tokenHash,
        },
        data: {
          estado: "REVOCADA",
        },
      });

      if (actualizacion.count === 0) {
        throw new ErrorHttp(409, "Conflicto al revocar invitación: el estado o token ha cambiado");
      }

      await registrarActividad(
        {
          organizacionId,
          usuarioId,
          entidad: "invitacion_cliente",
          entidadId: invitacionExistente.id,
          accion: "REVOCAR",
          descripcion: `Revocó la invitación de ${invitacionExistente.correo}`,
        },
        tx
      );

      const inv = await tx.invitacionCliente.findUnique({
        where: { id: invitacionExistente.id },
        select: {
          id: true,
          estado: true,
          actualizadoEn: true,
        },
      });

      return inv;
    });

    res.json({
      mensaje: "Invitación revocada exitosamente",
      invitacion: revocada,
    });
  } catch (err) {
    next(err);
  }
});
