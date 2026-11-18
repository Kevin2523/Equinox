import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import {
  AccesoClienteAdmin,
  ActualizarOrganizacionAdminPayload,
  EstadoSuscripcion,
  EventoAuditoriaAdmin,
  HistorialSuscripcionItem,
  OrganizacionAdminDetalle,
  OrganizacionAdminItem,
  PlanSuscripcionAdmin,
  RespuestaOrganizacionesAdmin,
  RespuestaPaginadaAdmin,
  RespuestaPlanesAdmin,
  RespuestaSuscripcionesAdmin,
  ResumenAdmin,
  SuscripcionAdmin,
  UsuarioAdminDetalle,
  UsuarioAdminItem
} from '../models/admin.model';
import { RolPlataforma, TipoFreelance } from '../auth/auth.model';

export function extraerErrorAdmin(error: any, respaldo = 'No se pudo completar la operación.'): string {
  if (error?.status === 401) {
    return 'Tu sesión de administrador expiró o fue revocada. Inicia sesión nuevamente.';
  }
  if (error?.status === 403) {
    return error?.error?.error || 'Acceso denegado: se requiere rol ADMIN_GLOBAL con MFA verificado.';
  }
  if (error?.status === 404) {
    return error?.error?.error || 'El recurso solicitado no existe o no está disponible.';
  }
  if (error?.status === 409) {
    return error?.error?.error || 'Ya existe un registro con ese identificador.';
  }
  if (error?.status === 422) {
    const detalle = Array.isArray(error?.error?.detalles) && error.error.detalles.length > 0
      ? error.error.detalles.map((d: any) => d?.mensaje || d?.message || String(d)).join(' · ')
      : '';
    return detalle ? `${error?.error?.error || 'Datos inválidos'}: ${detalle}` : (error?.error?.error || 'Los datos enviados no son válidos.');
  }
  if (error?.status === 429) {
    return error?.error?.error || 'Demasiados intentos. Espera unos segundos antes de volver a intentarlo.';
  }
  return error?.error?.error || error?.message || respaldo;
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  constructor(private http: HttpClient) {}

  private construirParams(filtros: Record<string, string | number | boolean | undefined | null>): HttpParams {
    let params = new HttpParams();
    for (const [clave, valor] of Object.entries(filtros)) {
      if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
        params = params.set(clave, String(valor).trim());
      }
    }
    return params;
  }

  // Resumen
  async obtenerResumen(): Promise<ResumenAdmin> {
    return await firstValueFrom(this.http.get<ResumenAdmin>(`${obtenerBaseApi()}/admin/resumen`));
  }

  // Organizaciones
  async listarOrganizaciones(filtros: {
    pagina?: number;
    limite?: number;
    busqueda?: string;
    tipoFreelance?: TipoFreelance | '';
    estadoSuscripcion?: EstadoSuscripcion | '';
    suspendida?: 'true' | 'false' | '';
  }): Promise<RespuestaOrganizacionesAdmin> {
    const params = this.construirParams(filtros);
    return await firstValueFrom(
      this.http.get<RespuestaOrganizacionesAdmin>(`${obtenerBaseApi()}/admin/organizaciones`, { params })
    );
  }

  async obtenerOrganizacion(organizacionId: string): Promise<OrganizacionAdminDetalle> {
    const res = await firstValueFrom(
      this.http.get<{ organizacion: OrganizacionAdminDetalle }>(`${obtenerBaseApi()}/admin/organizaciones/${organizacionId}`)
    );
    return res.organizacion;
  }

  async actualizarOrganizacion(
    organizacionId: string,
    payload: ActualizarOrganizacionAdminPayload
  ): Promise<OrganizacionAdminDetalle> {
    const res = await firstValueFrom(
      this.http.patch<{ organizacion: OrganizacionAdminDetalle }>(
        `${obtenerBaseApi()}/admin/organizaciones/${organizacionId}`,
        payload
      )
    );
    return res.organizacion;
  }

  async cambiarRolMiembro(
    organizacionId: string,
    miembroId: string,
    payload: { rol: 'PROPIETARIO' | 'COLABORADOR'; motivo?: string }
  ): Promise<void> {
    await firstValueFrom(
      this.http.patch(
        `${obtenerBaseApi()}/admin/organizaciones/${organizacionId}/miembros/${miembroId}`,
        payload
      )
    );
  }

  async suspenderOrganizacion(
    organizacionId: string,
    payload: { confirmar: true; motivo: string }
  ): Promise<{ organizacion: OrganizacionAdminDetalle; sesionesRevocadas: number }> {
    return await firstValueFrom(
      this.http.post<{ organizacion: OrganizacionAdminDetalle; sesionesRevocadas: number }>(
        `${obtenerBaseApi()}/admin/organizaciones/${organizacionId}/suspender`,
        payload
      )
    );
  }

  async reactivarOrganizacion(
    organizacionId: string,
    payload: { confirmar: true; motivo?: string }
  ): Promise<OrganizacionAdminDetalle> {
    const res = await firstValueFrom(
      this.http.post<{ organizacion: OrganizacionAdminDetalle }>(
        `${obtenerBaseApi()}/admin/organizaciones/${organizacionId}/reactivar`,
        payload
      )
    );
    return res.organizacion;
  }

  // Usuarios y accesos
  async listarUsuarios(filtros: {
    pagina?: number;
    limite?: number;
    busqueda?: string;
    rolPlataforma?: RolPlataforma | '';
    tipoAcceso?: 'ORGANIZACION' | 'CLIENTE' | 'ADMIN_GLOBAL' | '';
    organizacionId?: string;
  }): Promise<RespuestaPaginadaAdmin<UsuarioAdminItem>> {
    const params = this.construirParams(filtros);
    return await firstValueFrom(
      this.http.get<RespuestaPaginadaAdmin<UsuarioAdminItem>>(`${obtenerBaseApi()}/admin/usuarios`, { params })
    );
  }

  async obtenerUsuario(usuarioId: string): Promise<UsuarioAdminDetalle> {
    const res = await firstValueFrom(
      this.http.get<{ usuario: UsuarioAdminDetalle }>(`${obtenerBaseApi()}/admin/usuarios/${usuarioId}`)
    );
    return res.usuario;
  }

  async revocarSesionesUsuario(
    usuarioId: string,
    payload: { sesionId?: string; motivo?: string }
  ): Promise<{ usuarioId: string; sesionesRevocadas: number }> {
    return await firstValueFrom(
      this.http.post<{ usuarioId: string; sesionesRevocadas: number }>(
        `${obtenerBaseApi()}/admin/usuarios/${usuarioId}/revocar-sesiones`,
        payload
      )
    );
  }

  async actualizarAccesoCliente(
    usuarioId: string,
    accesoId: string,
    payload: { activo: boolean; motivo?: string }
  ): Promise<AccesoClienteAdmin> {
    const res = await firstValueFrom(
      this.http.patch<{ acceso: AccesoClienteAdmin }>(
        `${obtenerBaseApi()}/admin/usuarios/${usuarioId}/accesos-cliente/${accesoId}`,
        payload
      )
    );
    return res.acceso;
  }

  // Suscripciones manuales
  async listarPlanes(filtros: {
    pagina?: number;
    limite?: number;
    activo?: boolean | '';
    busqueda?: string;
  }): Promise<RespuestaPlanesAdmin> {
    const params = this.construirParams(filtros);
    return await firstValueFrom(
      this.http.get<RespuestaPlanesAdmin>(`${obtenerBaseApi()}/admin/suscripciones/planes`, { params })
    );
  }

  async crearPlan(payload: {
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    activo?: boolean;
    esPlanPrueba?: boolean;
    duracionSugeridaDias?: number | null;
    orden?: number;
  }): Promise<PlanSuscripcionAdmin> {
    const res = await firstValueFrom(
      this.http.post<{ plan: PlanSuscripcionAdmin }>(`${obtenerBaseApi()}/admin/suscripciones/planes`, payload)
    );
    return res.plan;
  }

  async actualizarPlan(
    planId: string,
    payload: Partial<{
      codigo: string;
      nombre: string;
      descripcion: string | null;
      activo: boolean;
      esPlanPrueba: boolean;
      duracionSugeridaDias: number | null;
      orden: number;
    }>
  ): Promise<PlanSuscripcionAdmin> {
    const res = await firstValueFrom(
      this.http.patch<{ plan: PlanSuscripcionAdmin }>(`${obtenerBaseApi()}/admin/suscripciones/planes/${planId}`, payload)
    );
    return res.plan;
  }

  async listarSuscripciones(filtros: {
    pagina?: number;
    limite?: number;
    estado?: EstadoSuscripcion | '';
    planId?: string;
    busqueda?: string;
  }): Promise<RespuestaSuscripcionesAdmin> {
    const params = this.construirParams(filtros);
    return await firstValueFrom(
      this.http.get<RespuestaSuscripcionesAdmin>(`${obtenerBaseApi()}/admin/suscripciones`, { params })
    );
  }

  async obtenerSuscripcionOrganizacion(organizacionId: string): Promise<SuscripcionAdmin> {
    return await firstValueFrom(
      this.http.get<SuscripcionAdmin>(`${obtenerBaseApi()}/admin/suscripciones/organizaciones/${organizacionId}`)
    );
  }

  async asignarSuscripcion(
    organizacionId: string,
    payload: {
      planId: string;
      estado: 'PRUEBA' | 'ACTIVA';
      fechaInicio?: string;
      fechaFin?: string | null;
      motivo?: string;
      notasInternas?: string;
      referenciaManual?: string;
    }
  ): Promise<SuscripcionAdmin> {
    const res = await firstValueFrom(
      this.http.post<{ suscripcion: SuscripcionAdmin }>(
        `${obtenerBaseApi()}/admin/suscripciones/organizaciones/${organizacionId}/asignar`,
        payload
      )
    );
    return res.suscripcion;
  }

  async actualizarSuscripcion(
    organizacionId: string,
    payload: {
      planId?: string;
      estado?: 'PRUEBA' | 'ACTIVA' | 'SUSPENDIDA';
      fechaInicio?: string;
      fechaFin?: string | null;
      motivo?: string;
      notasInternas?: string;
      referenciaManual?: string;
    }
  ): Promise<SuscripcionAdmin> {
    const res = await firstValueFrom(
      this.http.patch<{ suscripcion: SuscripcionAdmin }>(
        `${obtenerBaseApi()}/admin/suscripciones/organizaciones/${organizacionId}`,
        payload
      )
    );
    return res.suscripcion;
  }

  async cancelarSuscripcion(
    organizacionId: string,
    payload: { motivoCancelacion?: string; notas?: string }
  ): Promise<SuscripcionAdmin> {
    const res = await firstValueFrom(
      this.http.post<{ suscripcion: SuscripcionAdmin }>(
        `${obtenerBaseApi()}/admin/suscripciones/organizaciones/${organizacionId}/cancelar`,
        payload
      )
    );
    return res.suscripcion;
  }

  async listarHistorialSuscripcion(
    organizacionId: string,
    pagina = 1,
    limite = 20
  ): Promise<RespuestaPaginadaAdmin<HistorialSuscripcionItem> & { etiquetaCobro: string }> {
    const params = this.construirParams({ pagina, limite });
    return await firstValueFrom(
      this.http.get<RespuestaPaginadaAdmin<HistorialSuscripcionItem> & { etiquetaCobro: string }>(
        `${obtenerBaseApi()}/admin/suscripciones/organizaciones/${organizacionId}/historial`,
        { params }
      )
    );
  }

  // Auditoría
  async listarAuditoria(filtros: {
    pagina?: number;
    limite?: number;
    accion?: string;
    entidad?: string;
    entidadId?: string;
    actorUsuarioId?: string;
    organizacionId?: string;
    desde?: string;
    hasta?: string;
    busqueda?: string;
  }): Promise<RespuestaPaginadaAdmin<EventoAuditoriaAdmin>> {
    const params = this.construirParams(filtros);
    return await firstValueFrom(
      this.http.get<RespuestaPaginadaAdmin<EventoAuditoriaAdmin>>(`${obtenerBaseApi()}/admin/auditoria`, { params })
    );
  }
}
