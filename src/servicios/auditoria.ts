import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../prisma.js";

export type ResultadoAuditoria = "EXITO" | "DENEGADO" | "ERROR";

export interface EntradaAuditoriaAdmin {
  actorUsuarioId?: string | null;
  actorCorreo?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  organizacionId?: string | null;
  resultado?: ResultadoAuditoria;
  ip?: string | null;
  userAgent?: string | null;
  metadatos?: Prisma.InputJsonValue;
}

function sanitizarCadenaLog(valor?: string | null, maxLen = 256): string | null {
  if (!valor) return null;
  const limpia = valor.replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim();
  return limpia ? limpia.slice(0, maxLen) : null;
}

export function extraerContextoRequestAuditoria(req: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const ip = sanitizarCadenaLog(req.ip || req.socket?.remoteAddress || null, 128);
  const ua = sanitizarCadenaLog(
    typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    512
  );
  return { ip, userAgent: ua };
}

/**
 * Registra una acción sensible de plataforma / superadministración en `auditoria_admin`.
 * Si se pasa `tx`, participa de la transacción; si no, captura errores de escritura para
 * no enmascarar respuestas de seguridad (p.ej. 401/403).
 */
export async function registrarAuditoriaAdmin(
  entrada: EntradaAuditoriaAdmin,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const datos = {
    actorUsuarioId: entrada.actorUsuarioId ?? null,
    actorCorreo: sanitizarCadenaLog(entrada.actorCorreo, 254),
    accion: sanitizarCadenaLog(entrada.accion, 120) || "ACCION_DESCONOCIDA",
    entidad: sanitizarCadenaLog(entrada.entidad, 120) || "SISTEMA",
    entidadId: sanitizarCadenaLog(entrada.entidadId, 128),
    organizacionId: entrada.organizacionId ?? null,
    resultado: entrada.resultado ?? "EXITO",
    ip: sanitizarCadenaLog(entrada.ip, 128),
    userAgent: sanitizarCadenaLog(entrada.userAgent, 512),
    metadatos: entrada.metadatos ?? undefined,
  };

  if (tx) {
    await tx.auditoriaAdmin.create({ data: datos });
    return;
  }

  try {
    await prisma.auditoriaAdmin.create({ data: datos });
  } catch (err) {
    console.error("[AUDITORIA_ADMIN] Error al registrar evento de auditoría:", err);
  }
}
