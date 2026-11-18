import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { ErrorHttp } from "../utilidades/errores.js";

export const TIPOS_MIME_PERMITIDOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/avif",
] as const;

export type TipoMimeFoto = (typeof TIPOS_MIME_PERMITIDOS)[number];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function obtenerDirectorioAlmacenamiento(): string {
  const dirConfigurado = process.env.ALMACENAMIENTO_FOTOS_DIR || "./almacenamiento_privado/fotos";
  const dirAbsoluto = path.resolve(process.cwd(), dirConfigurado);
  if (!fs.existsSync(dirAbsoluto)) {
    fs.mkdirSync(dirAbsoluto, { recursive: true });
  }
  return dirAbsoluto;
}

export function obtenerMaxBytes(): number {
  const configurado = Number(process.env.ALMACENAMIENTO_MAX_BYTES);
  if (!Number.isFinite(configurado) || configurado <= 0) {
    return 50 * 1024 * 1024; // 50 MB por defecto
  }
  return configurado;
}

export function detectarMimeReal(buffer: Buffer): TipoMimeFoto | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    (buffer.length >= 6 && buffer.toString("ascii", 0, 6) === "GIF87a") ||
    buffer.toString("ascii", 0, 6) === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return "image/tiff";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 4, 8) === "ftyp" &&
    (buffer.toString("ascii", 8, 12) === "avif" || buffer.toString("ascii", 8, 12) === "avis")
  ) {
    return "image/avif";
  }
  return null;
}

export function validarClaveAlmacenamiento(clave: string): void {
  if (!clave || !UUID_REGEX.test(clave)) {
    throw new ErrorHttp(400, "Identificador de almacenamiento inválido");
  }
}

export function resolverRutaSegura(almacenamientoKey: string): string {
  validarClaveAlmacenamiento(almacenamientoKey);
  const dirBase = obtenerDirectorioAlmacenamiento();
  const ruta = path.resolve(dirBase, `${almacenamientoKey}.bin`);
  if (!ruta.startsWith(dirBase) || path.basename(ruta) !== `${almacenamientoKey}.bin`) {
    throw new ErrorHttp(400, "Intento de path traversal detectado");
  }
  return ruta;
}

export async function guardarArchivoFoto(
  streamEntrada: Readable | AsyncIterable<Uint8Array>,
  nombreOriginal: string
): Promise<{
  almacenamientoKey: string;
  tipoMime: TipoMimeFoto;
  tamanoBytes: number;
}> {
  const dirBase = obtenerDirectorioAlmacenamiento();
  const almacenamientoKey = randomUUID();
  const rutaTemporal = path.join(dirBase, `temp_${almacenamientoKey}.tmp`);
  const rutaDefinitiva = path.join(dirBase, `${almacenamientoKey}.bin`);
  const maxBytes = obtenerMaxBytes();

  let tamanoBytes = 0;
  const trozosCabecera: Buffer[] = [];
  let cabeceraLongitud = 0;

  const streamEscritura = fs.createWriteStream(rutaTemporal);

  try {
    const readable =
      streamEntrada instanceof Readable
        ? streamEntrada
        : Readable.from(streamEntrada);

    for await (const chunk of readable) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      tamanoBytes += buf.length;
      if (tamanoBytes > maxBytes) {
        throw new ErrorHttp(413, `El archivo excede el tamaño máximo permitido de ${maxBytes} bytes`);
      }
      if (cabeceraLongitud < 32) {
        trozosCabecera.push(buf);
        cabeceraLongitud += buf.length;
      }
      if (!streamEscritura.write(buf)) {
        await new Promise<void>((resolve) => streamEscritura.once("drain", () => resolve()));
      }
    }

    await new Promise<void>((resolve, reject) => {
      streamEscritura.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (tamanoBytes === 0) {
      throw new ErrorHttp(400, "El archivo proporcionado está vacío");
    }

    const cabecera = Buffer.concat(trozosCabecera);
    const tipoMimeReal = detectarMimeReal(cabecera);
    if (!tipoMimeReal) {
      throw new ErrorHttp(
        415,
        "Formato de archivo no soportado o firma mágica no reconocida como imagen válida (permitidos: JPEG, PNG, WEBP, GIF, TIFF, AVIF)"
      );
    }

    await fs.promises.rename(rutaTemporal, rutaDefinitiva);

    return {
      almacenamientoKey,
      tipoMime: tipoMimeReal,
      tamanoBytes,
    };
  } catch (error) {
    try {
      streamEscritura.destroy();
      if (fs.existsSync(rutaTemporal)) {
        await fs.promises.unlink(rutaTemporal);
      }
    } catch {
      // Ignorar fallo en limpieza secundaria
    }
    throw error;
  }
}

export async function eliminarArchivoFoto(almacenamientoKey: string): Promise<void> {
  const ruta = resolverRutaSegura(almacenamientoKey);
  try {
    if (fs.existsSync(ruta)) {
      await fs.promises.unlink(ruta);
    }
  } catch {
    // Si no existe, no falla
  }
}

export async function existeArchivoFoto(almacenamientoKey: string): Promise<boolean> {
  const ruta = resolverRutaSegura(almacenamientoKey);
  try {
    return fs.existsSync(ruta);
  } catch {
    return false;
  }
}
