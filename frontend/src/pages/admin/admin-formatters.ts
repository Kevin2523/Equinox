import { RolPlataforma, TipoFreelance } from '../../auth/auth.model';
import { EstadoSuscripcion } from '../../models/admin.model';

export const CLAVES_TIPO_FREELANCE: Record<TipoFreelance, string> = {
  GENERAL: 'admin.comun.tipoFreelance.GENERAL',
  DESARROLLO_SOFTWARE: 'admin.comun.tipoFreelance.DESARROLLO_SOFTWARE',
  FOTOGRAFIA: 'admin.comun.tipoFreelance.FOTOGRAFIA',
  DISENO_GRAFICO: 'admin.comun.tipoFreelance.DISENO_GRAFICO'
};

export const CLAVES_ESTADO_SUSCRIPCION: Record<EstadoSuscripcion, string> = {
  SIN_SUSCRIPCION: 'admin.comun.estadoSuscripcion.SIN_SUSCRIPCION',
  PRUEBA: 'admin.comun.estadoSuscripcion.PRUEBA',
  ACTIVA: 'admin.comun.estadoSuscripcion.ACTIVA',
  SUSPENDIDA: 'admin.comun.estadoSuscripcion.SUSPENDIDA',
  CANCELADA: 'admin.comun.estadoSuscripcion.CANCELADA'
};

export const CLAVES_ROL_PLATAFORMA: Record<RolPlataforma, string> = {
  USUARIO: 'admin.comun.rolPlataforma.USUARIO',
  ADMIN_GLOBAL: 'admin.comun.rolPlataforma.ADMIN_GLOBAL'
};

export function claseEstadoSuscripcion(estado?: EstadoSuscripcion | null): string {
  switch (estado) {
    case 'ACTIVA':
      return 'admin-badge-green';
    case 'PRUEBA':
      return 'admin-badge-blue';
    case 'SUSPENDIDA':
      return 'admin-badge-amber';
    case 'CANCELADA':
      return 'admin-badge-coral';
    default:
      return 'admin-badge-neutral';
  }
}

export function formatearFechaAdmin(valor?: string | null, incluirHora = true, bcp47 = 'es-PA'): string {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return new Intl.DateTimeFormat(bcp47, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(incluirHora ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(fecha);
}

export function formatearNumeroAdmin(valor: number, bcp47 = 'es-PA'): string {
  if (!Number.isFinite(valor)) return '0';
  return new Intl.NumberFormat(bcp47).format(valor);
}
