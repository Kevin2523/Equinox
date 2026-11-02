import { randomUUID } from "node:crypto";
import { mkdir, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";
import { ErrorHttp } from "../utilidades/errores.js";

const MAX_ARCHIVO = 8 * 1024 * 1024;
const MAX_MULTIPART = MAX_ARCHIVO + 64 * 1024;
const tipos: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".txt": "text/plain",
};
const patronClave = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|png|jpg|jpeg|webp|gif|txt)$/;

export function claveLocalValida(clave: string): boolean { return patronClave.test(clave); }

export function detectarArchivo(nombre: string, declarado: string, bytes: Buffer): { extension: string; mime: string } {
  if (nombre.includes("/") || nombre.includes("\\") || nombre.includes("\0") || nombre.length > 180) throw new ErrorHttp(422, "Nombre de archivo inválido");
  const extension = path.extname(nombre).toLowerCase();
  const mime = tipos[extension];
  if (!mime || !bytes.length || bytes.length > MAX_ARCHIVO) throw new ErrorHttp(422, "Tipo o tamaño de archivo no permitido (máximo 8 MB)");
  const texto = bytes.toString("latin1");
  const valido = mime === "application/pdf" ? texto.startsWith("%PDF-") && texto.includes("%%EOF")
    : mime === "image/png" ? bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.subarray(-8, -4).toString("ascii") === "IEND"
    : mime === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) && bytes.subarray(-2).equals(Buffer.from("ffd9", "hex"))
    : mime === "image/webp" ? bytes.length >= 20 && texto.startsWith("RIFF") && texto.slice(8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length
    : mime === "image/gif" ? bytes.length >= 14 && (texto.startsWith("GIF87a") || texto.startsWith("GIF89a")) && bytes.at(-1) === 0x3b
    : textoValido(bytes);
  if (!valido || (declarado && declarado !== "application/octet-stream" && declarado !== mime)) throw new ErrorHttp(422, "El contenido no coincide con la extensión y el tipo declarado");
  return { extension, mime };
}

function textoValido(bytes: Buffer): boolean {
  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(texto);
  } catch { return false; }
}

export async function recibirMultipart(req: Request): Promise<{ archivo: { nombre: string; mime: string; bytes: Buffer }; campos: Record<string, string> }> {
  const contentType = req.header("Content-Type") || "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new ErrorHttp(415, "Se requiere formulario multipart");
  if (Number(req.header("Content-Length") || 0) > MAX_MULTIPART) throw new ErrorHttp(413, "Archivo demasiado grande");
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    const bloque = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    total += bloque.length;
    if (total > MAX_MULTIPART) throw new ErrorHttp(413, "Archivo demasiado grande");
    partes.push(bloque);
  }
  let formulario: FormData;
  try { formulario = await new Request("http://localhost/", { method: "POST", headers: { "Content-Type": contentType }, body: Buffer.concat(partes) }).formData(); }
  catch { throw new ErrorHttp(422, "Formulario multipart inválido"); }
  const archivos = formulario.getAll("archivo");
  if (archivos.length !== 1 || typeof archivos[0] === "string") throw new ErrorHttp(422, "Selecciona un archivo");
  const entrada = archivos[0];
  const campos: Record<string, string> = {};
  for (const [clave, valor] of formulario.entries()) {
    if (clave === "archivo") continue;
    if (typeof valor !== "string" || !(clave in { nombre: 1, descripcion: 1, tipo: 1, visibilidad: 1 })) throw new ErrorHttp(422, "Campo de archivo inválido");
    campos[clave] = valor;
  }
  const bytes = Buffer.from(await entrada.arrayBuffer());
  return { archivo: { nombre: entrada.name, mime: entrada.type, bytes }, campos };
}

export interface AlmacenArchivos {
  guardar(bytes: Buffer, extension: string): Promise<string>;
  leer(clave: string): Promise<Buffer>;
  eliminar(clave: string): Promise<void>;
  apartar(clave: string): Promise<{ confirmar(): Promise<void>; restaurar(): Promise<void> }>;
}

export class AlmacenLocal implements AlmacenArchivos {
  private raiz = path.resolve(process.env.EQUINOX_ARCHIVOS_DIR || ".archivos-desarrollo");
  private async asegurarRaiz(): Promise<void> {
    if ([process.env.ENTORNO, process.env.NODE_ENV].some((valor) => /^(produccion|production)$/i.test(valor || ""))) throw new ErrorHttp(503, "Almacenamiento de producción no configurado");
    await mkdir(this.raiz, { recursive: true, mode: 0o700 });
    if ((await lstat(this.raiz)).isSymbolicLink()) throw new ErrorHttp(503, "Directorio de archivos inválido");
  }
  private ruta(clave: string): string {
    if (!claveLocalValida(clave)) throw new ErrorHttp(404, "Archivo no disponible");
    return path.join(this.raiz, clave);
  }
  async guardar(bytes: Buffer, extension: string): Promise<string> {
    await this.asegurarRaiz();
    if (!(extension in tipos)) throw new ErrorHttp(422, "Extensión no permitida");
    const clave = `${randomUUID()}${extension}`;
    await writeFile(this.ruta(clave), bytes, { flag: "wx", mode: 0o600 });
    return clave;
  }
  async leer(clave: string): Promise<Buffer> {
    await this.asegurarRaiz();
    const ruta = this.ruta(clave);
    if (!(await lstat(ruta)).isFile()) throw new ErrorHttp(404, "Archivo no disponible");
    return readFile(ruta);
  }
  async eliminar(clave: string): Promise<void> { await this.asegurarRaiz(); await unlink(this.ruta(clave)); }
  async apartar(clave: string): Promise<{ confirmar(): Promise<void>; restaurar(): Promise<void> }> {
    await this.asegurarRaiz();
    const origen = this.ruta(clave);
    if (!(await lstat(origen)).isFile()) throw new ErrorHttp(404, "Archivo no disponible");
    const temporal = path.join(this.raiz, `.${randomUUID()}.borrando`);
    await rename(origen, temporal);
    return { confirmar: () => unlink(temporal), restaurar: () => rename(temporal, origen) };
  }
}

export const almacenArchivos: AlmacenArchivos = new AlmacenLocal();
export function claveDeArchivo(url: string): string {
  const clave = url.startsWith("local:") ? url.slice(6) : "";
  if (!claveLocalValida(clave)) throw new ErrorHttp(410, "Archivo anterior no disponible para descarga segura");
  return clave;
}
