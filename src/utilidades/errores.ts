import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ErrorHttp extends Error {
  constructor(public estado: number, mensaje: string) { super(mensaje); }
}

export function manejarErrores(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(422).json({ error: "Datos inválidos", detalles: error.issues });
  if (error instanceof ErrorHttp) return res.status(error.estado).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: "Ocurrió un error inesperado" });
}
