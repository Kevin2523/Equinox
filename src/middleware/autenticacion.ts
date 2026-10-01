import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma.js";
import type { DatosJWT, SolicitudAutenticada } from "../tipos.js";
import { ErrorHttp } from "../utilidades/errores.js";

const secreto = () => process.env.SECRETO_JWT || "desarrollo-no-usar-en-produccion";

export function crearToken(datos: DatosJWT) {
  return jwt.sign(datos, secreto(), { expiresIn: (process.env.VENCIMIENTO_JWT || "7d") as jwt.SignOptions["expiresIn"] });
}

export function exigirAutenticacion(req: SolicitudAutenticada, _res: Response, next: NextFunction) {
  const encabezado = req.header("Authorization");
  if (!encabezado?.startsWith("Bearer ")) return next(new ErrorHttp(401, "Se requiere autenticación"));
  try { req.sesion = jwt.verify(encabezado.slice(7), secreto()) as DatosJWT; next(); }
  catch { next(new ErrorHttp(401, "Token inválido o vencido")); }
}

export async function exigirOrganizacion(req: SolicitudAutenticada, _res: Response, next: NextFunction) {
  if (!req.sesion) return next(new ErrorHttp(401, "Se requiere autenticación"));
  const miembro = await prisma.miembroOrganizacion.findUnique({ where: { usuarioId_organizacionId: { usuarioId: req.sesion.usuarioId, organizacionId: req.sesion.organizacionId } } });
  if (!miembro) return next(new ErrorHttp(403, "No perteneces a esta organización"));
  next();
}
