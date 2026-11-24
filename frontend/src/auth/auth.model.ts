import { IdiomaSoportado } from '../i18n/i18n.types';

export type TipoFreelance = 'GENERAL' | 'DESARROLLO_SOFTWARE' | 'FOTOGRAFIA' | 'DISENO_GRAFICO';

export type RolPlataforma = 'USUARIO' | 'ADMIN_GLOBAL';

export interface UsuarioSesion {
  id: string;
  correo: string;
  nombre: string;
  apellido?: string | null;
  idioma?: IdiomaSoportado;
  rolPlataforma?: RolPlataforma;
  mfaHabilitado?: boolean;
}

export type SesionContexto =
  | { tipoAcceso: 'ORGANIZACION'; sesionId?: string; usuarioId?: string; organizacionId: string; rolOrganizacion: 'PROPIETARIO' | 'COLABORADOR' }
  | { tipoAcceso: 'CLIENTE'; sesionId?: string; usuarioId?: string; organizacionId: string; clienteId: string; rolCliente: 'TITULAR' | 'COLABORADOR' }
  | { tipoAcceso: 'ADMIN_GLOBAL'; sesionId?: string; usuarioId?: string; rolPlataforma: 'ADMIN_GLOBAL'; mfaVerificado?: boolean };

export type SeleccionContexto =
  | { tipoAcceso: 'ORGANIZACION'; organizacionId: string }
  | { tipoAcceso: 'CLIENTE'; organizacionId: string; clienteId: string }
  | { tipoAcceso: 'ADMIN_GLOBAL' };

export interface OpcionContexto {
  tipoAcceso: 'ORGANIZACION' | 'CLIENTE';
  organizacionId: string;
  clienteId?: string;
  rol: string;
  organizacion: { id: string; nombre: string; slug: string; tipoFreelance?: TipoFreelance };
  cliente?: { id: string; nombre: string; empresa: string };
}

export interface ConflictoContextos {
  error: string;
  contextos: { organizaciones: OpcionContexto[]; clientes: OpcionContexto[]; adminGlobal?: boolean };
}

export interface RespuestaInicio {
  token?: string;
  mfaRequerido?: boolean;
  estadoMfa?: 'CONFIGURAR' | 'VERIFICAR';
  tokenDesafioMfa?: string;
  contexto: SesionContexto;
  usuario: UsuarioSesion;
}

export interface RespuestaInicioConfiguracionMfa {
  secretoBase32: string;
  otpauthUrl: string;
  emisor: string;
  cuenta: string;
}

export interface RespuestaVerificacionMfa {
  token: string;
  contexto: Extract<SesionContexto, { tipoAcceso: 'ADMIN_GLOBAL' }>;
  usuario: UsuarioSesion;
  codigosRecuperacion?: string[];
}

export interface RespuestaRegistro {
  token: string;
  usuario: UsuarioSesion;
  organizacion: { id: string; nombre: string; slug: string; tipoFreelance?: TipoFreelance };
}
