export interface UsuarioSesion {
  id: string;
  correo: string;
  nombre: string;
  apellido?: string | null;
}

export type SesionContexto =
  | { tipoAcceso: 'ORGANIZACION'; sesionId?: string; usuarioId?: string; organizacionId: string; rolOrganizacion: 'PROPIETARIO' | 'COLABORADOR' }
  | { tipoAcceso: 'CLIENTE'; sesionId?: string; usuarioId?: string; organizacionId: string; clienteId: string; rolCliente: 'TITULAR' | 'COLABORADOR' };

export type SeleccionContexto =
  | { tipoAcceso: 'ORGANIZACION'; organizacionId: string }
  | { tipoAcceso: 'CLIENTE'; organizacionId: string; clienteId: string };

export interface OpcionContexto {
  tipoAcceso: 'ORGANIZACION' | 'CLIENTE';
  organizacionId: string;
  clienteId?: string;
  rol: string;
  organizacion: { id: string; nombre: string; slug: string };
  cliente?: { id: string; nombre: string; empresa: string };
}

export interface ConflictoContextos {
  error: string;
  contextos: { organizaciones: OpcionContexto[]; clientes: OpcionContexto[] };
}

export interface RespuestaInicio {
  token: string;
  contexto: SesionContexto;
  usuario: UsuarioSesion;
}

export interface RespuestaRegistro {
  token: string;
  usuario: UsuarioSesion;
  organizacion: { id: string; nombre: string; slug: string };
}
