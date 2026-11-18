import { RolPlataforma, TipoFreelance } from '../auth/auth.model';

export type EstadoSuscripcion =
  | 'SIN_SUSCRIPCION'
  | 'PRUEBA'
  | 'ACTIVA'
  | 'SUSPENDIDA'
  | 'CANCELADA';

export interface PaginacionAdmin {
  pagina: number;
  limite: number;
  total: number;
  totalPaginas: number;
}

export interface RespuestaPaginadaAdmin<T> {
  datos: T[];
  paginacion: PaginacionAdmin;
}

export interface ResumenAdmin {
  organizaciones: {
    total: number;
    activas?: number;
    suspendidas?: number;
    porTipoFreelance: Record<TipoFreelance, number>;
    porEstadoSuscripcion: Record<EstadoSuscripcion, number>;
  };
  usuarios: {
    total: number;
    verificados: number;
    conAccesoOrganizacion: number;
    conAccesoCliente: number;
    adminsGlobales: number;
    sesionesActivas: number;
  };
  operacion: {
    clientes: number;
    proyectos: number;
    facturas: number;
    sesionesFotograficas: number;
    fotos: number;
  };
  auditoria: {
    eventosTotales: number;
    eventosUltimas24h: number;
  };
  actividadReciente: EventoAuditoriaAdmin[];
}

export interface PlanResumenAdmin {
  id: string;
  codigo: string;
  nombre: string;
  esPlanPrueba?: boolean;
}

export interface PlanSuscripcionAdmin {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  activo: boolean;
  esPlanPrueba: boolean;
  duracionSugeridaDias?: number | null;
  caracteristicas?: Record<string, unknown> | null;
  orden: number;
  modalidadGestion: 'MANUAL_SIN_COBRO';
  etiquetaCobro: string;
  creadoEn: string;
  actualizadoEn: string;
}

export interface SuscripcionAdmin {
  id: string | null;
  estado: EstadoSuscripcion;
  plan: PlanResumenAdmin | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  asignadoEn?: string | null;
  asignadoPor?: { id: string; nombre: string; correo: string } | null;
  referenciaManual?: string | null;
  motivo?: string | null;
  notasInternas?: string | null;
  canceladaEn?: string | null;
  motivoCancelacion?: string | null;
  modalidadGestion: 'MANUAL_SIN_COBRO';
  etiquetaCobro?: string;
}

export interface OrganizacionAdminConteos {
  miembros: number;
  clientes: number;
  proyectos: number;
  facturas: number;
  sesionesFotograficas: number;
  fotos?: number;
}

export interface OrganizacionesResumenConteo {
  total: number;
  activas: number;
  suspendidas: number;
}

export interface RespuestaOrganizacionesAdmin extends RespuestaPaginadaAdmin<OrganizacionAdminItem> {
  resumen?: OrganizacionesResumenConteo;
}

export interface OrganizacionAdminItem {
  id: string;
  nombre: string;
  slug: string;
  correoContacto?: string | null;
  ruc?: string | null;
  moneda: string;
  tipoFreelance: TipoFreelance;
  portalMostrarFinanzas: boolean;
  suspendida?: boolean;
  suspendidaEn?: string | null;
  motivoSuspension?: string | null;
  creadoEn: string;
  actualizadoEn: string;
  conteos: OrganizacionAdminConteos;
  propietarios: Array<{
    id: string;
    nombre: string;
    apellido?: string | null;
    correo: string;
  }>;
  suscripcion: SuscripcionAdmin;
}

export interface OrganizacionMiembroAdmin {
  id: string;
  usuarioId: string;
  rol: 'PROPIETARIO' | 'COLABORADOR';
  creadoEn: string;
  usuario: {
    id: string;
    nombre: string;
    apellido?: string | null;
    correo: string;
    rolPlataforma: RolPlataforma;
    ultimoAccesoEn?: string | null;
  };
}

export interface OrganizacionAdminDetalle {
  id: string;
  nombre: string;
  slug: string;
  descripcion?: string | null;
  moneda: string;
  ruc?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  correoContacto?: string | null;
  tipoFreelance: TipoFreelance;
  portalMostrarFinanzas: boolean;
  dominioPortal?: string | null;
  suspendida?: boolean;
  suspendidaEn?: string | null;
  motivoSuspension?: string | null;
  creadoEn: string;
  actualizadoEn: string;
  conteos: OrganizacionAdminConteos;
  miembros: OrganizacionMiembroAdmin[];
  suscripcion: SuscripcionAdmin;
  auditoriaReciente: EventoAuditoriaAdmin[];
}

export interface ActualizarOrganizacionAdminPayload {
  nombre?: string;
  correoContacto?: string | null;
  ruc?: string | null;
  moneda?: string;
  tipoFreelance?: TipoFreelance;
  portalMostrarFinanzas?: boolean;
  motivo?: string;
}

export interface MembresiaUsuarioAdmin {
  id: string;
  organizacionId: string;
  organizacionNombre: string;
  organizacionSlug: string;
  rol: 'PROPIETARIO' | 'COLABORADOR';
}

export interface AccesoClienteAdmin {
  id: string;
  usuarioId?: string;
  organizacionId: string;
  organizacionNombre?: string;
  clienteId: string;
  clienteNombre?: string;
  rol: 'TITULAR' | 'COLABORADOR';
  activo: boolean;
  actualizadoEn?: string;
}

export interface SesionActivaAdmin {
  id: string;
  tipoAcceso: 'ORGANIZACION' | 'CLIENTE' | 'ADMIN_GLOBAL';
  mfaVerificado: boolean;
  creadoEn: string;
  expiraEn: string;
}

export interface UsuarioAdminItem {
  id: string;
  correo: string;
  nombre: string;
  apellido?: string | null;
  telefono?: string | null;
  rolPlataforma: RolPlataforma;
  correoVerificadoEn?: string | null;
  ultimoAccesoEn?: string | null;
  creadoEn: string;
  sesionesActivasCount: number;
  membresias: MembresiaUsuarioAdmin[];
  accesosCliente: AccesoClienteAdmin[];
}

export interface UsuarioAdminDetalle extends UsuarioAdminItem {
  sesionesActivas: SesionActivaAdmin[];
  auditoriaReciente: EventoAuditoriaAdmin[];
}

export interface OrganizacionSuscripcionItem {
  organizacion: {
    id: string;
    nombre: string;
    slug: string;
    correoContacto?: string | null;
    tipoFreelance: TipoFreelance;
  };
  suscripcion: SuscripcionAdmin;
}

export interface RespuestaSuscripcionesAdmin extends RespuestaPaginadaAdmin<OrganizacionSuscripcionItem> {
  resumenEstados: Record<EstadoSuscripcion, number>;
  modalidadGestion: 'MANUAL_SIN_COBRO';
  etiquetaCobro: string;
}

export interface RespuestaPlanesAdmin extends RespuestaPaginadaAdmin<PlanSuscripcionAdmin> {
  modalidadGestion: 'MANUAL_SIN_COBRO';
  etiquetaCobro: string;
}

export interface HistorialSuscripcionItem {
  id: string;
  accion: string;
  estadoAnterior: EstadoSuscripcion;
  estadoNuevo: EstadoSuscripcion;
  planAnterior?: PlanResumenAdmin | null;
  planNuevo?: PlanResumenAdmin | null;
  fechaInicioAnterior?: string | null;
  fechaInicioNueva?: string | null;
  fechaFinAnterior?: string | null;
  fechaFinNueva?: string | null;
  motivo?: string | null;
  notas?: string | null;
  realizadoPor?: { id: string; nombre: string; correo: string } | null;
  realizadoPorCorreo?: string | null;
  modalidadGestion: 'MANUAL_SIN_COBRO';
  etiquetaCobro: string;
  creadoEn: string;
}

export interface EventoAuditoriaAdmin {
  id: string;
  actorUsuarioId?: string | null;
  actorCorreo?: string | null;
  actorNombre?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  resultado?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadatos?: Record<string, unknown> | null;
  creadoEn: string;
}
