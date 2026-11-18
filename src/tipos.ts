import type { Request } from "express";

export type RolMiembro = "PROPIETARIO" | "COLABORADOR";
export type RolCliente = "TITULAR" | "COLABORADOR";
export type RolPlataforma = "USUARIO" | "ADMIN_GLOBAL";

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

export type ContextoSinSesionAdmin = {
  tipoAcceso: "ADMIN_GLOBAL";
  usuarioId: string;
  rolPlataforma: "ADMIN_GLOBAL";
  mfaVerificado: true;
};

export type ContextoSesion = ContextoSinSesion & { sesionId: string };
export type ContextoSesionAdmin = ContextoSinSesionAdmin & { sesionId: string };

export type DatosJWT = ContextoSesion | ContextoSesionAdmin;

export interface SolicitudAutenticada extends Request {
  sesion?: ContextoSesion;
  sesionAdmin?: ContextoSesionAdmin;
}
