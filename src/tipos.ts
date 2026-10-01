import type { Request } from "express";

export interface DatosJWT { usuarioId: string; organizacionId: string; }
export interface SolicitudAutenticada extends Request { sesion?: DatosJWT; }
