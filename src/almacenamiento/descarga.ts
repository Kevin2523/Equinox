import type { Response } from "express";
import { almacenArchivos, claveDeArchivo } from "./archivos.js";

export async function enviarArchivo(res: Response, archivo: { url: string; nombreOriginal: string; tipoMime: string }): Promise<void> {
  const bytes = await almacenArchivos.leer(claveDeArchivo(archivo.url));
  const nombre = encodeURIComponent(archivo.nombreOriginal.replace(/[\r\n]/g, ""));
  res.setHeader("Content-Type", archivo.tipoMime);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${nombre}`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
}
