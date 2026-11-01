export type RolInvitacion = 'TITULAR' | 'COLABORADOR';
export type EstadoInvitacion = 'PENDIENTE' | 'ACEPTADA' | 'EXPIRADA' | 'REVOCADA';

export interface ActorInvitacion {
  id: string;
  nombre: string;
  apellido: string | null;
  correo: string;
}

export interface InvitacionCliente {
  id: string;
  correo: string;
  rol: RolInvitacion;
  estado: EstadoInvitacion;
  expiraEn: string;
  aceptadaEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
  invitadoPor: ActorInvitacion;
  aceptadaPor: ActorInvitacion | null;
}

export interface InvitacionEmitida {
  id: string;
  clienteId: string;
  organizacionId: string;
  correo: string;
  rol: RolInvitacion;
  estado: EstadoInvitacion;
  expiraEn: string;
  creadoEn: string;
  actualizadoEn?: string;
}

export interface RespuestaInvitacionEmitida {
  invitacion: InvitacionEmitida;
  enlaceInvitacion?: string;
}

export interface RespuestaRevocacionInvitacion {
  mensaje: string;
  invitacion: { id: string; estado: 'REVOCADA'; actualizadoEn?: string };
}

export interface ConsultaInvitacionPublica {
  correoEnmascarado: string;
  rol: RolInvitacion;
  expiraEn: string;
  cliente: { nombre: string; empresa: string | null };
  organizacion: { nombre: string; logoUrl: string | null };
  esUsuarioExistente: boolean;
}

export interface RespuestaAceptarInvitacion {
  mensaje: string;
  clienteId: string;
  rol: RolInvitacion;
}

export type DatosAceptarInvitacion =
  | { nombre: string; apellido?: string; contrasena: string }
  | { contrasena: string };
