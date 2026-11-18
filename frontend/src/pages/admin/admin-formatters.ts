import { RolPlataforma, TipoFreelance } from '../../auth/auth.model';
import { EstadoSuscripcion } from '../../models/admin.model';

export const ETIQUETAS_TIPO_FREELANCE: Record<TipoFreelance, string> = {
  GENERAL: 'General',
  DESARROLLO_SOFTWARE: 'Desarrollo de software',
  FOTOGRAFIA: 'Fotografía',
  DISENO_GRAFICO: 'Diseño gráfico'
};

export const ETIQUETAS_ESTADO_SUSCRIPCION: Record<EstadoSuscripcion, string> = {
  SIN_SUSCRIPCION: 'Sin suscripción',
  PRUEBA: 'En prueba',
  ACTIVA: 'Activa',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada'
};

export const ETIQUETAS_ROL_PLATAFORMA: Record<RolPlataforma, string> = {
  USUARIO: 'Usuario',
  ADMIN_GLOBAL: 'Admin global'
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

export function formatearFechaAdmin(valor?: string | null, incluirHora = true): string {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(incluirHora ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(fecha);
}
