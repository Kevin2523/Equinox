import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { obtenerSecretoJwt } from "../middleware/autenticacion.js";

const ALFABETO_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIODO_TOTP_SEG = 30;
const DIGITOS_TOTP = 6;

export function generarSecretoBase32(bytes = 20): string {
  const buf = randomBytes(bytes);
  return codificarBase32(buf);
}

export function codificarBase32(buffer: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = "";

  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  }

  return salida;
}

export function decodificarBase32(entrada: string): Buffer {
  const limpio = entrada.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];

  for (const char of limpio) {
    const idx = ALFABETO_BASE32.indexOf(char);
    if (idx === -1) {
      throw new Error("Secreto Base32 inválido");
    }
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function calcularPasoTotp(fecha: Date = new Date()): number {
  return Math.floor(fecha.getTime() / 1000 / PERIODO_TOTP_SEG);
}

export function generarCodigoTotpParaPaso(secretoBase32: string, paso: number): string {
  const clave = decodificarBase32(secretoBase32);
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));

  const hmac = createHmac("sha1", clave).update(contador).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binCode % 10 ** DIGITOS_TOTP;
  return String(otp).padStart(DIGITOS_TOTP, "0");
}

/**
 * Verifica un código TOTP de 6 dígitos en una ventana [-ventana, +ventana] pasos.
 * Si `ultimoPasoUsado` está definido, rechaza cualquier paso <= `ultimoPasoUsado`
 * para prevenir ataques de replay dentro de la misma ventana.
 */
export function verificarCodigoTotp(
  secretoBase32: string,
  codigoIngresado: string,
  options?: {
    fecha?: Date;
    ventana?: number;
    ultimoPasoUsado?: bigint | number | null;
  }
): { valido: boolean; pasoUsado?: number } {
  const codigoLimpio = codigoIngresado.trim();
  if (!/^\d{6}$/.test(codigoLimpio)) {
    return { valido: false };
  }

  const pasoActual = calcularPasoTotp(options?.fecha ?? new Date());
  const ventana = options?.ventana ?? 1;
  const ultimoPaso =
    options?.ultimoPasoUsado !== undefined && options?.ultimoPasoUsado !== null
      ? Number(options.ultimoPasoUsado)
      : null;

  const bufIngresado = Buffer.from(codigoLimpio, "utf8");

  for (let delta = -ventana; delta <= ventana; delta++) {
    const paso = pasoActual + delta;
    if (paso < 0) continue;
    if (ultimoPaso !== null && paso <= ultimoPaso) {
      continue;
    }
    const esperado = generarCodigoTotpParaPaso(secretoBase32, paso);
    const bufEsperado = Buffer.from(esperado, "utf8");
    if (bufEsperado.length === bufIngresado.length && timingSafeEqual(bufEsperado, bufIngresado)) {
      return { valido: true, pasoUsado: paso };
    }
  }

  return { valido: false };
}

export function construirOtpauthUrl(correo: string, secretoBase32: string, emisor = "Equinox"): string {
  const etiqueta = encodeURIComponent(`${emisor}:${correo}`);
  const params = new URLSearchParams({
    secret: secretoBase32,
    issuer: emisor,
    algorithm: "SHA1",
    digits: String(DIGITOS_TOTP),
    period: String(PERIODO_TOTP_SEG),
  });
  return `otpauth://totp/${etiqueta}?${params.toString()}`;
}

function derivarClaveCifradoMfa(): Buffer {
  const secretoBase = (process.env.SECRETO_MFA || "").trim() || obtenerSecretoJwt();
  return createHash("sha256").update(`equinox-mfa-v1:${secretoBase}`).digest();
}

export function cifrarSecretoMfa(secretoBase32: string): string {
  const clave = derivarClaveCifradoMfa();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", clave, iv);
  const cifrado = Buffer.concat([cipher.update(secretoBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${cifrado.toString("base64url")}`;
}

export function descifrarSecretoMfa(carga: string): string {
  const partes = carga.split(".");
  if (partes.length !== 3) {
    throw new Error("Formato de secreto MFA cifrado inválido");
  }
  const [ivB64, tagB64, datosB64] = partes;
  const clave = derivarClaveCifradoMfa();
  const decipher = createDecipheriv("aes-256-gcm", clave, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const plano = Buffer.concat([
    decipher.update(Buffer.from(datosB64, "base64url")),
    decipher.final(),
  ]);
  return plano.toString("utf8");
}

export function generarCodigosRecuperacionMfa(cantidad = 8): string[] {
  const codigos: string[] = [];
  for (let i = 0; i < cantidad; i++) {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    codigos.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codigos;
}

export function normalizarCodigoRecuperacionMfa(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashCodigoRecuperacionMfa(codigo: string): string {
  const normalizado = normalizarCodigoRecuperacionMfa(codigo);
  return createHash("sha256").update(`equinox-mfa-recovery:${normalizado}`).digest("hex");
}

export function generarTokenRecuperacionMfa(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTokenRecuperacionMfa(tokenPlano: string): string {
  return createHash("sha256").update(tokenPlano).digest("hex");
}

export function construirEnlaceRecuperacionMfa(tokenPlano: string): string {
  const baseUrl = (process.env.URL_BASE || "http://localhost:4200").replace(/\/+$/, "");
  return `${baseUrl}/recuperar-mfa?token=${encodeURIComponent(tokenPlano)}`;
}
