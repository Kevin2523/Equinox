import type { Request } from "express";

export type RolMiembro = "PROPIETARIO" | "COLABORADOR";
export type RolCliente = "TITULAR" | "COLABORADOR";

export type ContextoSinSesion =
  | {
      tipoAcceso: "ORGANIZACION";
      usuarioId: string;
      organizacionId: string;
      rolOrganizacion: RolMiembro;
    }
  | {
      tipoAcceso: "CLIENTE";
      usuarioId: string;
      organizacionId: string;
      clienteId: string;
      rolCliente: RolCliente;
    };

export type ContextoSesion = ContextoSinSesion & { sesionId: string };

export type DatosJWT = ContextoSesion;

export interface SolicitudAutenticada extends Request {
  sesion?: DatosJWT;
}
