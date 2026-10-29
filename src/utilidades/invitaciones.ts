import { createHash, randomBytes } from "crypto";
import { hooksPruebas } from "./hooks-pruebas.js";

export function generarTokenInvitacion(): string {
  const tokenPrueba = hooksPruebas.obtenerSiguienteToken();
  if (tokenPrueba) {
    return tokenPrueba;
  }
  return randomBytes(32).toString("base64url");
}

export function hashTokenInvitacion(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const VENCIMIENTO_HORAS_PREDETERMINADO = 168; // 7 días
export const VENCIMIENTO_HORAS_MINIMO = 1;
export const VENCIMIENTO_HORAS_MAXIMO = 720; // 30 días

export function parsearVencimientoInvitacionHoras(valor?: string | null): number {
  if (valor === undefined || valor === null || valor.trim() === "") {
    return VENCIMIENTO_HORAS_PREDETERMINADO;
  }
  const valorLimpio = valor.trim();
  if (!/^\d+$/.test(valorLimpio)) {
    throw new Error(
      `[SEGURIDAD] Valor inválido para VENCIMIENTO_INVITACION_HORAS: '${valor}'. Solo se aceptan enteros entre ${VENCIMIENTO_HORAS_MINIMO} y ${VENCIMIENTO_HORAS_MAXIMO}.`
    );
  }
  const horas = Number(valorLimpio);
  if (horas < VENCIMIENTO_HORAS_MINIMO || horas > VENCIMIENTO_HORAS_MAXIMO) {
    throw new Error(
      `[SEGURIDAD] VENCIMIENTO_INVITACION_HORAS fuera de rango permitido (${VENCIMIENTO_HORAS_MINIMO} a ${VENCIMIENTO_HORAS_MAXIMO}): ${horas}`
    );
  }
  return horas;
}

export function obtenerHorasExpiracion(): number {
  return parsearVencimientoInvitacionHoras(process.env.VENCIMIENTO_INVITACION_HORAS);
}

export function calcularFechaExpiracion(ahora = hooksPruebas.obtenerAhora()): Date {
  const horas = obtenerHorasExpiracion();
  return new Date(ahora.getTime() + horas * 60 * 60 * 1000);
}

export interface AdaptadorEntregaInvitacion {
  entregar(datos: {
    correo: string;
    token: string;
    nombreOrganizacion: string;
    nombreCliente: string;
  }): { enlaceInvitacion?: string };
}

export class AdaptadorLocalInvitaciones implements AdaptadorEntregaInvitacion {
  entregar(datos: {
    correo: string;
    token: string;
    nombreOrganizacion: string;
    nombreCliente: string;
  }): { enlaceInvitacion?: string } {
    // Sin proveedor de correo configurado: entrega única al miembro autorizado,
    // exclusivamente en la respuesta de creación/reenvío después del commit.
    // Nunca persistir esta URL ni reutilizar este adaptador en consultas o logs.
    const urlBase = process.env.URL_BASE || "http://localhost:4200";
    const enlaceInvitacion = `${urlBase}/invitacion/${datos.token}`;
    return { enlaceInvitacion };
  }
}

export const adaptadorInvitaciones = new AdaptadorLocalInvitaciones();
