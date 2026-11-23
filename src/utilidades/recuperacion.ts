import { createHash, randomBytes } from "crypto";
import { hooksPruebas } from "./hooks-pruebas.js";

export const EXPIRACION_RECUPERACION_MINUTOS = 30;

/**
 * Genera un token aleatorio criptográficamente seguro de 256 bits codificado en URL-safe base64.
 */
export function generarTokenRecuperacion(): string {
  const tokenPrueba = hooksPruebas.obtenerSiguienteToken();
  if (tokenPrueba) {
    return tokenPrueba;
  }
  return randomBytes(32).toString("base64url");
}

/**
 * Calcula el hash SHA-256 del token para persistencia segura en base de datos.
 */
export function hashTokenRecuperacion(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Calcula la fecha de expiración fija a 30 minutos a partir de la fecha actual o inyectada.
 */
export function calcularFechaExpiracionRecuperacion(ahora = hooksPruebas.obtenerAhora()): Date {
  return new Date(ahora.getTime() + EXPIRACION_RECUPERACION_MINUTOS * 60 * 1000);
}

/**
 * Construye el enlace de restablecimiento seguro usando URL_BASE.
 */
export function construirEnlaceRecuperacion(token: string): string {
  const urlBase = (process.env.URL_BASE || "http://localhost:4200").replace(/\/+$/, "");
  return `${urlBase}/recuperar-contrasena?token=${encodeURIComponent(token)}`;
}
