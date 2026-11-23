import { createHash } from "crypto";
import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type {
  ContextoSesion,
  ContextoSesionAdmin,
  ContextoSinSesion,
  ContextoSinSesionAdmin,
  DatosJWT,
  RolMiembro,
  SolicitudAutenticada,
} from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";

const esquemaPayloadJwt = z.discriminatedUnion("tipoAcceso", [
  z.object({
    tipoAcceso: z.literal("ORGANIZACION"),
    sesionId: z.string().uuid(),
    usuarioId: z.string().uuid(),
    organizacionId: z.string().uuid(),
    rolOrganizacion: z.enum(["PROPIETARIO", "COLABORADOR"]),
  }),
  z.object({
    tipoAcceso: z.literal("CLIENTE"),
    sesionId: z.string().uuid(),
    usuarioId: z.string().uuid(),
    organizacionId: z.string().uuid(),
    clienteId: z.string().uuid(),
    rolCliente: z.enum(["TITULAR", "COLABORADOR"]),
  }),
  z.object({
    tipoAcceso: z.literal("ADMIN_GLOBAL"),
    sesionId: z.string().uuid(),
    usuarioId: z.string().uuid(),
    rolPlataforma: z.literal("ADMIN_GLOBAL"),
    mfaVerificado: z.literal(true),
  }),
]);

const esquemaPayloadDesafioMfa = z.object({
  tipoToken: z.literal("DESAFIO_MFA_ADMIN"),
  usuarioId: z.string().uuid(),
  proposito: z.enum(["CONFIGURAR", "VERIFICAR"]),
});

export function obtenerSecretoJwt(): string {
  const entorno = (process.env.ENTORNO || "").trim().toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
  const esProduccion = entorno === "produccion" || entorno === "production" || nodeEnv === "production" || nodeEnv === "produccion";

  const secreto = process.env.SECRETO_JWT;
  const secretoInseguro = "desarrollo-no-usar-en-produccion";

  if (esProduccion) {
    if (!secreto || secreto.trim() === "" || secreto.trim() === secretoInseguro) {
      throw new Error("Configuración insegura: SECRETO_JWT no está configurado adecuadamente para producción");
    }
    return secreto;
  }

  if (!secreto || secreto.trim() === "") {
    return secretoInseguro;
  }

  return secreto;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function firmarToken(
  datos: ContextoSinSesion | ContextoSinSesionAdmin,
  sesionId: string
): { token: string; expiraEn: Date } {
  const secreto = obtenerSecretoJwt();
  const vencimiento =
    datos.tipoAcceso === "ADMIN_GLOBAL"
      ? process.env.VENCIMIENTO_JWT_ADMIN || "8h"
      : process.env.VENCIMIENTO_JWT || "7d";
  const payload: DatosJWT = { ...datos, sesionId };

  const token = jwt.sign(payload, secreto, {
    expiresIn: vencimiento as jwt.SignOptions["expiresIn"],
  });

  const decodificado = jwt.decode(token) as { exp?: number };
  const expiraEn = decodificado?.exp
    ? new Date(decodificado.exp * 1000)
    : new Date(
        Date.now() + (datos.tipoAcceso === "ADMIN_GLOBAL" ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)
      );

  return { token, expiraEn };
}

export function firmarTokenDesafioMfa(
  usuarioId: string,
  proposito: "CONFIGURAR" | "VERIFICAR"
): string {
  const secreto = obtenerSecretoJwt();
  return jwt.sign(
    {
      tipoToken: "DESAFIO_MFA_ADMIN",
      usuarioId,
      proposito,
    },
    secreto,
    { expiresIn: "10m" }
  );
}

export function verificarTokenDesafioMfa(token: string): {
  usuarioId: string;
  proposito: "CONFIGURAR" | "VERIFICAR";
} {
  let decodificado: unknown;
  try {
    decodificado = jwt.verify(token, obtenerSecretoJwt());
  } catch {
    throw new ErrorHttp(401, "Desafío MFA inválido o vencido");
  }
  const res = esquemaPayloadDesafioMfa.safeParse(decodificado);
  if (!res.success) {
    throw new ErrorHttp(401, "Desafío MFA con estructura inválida");
  }
  return {
    usuarioId: res.data.usuarioId,
    proposito: res.data.proposito,
  };
}

export async function exigirAutenticacion(req: SolicitudAutenticada, _res: Response, next: NextFunction) {
  const encabezado = req.header("Authorization");
  if (!encabezado?.startsWith("Bearer ")) {
    return next(new ErrorHttp(401, "Se requiere autenticación"));
  }

  const token = encabezado.slice(7).trim();
  if (!token) {
    return next(new ErrorHttp(401, "Se requiere autenticación"));
  }

  let contenidoDecodificado: unknown;
  try {
    contenidoDecodificado = jwt.verify(token, obtenerSecretoJwt());
  } catch {
    return next(new ErrorHttp(401, "Token inválido o vencido"));
  }

  const resultadoValidacion = esquemaPayloadJwt.safeParse(contenidoDecodificado);
  if (!resultadoValidacion.success) {
    return next(new ErrorHttp(401, "Token con estructura inválida"));
  }

  const datos: DatosJWT = resultadoValidacion.data;

  try {
    const sesion = await prisma.sesion.findUnique({
      where: { id: datos.sesionId },
    });

    if (!sesion) {
      return next(new ErrorHttp(401, "Sesión no válida o expirada"));
    }

    if (sesion.revocadaEn !== null) {
      return next(new ErrorHttp(401, "Sesión revocada"));
    }

    if (sesion.expiraEn < new Date()) {
      return next(new ErrorHttp(401, "Sesión expirada"));
    }

    if (sesion.usuarioId !== datos.usuarioId) {
      return next(new ErrorHttp(401, "Sesión no válida"));
    }

    const tokenCalculadoHash = hashToken(token);
    if (sesion.tokenHash !== tokenCalculadoHash) {
      return next(new ErrorHttp(401, "Token no coincide con la sesión"));
    }

    if (sesion.tipoAcceso !== datos.tipoAcceso) {
      return next(new ErrorHttp(403, "Contexto de sesión no coincide con el token"));
    }

    // Revalidación contra la base de datos según el contexto
    if (datos.tipoAcceso === "ADMIN_GLOBAL") {
      if (!sesion.mfaVerificado || !sesion.mfaVerificadoEn) {
        return next(new ErrorHttp(403, "La sesión administrativa requiere verificación MFA"));
      }

      const usuarioAdmin = await prisma.usuario.findUnique({
        where: { id: datos.usuarioId },
        select: { id: true, rolPlataforma: true, mfaHabilitado: true },
      });

      if (!usuarioAdmin || usuarioAdmin.rolPlataforma !== "ADMIN_GLOBAL" || !usuarioAdmin.mfaHabilitado) {
        return next(new ErrorHttp(403, "Acceso restringido a superadministradores globales"));
      }
    } else if (datos.tipoAcceso === "ORGANIZACION") {
      const miembro = await prisma.miembroOrganizacion.findUnique({
        where: {
          usuarioId_organizacionId: {
            usuarioId: datos.usuarioId,
            organizacionId: datos.organizacionId,
          },
        },
        include: {
          organizacion: {
            select: { suspendidaEn: true },
          },
        },
      });

      if (!miembro) {
        return next(new ErrorHttp(403, "No perteneces a esta organización"));
      }

      if (miembro.organizacion.suspendidaEn !== null) {
        return next(new ErrorHttp(403, "Esta organización se encuentra suspendida"));
      }

      // Sincronizar el rol real de la base de datos
      datos.rolOrganizacion = miembro.rol;
    } else if (datos.tipoAcceso === "CLIENTE") {
      const acceso = await prisma.accesoCliente.findUnique({
        where: {
          usuarioId_clienteId: {
            usuarioId: datos.usuarioId,
            clienteId: datos.clienteId,
          },
        },
        include: {
          organizacion: {
            select: { suspendidaEn: true },
          },
        },
      });

      if (!acceso || !acceso.activo || acceso.organizacionId !== datos.organizacionId) {
        return next(new ErrorHttp(403, "Acceso de cliente inactivo o no autorizado"));
      }

      if (acceso.organizacion.suspendidaEn !== null) {
        return next(new ErrorHttp(403, "Esta organización se encuentra suspendida"));
      }

      datos.rolCliente = acceso.rol;
    }

    if (datos.tipoAcceso === "ADMIN_GLOBAL") {
      req.sesionAdmin = datos;
      req.sesion = datos as unknown as ContextoSesion;
    } else {
      req.sesion = datos;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function exigirOrganizacion(req: SolicitudAutenticada, _res: Response, next: NextFunction) {
  if (!req.sesion) {
    return next(new ErrorHttp(401, "Se requiere autenticación"));
  }

  if (req.sesion.tipoAcceso !== "ORGANIZACION") {
    return next(new ErrorHttp(403, "Acceso restringido a miembros de la organización"));
  }

  next();
}

export function exigirRolOrganizacion(...rolesPermitidos: RolMiembro[]) {
  return (req: SolicitudAutenticada, _res: Response, next: NextFunction) => {
    if (!req.sesion) {
      return next(new ErrorHttp(401, "Se requiere autenticación"));
    }

    if (req.sesion.tipoAcceso !== "ORGANIZACION") {
      return next(new ErrorHttp(403, "Acceso restringido a miembros de la organización"));
    }

    if (!rolesPermitidos.includes(req.sesion.rolOrganizacion)) {
      return next(new ErrorHttp(403, "No tienes permisos suficientes para realizar esta acción"));
    }

    next();
  };
}

export function exigirCliente(req: SolicitudAutenticada, _res: Response, next: NextFunction) {
  if (!req.sesion) {
    return next(new ErrorHttp(401, "Se requiere autenticación"));
  }

  if (req.sesion.tipoAcceso !== "CLIENTE") {
    return next(new ErrorHttp(403, "Acceso restringido a cuentas de cliente"));
  }

  next();
}

export function exigirSuperadmin(req: SolicitudAutenticada, _res: Response, next: NextFunction) {
  const sesionAdmin =
    req.sesionAdmin ?? (req.sesion as unknown as ContextoSesionAdmin | undefined);

  if (!sesionAdmin) {
    return next(new ErrorHttp(401, "Se requiere autenticación"));
  }

  if (
    sesionAdmin.tipoAcceso !== "ADMIN_GLOBAL" ||
    sesionAdmin.rolPlataforma !== "ADMIN_GLOBAL" ||
    sesionAdmin.mfaVerificado !== true
  ) {
    return next(new ErrorHttp(403, "Acceso restringido a superadministradores globales"));
  }

  next();
}
