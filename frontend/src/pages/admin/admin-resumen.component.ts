import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import { EstadoSuscripcion, EventoAuditoriaAdmin, ResumenAdmin } from '../../models/admin.model';
import { TipoFreelance } from '../../auth/auth.model';
import {
  ETIQUETAS_ESTADO_SUSCRIPCION,
  ETIQUETAS_TIPO_FREELANCE,
  claseEstadoSuscripcion,
  formatearFechaAdmin
} from './admin-formatters';

const ETIQUETAS_ACCION_AUDITORIA: Record<string, string> = {
  ORGANIZACION_ACTUALIZADA: 'Organización actualizada',
  ORGANIZACION_SUSPENDIDA: 'Organización suspendida',
  ORGANIZACION_REACTIVADA: 'Organización reactivada',
  MIEMBRO_ROL_ACTUALIZADO: 'Rol de miembro actualizado',
  SESION_REVOCADA: 'Sesión revocada',
  SESIONES_REVOCADAS: 'Sesiones revocadas',
  ACCESO_CLIENTE_ACTUALIZADO: 'Acceso de cliente actualizado',
  PLAN_SUSCRIPCION_CREADO: 'Plan de suscripción creado',
  PLAN_SUSCRIPCION_ACTUALIZADO: 'Plan de suscripción actualizado',
  SUSCRIPCION_MANUAL_ASIGNADA: 'Suscripción manual asignada',
  SUSCRIPCION_MANUAL_ACTUALIZADA: 'Suscripción manual actualizada',
  SUSCRIPCION_MANUAL_CANCELADA: 'Suscripción manual cancelada',
  ADMIN_DESAFIO_MFA_EMITIDO: 'Desafío MFA de admin emitido',
  ADMIN_MFA_CONFIGURACION_INICIADA: 'Configuración MFA iniciada',
  ADMIN_MFA_CONFIGURADO: 'MFA de admin configurado',
  ADMIN_MFA_FALLIDO: 'Verificación MFA fallida',
  ADMIN_MFA_RESTABLECIDO: 'MFA de admin restablecido',
  ADMIN_MFA_RECUPERACION_CODIGO_USADO: 'Código de recuperación MFA usado',
  ADMIN_INICIO_SESION: 'Inicio de sesión de admin',
  ADMIN_CIERRE_SESION: 'Cierre de sesión de admin'
};

const ETIQUETAS_ENTIDAD_AUDITORIA: Record<string, string> = {
  Organizacion: 'Organización',
  Usuario: 'Usuario',
  SuscripcionOrganizacion: 'Suscripción',
  PlanSuscripcion: 'Plan de suscripción',
  Sesion: 'Sesión',
  AccesoCliente: 'Acceso de cliente',
  MiembroOrganizacion: 'Miembro de organización'
};

@Component({
  selector: 'app-admin-resumen',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-resumen.component.html',
  styleUrls: ['./admin.shared.css', './admin-resumen.component.css']
})
export class AdminResumenComponent implements OnInit {
  resumen: ResumenAdmin | null = null;
  cargando = true;
  error = '';

  readonly tiposFreelance: TipoFreelance[] = [
    'GENERAL',
    'FOTOGRAFIA',
    'DESARROLLO_SOFTWARE',
    'DISENO_GRAFICO'
  ];
  readonly estadosSuscripcion: EstadoSuscripcion[] = [
    'SIN_SUSCRIPCION',
    'ACTIVA',
    'PRUEBA',
    'SUSPENDIDA',
    'CANCELADA'
  ];
  readonly etiquetasTipo = ETIQUETAS_TIPO_FREELANCE;
  readonly etiquetasEstado = ETIQUETAS_ESTADO_SUSCRIPCION;
  readonly claseEstado = claseEstadoSuscripcion;
  readonly formatearFecha = formatearFechaAdmin;

  constructor(private adminApi: AdminApiService) {}

  ngOnInit(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      this.resumen = await this.adminApi.obtenerResumen();
    } catch (err: any) {
      this.error = extraerErrorAdmin(err, 'No se pudo cargar el resumen de plataforma.');
    } finally {
      this.cargando = false;
    }
  }

  activasOrganizaciones(r: ResumenAdmin): number {
    const suspendidas = Math.max(0, r.organizaciones.suspendidas ?? 0);
    return Math.max(0, r.organizaciones.activas ?? (r.organizaciones.total - suspendidas));
  }

  suspendidasOrganizaciones(r: ResumenAdmin): number {
    return Math.max(0, r.organizaciones.suspendidas ?? 0);
  }

  modalidadesOrdenadas(r: ResumenAdmin): Array<{ tipo: TipoFreelance; etiqueta: string; cantidad: number; porcentaje: number }> {
    const total = Math.max(0, r.organizaciones.total ?? 0);
    return [...this.tiposFreelance]
      .map((tipo, indice) => {
        const cantidad = Math.max(0, r.organizaciones.porTipoFreelance?.[tipo] ?? 0);
        return {
          tipo,
          indice,
          etiqueta: this.etiquetasTipo[tipo],
          cantidad,
          porcentaje: this.porcentajeModalidad(cantidad, total)
        };
      })
      .sort((a, b) => (b.cantidad - a.cantidad) || (a.indice - b.indice))
      .map(({ tipo, etiqueta, cantidad, porcentaje }) => ({ tipo, etiqueta, cantidad, porcentaje }));
  }

  porcentajeModalidad(cantidad: number, total: number): number {
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(cantidad) || cantidad <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((cantidad / total) * 1000) / 10);
  }

  etiquetaAccion(accion?: string | null): string {
    if (!accion) return 'Acción administrativa';
    const conocida = ETIQUETAS_ACCION_AUDITORIA[accion];
    if (conocida) return conocida;
    const legible = accion.toLowerCase().replace(/_/g, ' ').trim();
    return legible ? legible.charAt(0).toUpperCase() + legible.slice(1) : 'Acción administrativa';
  }

  claseAccion(accion?: string | null): string {
    if (!accion) return 'admin-badge-blue';
    if (
      accion.includes('SUSPENDIDA') ||
      accion.includes('FALLIDO') ||
      accion.includes('REVOCAD') ||
      accion.includes('CANCELADA')
    ) {
      return 'admin-badge-coral';
    }
    if (
      accion.includes('REACTIVADA') ||
      accion.includes('ASIGNADA') ||
      accion.includes('CONFIGURADO') ||
      accion.includes('CREADO')
    ) {
      return 'admin-badge-green';
    }
    return 'admin-badge-blue';
  }

  etiquetaEntidad(entidad?: string | null): string {
    if (!entidad) return 'Plataforma';
    return ETIQUETAS_ENTIDAD_AUDITORIA[entidad] ?? entidad;
  }

  formatearActor(ev: EventoAuditoriaAdmin): string {
    const nombre = ev.actorNombre?.trim();
    if (nombre) return nombre;
    return ev.actorUsuarioId ? 'Administrador' : 'Sistema';
  }
}
