import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import { EstadoSuscripcion, EventoAuditoriaAdmin, ResumenAdmin } from '../../models/admin.model';
import { TipoFreelance } from '../../auth/auth.model';
import { TPipe } from '../../shared/t.pipe';
import { I18nService } from '../../state/i18n.service';
import {
  CLAVES_ESTADO_SUSCRIPCION,
  CLAVES_TIPO_FREELANCE,
  claseEstadoSuscripcion,
  formatearFechaAdmin,
  formatearNumeroAdmin
} from './admin-formatters';

const ACCIONES_AUDITORIA_CONOCIDAS = new Set([
  'ORGANIZACION_ACTUALIZADA',
  'ORGANIZACION_SUSPENDIDA',
  'ORGANIZACION_REACTIVADA',
  'MIEMBRO_ROL_ACTUALIZADO',
  'SESION_REVOCADA',
  'SESIONES_REVOCADAS',
  'ACCESO_CLIENTE_ACTUALIZADO',
  'PLAN_SUSCRIPCION_CREADO',
  'PLAN_SUSCRIPCION_ACTUALIZADO',
  'SUSCRIPCION_MANUAL_ASIGNADA',
  'SUSCRIPCION_MANUAL_ACTUALIZADA',
  'SUSCRIPCION_MANUAL_CANCELADA',
  'ADMIN_DESAFIO_MFA_EMITIDO',
  'ADMIN_MFA_CONFIGURACION_INICIADA',
  'ADMIN_MFA_CONFIGURADO',
  'ADMIN_MFA_FALLIDO',
  'ADMIN_MFA_RESTABLECIDO',
  'ADMIN_MFA_RECUPERACION_CODIGO_USADO',
  'ADMIN_INICIO_SESION',
  'ADMIN_CIERRE_SESION'
]);

const ENTIDADES_AUDITORIA_CONOCIDAS = new Set([
  'Organizacion',
  'Usuario',
  'SuscripcionOrganizacion',
  'PlanSuscripcion',
  'Sesion',
  'AccesoCliente',
  'MiembroOrganizacion'
]);

@Component({
  selector: 'app-admin-resumen',
  standalone: true,
  imports: [CommonModule, RouterLink, TPipe],
  templateUrl: './admin-resumen.component.html',
  styleUrls: ['./admin.shared.css', './admin-resumen.component.css']
})
export class AdminResumenComponent implements OnInit {
  readonly i18n = inject(I18nService);

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
  readonly clavesTipo = CLAVES_TIPO_FREELANCE;
  readonly clavesEstado = CLAVES_ESTADO_SUSCRIPCION;
  readonly claseEstado = claseEstadoSuscripcion;

  constructor(private adminApi: AdminApiService) {}

  formatearFecha(valor?: string | null, incluirHora = true): string {
    return formatearFechaAdmin(valor, incluirHora, this.i18n.bcp47());
  }

  formatearNumero(valor: number): string {
    return formatearNumeroAdmin(valor, this.i18n.bcp47());
  }

  ngOnInit(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      this.resumen = await this.adminApi.obtenerResumen();
    } catch (err: any) {
      this.error = extraerErrorAdmin(err, this.i18n.t('admin.resumen.errorCargar'));
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
          etiqueta: this.i18n.t(this.clavesTipo[tipo]),
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
    if (!accion) return this.i18n.t('admin.resumen.accionDefecto');
    if (ACCIONES_AUDITORIA_CONOCIDAS.has(accion)) {
      return this.i18n.t(`admin.auditoria.accion.${accion}`);
    }
    const legible = accion.toLowerCase().replace(/_/g, ' ').trim();
    return legible ? legible.charAt(0).toUpperCase() + legible.slice(1) : this.i18n.t('admin.resumen.accionDefecto');
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
    if (!entidad) return this.i18n.t('admin.resumen.entidadDefecto');
    if (ENTIDADES_AUDITORIA_CONOCIDAS.has(entidad)) {
      return this.i18n.t(`admin.auditoria.entidad.${entidad}`);
    }
    return entidad;
  }

  formatearActor(ev: EventoAuditoriaAdmin): string {
    const nombre = ev.actorNombre?.trim();
    if (nombre) return nombre;
    return ev.actorUsuarioId ? this.i18n.t('admin.comun.administrador') : this.i18n.t('admin.comun.sistema');
  }
}
