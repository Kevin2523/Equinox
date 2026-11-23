import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../auth/auth.service';
import { TipoFreelance } from '../../auth/auth.model';
import {
  ActualizarOrganizacionAdminPayload,
  EstadoSuscripcion,
  OrganizacionAdminDetalle,
  OrganizacionAdminItem,
  OrganizacionesResumenConteo,
  OrganizacionMiembroAdmin,
  PaginacionAdmin
} from '../../models/admin.model';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import {
  ETIQUETAS_ESTADO_SUSCRIPCION,
  ETIQUETAS_TIPO_FREELANCE,
  claseEstadoSuscripcion,
  formatearFechaAdmin
} from './admin-formatters';

@Component({
  selector: 'app-admin-organizaciones',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-organizaciones.component.html',
  styleUrls: ['./admin.shared.css', './admin-organizaciones.component.css']
})
export class AdminOrganizacionesComponent implements OnInit {
  organizaciones: OrganizacionAdminItem[] = [];
  paginacion: PaginacionAdmin = { pagina: 1, limite: 20, total: 0, totalPaginas: 0 };
  resumen: OrganizacionesResumenConteo = { total: 0, activas: 0, suspendidas: 0 };

  busqueda = '';
  filtroTipo: TipoFreelance | '' = '';
  filtroEstado: EstadoSuscripcion | '' = '';
  filtroSuspendida: '' | 'true' | 'false' = '';

  cargando = false;
  error = '';
  toast = '';

  menuAbiertoId: string | null = null;

  // Detalle
  detalle: OrganizacionAdminDetalle | null = null;
  cargandoDetalle = false;

  // Edición
  editando = false;
  guardandoEdicion = false;
  errorEdicion = '';
  formEdicion: ActualizarOrganizacionAdminPayload = {};

  // Confirmación acceso / cambio de rol
  confirmacion: {
    tipo: 'SUSPENDER' | 'REACTIVAR' | 'CAMBIAR_ROL';
    organizacionId: string;
    miembro?: OrganizacionMiembroAdmin;
    nuevoRol?: 'PROPIETARIO' | 'COLABORADOR';
    titulo: string;
    descripcion: string;
    motivo: string;
    motivoRequerido: boolean;
  } | null = null;
  ejecutandoConfirm = false;
  errorConfirm = '';

  readonly tipos: TipoFreelance[] = ['GENERAL', 'DESARROLLO_SOFTWARE', 'FOTOGRAFIA', 'DISENO_GRAFICO'];
  readonly estados: EstadoSuscripcion[] = ['SIN_SUSCRIPCION', 'PRUEBA', 'ACTIVA', 'SUSPENDIDA', 'CANCELADA'];
  readonly etiquetasTipo = ETIQUETAS_TIPO_FREELANCE;
  readonly etiquetasEstado = ETIQUETAS_ESTADO_SUSCRIPCION;
  readonly claseEstado = claseEstadoSuscripcion;
  readonly formatearFecha = formatearFechaAdmin;

  constructor(
    private adminApi: AdminApiService,
    private auth: AuthService
  ) {}

  get esAdminGlobal(): boolean {
    return this.auth.esAdminGlobal;
  }

  get hayFiltrosActivos(): boolean {
    return Boolean(
      this.busqueda.trim() || this.filtroTipo || this.filtroEstado || this.filtroSuspendida
    );
  }

  ngOnInit(): void {
    void this.cargar(1);
  }

  @HostListener('document:click')
  cerrarMenuAlClickAfuera(): void {
    this.menuAbiertoId = null;
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape(): void {
    if (this.confirmacion && !this.ejecutandoConfirm) {
      this.confirmacion = null;
      return;
    }
    if (this.menuAbiertoId) {
      this.menuAbiertoId = null;
      return;
    }
    if (this.detalle && !this.guardandoEdicion) {
      this.cerrarDetalle();
    }
  }

  async cargar(pagina = this.paginacion.pagina): Promise<void> {
    this.cargando = true;
    this.error = '';
    this.menuAbiertoId = null;
    try {
      const res = await this.adminApi.listarOrganizaciones({
        pagina,
        limite: this.paginacion.limite,
        busqueda: this.busqueda,
        tipoFreelance: this.filtroTipo,
        estadoSuscripcion: this.filtroEstado,
        suspendida: this.filtroSuspendida
      });
      this.organizaciones = res.datos;
      this.paginacion = res.paginacion;
      if (res.resumen) {
        this.resumen = res.resumen;
      } else {
        const suspendidas = res.datos.filter((o) => this.estaSuspendida(o)).length;
        this.resumen = {
          total: res.paginacion.total,
          activas: Math.max(0, res.paginacion.total - suspendidas),
          suspendidas
        };
      }
    } catch (err: any) {
      this.error = extraerErrorAdmin(err, 'No se pudieron cargar las organizaciones.');
    } finally {
      this.cargando = false;
    }
  }

  buscar(): void {
    void this.cargar(1);
  }

  limpiarFiltros(): void {
    this.busqueda = '';
    this.filtroTipo = '';
    this.filtroEstado = '';
    this.filtroSuspendida = '';
    void this.cargar(1);
  }

  toggleMenu(orgId: string, event: Event): void {
    event.stopPropagation();
    this.menuAbiertoId = this.menuAbiertoId === orgId ? null : orgId;
  }

  estaSuspendida(org: { suspendida?: boolean; suspendidaEn?: string | null }): boolean {
    return Boolean(org.suspendida || org.suspendidaEn);
  }

  nombrePropietario(org: OrganizacionAdminItem): string {
    if (!org.propietarios || org.propietarios.length === 0) {
      return 'Sin propietario';
    }
    const p = org.propietarios[0];
    return [p.nombre, p.apellido].filter(Boolean).join(' ').trim() || 'Sin propietario';
  }

  correoPropietario(org: OrganizacionAdminItem): string {
    if (org.propietarios && org.propietarios.length > 0) {
      return org.propietarios[0].correo;
    }
    return org.correoContacto || 'Sin correo';
  }

  pluralizar(cantidad: number, singular: string, plural: string): string {
    return `${cantidad} ${cantidad === 1 ? singular : plural}`;
  }

  textoOperacionPrincipal(org: OrganizacionAdminItem): string {
    if (org.tipoFreelance === 'FOTOGRAFIA') {
      return [
        this.pluralizar(org.conteos.clientes, 'cliente', 'clientes'),
        this.pluralizar(org.conteos.sesionesFotograficas, 'sesión', 'sesiones'),
        this.pluralizar(org.conteos.fotos ?? 0, 'foto', 'fotos')
      ].join(' · ');
    }
    return [
      this.pluralizar(org.conteos.clientes, 'cliente', 'clientes'),
      this.pluralizar(org.conteos.proyectos, 'proyecto', 'proyectos')
    ].join(' · ');
  }

  textoOperacionSecundaria(org: OrganizacionAdminItem): string {
    return [
      this.pluralizar(org.conteos.miembros, 'miembro', 'miembros'),
      this.pluralizar(org.conteos.facturas, 'factura', 'facturas')
    ].join(' · ');
  }

  textoMostrando(): string {
    const total = this.paginacion.total;
    if (total === 0) return 'Mostrando 0 organizaciones';
    const sufijo = total === 1 ? 'organización' : 'organizaciones';
    if (this.paginacion.pagina <= 1) {
      return `Mostrando ${this.organizaciones.length} de ${total} ${sufijo}`;
    }
    const inicio = (this.paginacion.pagina - 1) * this.paginacion.limite + 1;
    const fin = inicio + this.organizaciones.length - 1;
    return `Mostrando ${inicio}–${fin} de ${total} ${sufijo}`;
  }

  paginasVisibles(): Array<number | '...'> {
    const total = Math.max(1, this.paginacion.totalPaginas || 1);
    const actual = this.paginacion.pagina;
    if (total <= 7) {
      return Array.from({ length: total }, (_, idx) => idx + 1);
    }
    const paginas: Array<number | '...'> = [1];
    if (actual > 3) paginas.push('...');
    const inicio = Math.max(2, actual - 1);
    const fin = Math.min(total - 1, actual + 1);
    for (let p = inicio; p <= fin; p++) {
      paginas.push(p);
    }
    if (actual < total - 2) paginas.push('...');
    paginas.push(total);
    return paginas;
  }

  irAPagina(pagina: number): void {
    const total = Math.max(1, this.paginacion.totalPaginas || 1);
    if (pagina < 1 || pagina > total || pagina === this.paginacion.pagina || this.cargando) {
      return;
    }
    void this.cargar(pagina);
  }

  pedirSuspender(org: { id: string; nombre: string }, event?: Event): void {
    event?.stopPropagation();
    this.menuAbiertoId = null;
    if (!this.esAdminGlobal) {
      this.error = 'Acceso denegado: se requiere rol ADMIN_GLOBAL con MFA verificado.';
      return;
    }
    this.errorConfirm = '';
    this.confirmacion = {
      tipo: 'SUSPENDER',
      organizacionId: org.id,
      titulo: `Suspender acceso de ${org.nombre}`,
      descripcion:
        'Se suspenderá el acceso operativo de la organización (Organizacion.suspendidaEn) y se revocarán de inmediato sus sesiones activas. No altera el estado comercial de su suscripción.',
      motivo: '',
      motivoRequerido: true
    };
  }

  pedirReactivar(org: { id: string; nombre: string }, event?: Event): void {
    event?.stopPropagation();
    this.menuAbiertoId = null;
    if (!this.esAdminGlobal) {
      this.error = 'Acceso denegado: se requiere rol ADMIN_GLOBAL con MFA verificado.';
      return;
    }
    this.errorConfirm = '';
    this.confirmacion = {
      tipo: 'REACTIVAR',
      organizacionId: org.id,
      titulo: `Reactivar acceso de ${org.nombre}`,
      descripcion:
        'Se restaurará el acceso operativo de la organización limpiando Organizacion.suspendidaEn. Su suscripción manual permanece sin cambios.',
      motivo: '',
      motivoRequerido: false
    };
  }

  pedirCambiarRol(orgId: string, miembro: OrganizacionMiembroAdmin): void {
    if (!this.esAdminGlobal) {
      this.error = 'Acceso denegado: se requiere rol ADMIN_GLOBAL con MFA verificado.';
      return;
    }
    const nuevoRol: 'PROPIETARIO' | 'COLABORADOR' =
      miembro.rol === 'PROPIETARIO' ? 'COLABORADOR' : 'PROPIETARIO';
    this.errorConfirm = '';
    this.confirmacion = {
      tipo: 'CAMBIAR_ROL',
      organizacionId: orgId,
      miembro,
      nuevoRol,
      titulo: `Cambiar rol de ${miembro.usuario.nombre}`,
      descripcion: `El rol en el estudio cambiará de ${miembro.rol} a ${nuevoRol}.`,
      motivo: '',
      motivoRequerido: false
    };
  }

  async ejecutarConfirmacion(): Promise<void> {
    if (!this.confirmacion || this.ejecutandoConfirm) return;
    if (!this.esAdminGlobal) {
      this.errorConfirm = 'Acceso denegado: se requiere rol ADMIN_GLOBAL con MFA verificado.';
      return;
    }
    const c = this.confirmacion;
    const motivo = c.motivo.trim();
    if (c.motivoRequerido && motivo.length < 3) {
      this.errorConfirm = 'Ingresa un motivo de al menos 3 caracteres para suspender la organización.';
      return;
    }
    this.ejecutandoConfirm = true;
    this.errorConfirm = '';
    try {
      if (c.tipo === 'SUSPENDER') {
        const res = await this.adminApi.suspenderOrganizacion(c.organizacionId, { confirmar: true, motivo });
        if (this.detalle?.id === c.organizacionId) this.detalle = res.organizacion;
        this.mostrarToast(`Organización suspendida (${res.sesionesRevocadas} sesiones revocadas).`);
      } else if (c.tipo === 'REACTIVAR') {
        const org = await this.adminApi.reactivarOrganizacion(c.organizacionId, {
          confirmar: true,
          ...(motivo ? { motivo } : {})
        });
        if (this.detalle?.id === c.organizacionId) this.detalle = org;
        this.mostrarToast('Acceso de organización reactivado.');
      } else if (c.tipo === 'CAMBIAR_ROL' && c.miembro && c.nuevoRol) {
        await this.adminApi.cambiarRolMiembro(c.organizacionId, c.miembro.id, {
          rol: c.nuevoRol,
          ...(motivo ? { motivo } : {})
        });
        if (this.detalle?.id === c.organizacionId) {
          this.detalle = await this.adminApi.obtenerOrganizacion(c.organizacionId);
        }
        this.mostrarToast(`Rol actualizado a ${c.nuevoRol}.`);
      }
      this.confirmacion = null;
      await this.cargar(this.paginacion.pagina);
    } catch (err: any) {
      this.errorConfirm = extraerErrorAdmin(err, 'No se pudo completar la acción.');
    } finally {
      this.ejecutandoConfirm = false;
    }
  }

  async verDetalle(orgId: string, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.menuAbiertoId = null;
    this.cargandoDetalle = true;
    this.editando = false;
    this.errorEdicion = '';
    try {
      this.detalle = await this.adminApi.obtenerOrganizacion(orgId);
    } catch (err: any) {
      this.error = extraerErrorAdmin(err, 'No se pudo cargar el detalle de la organización.');
    } finally {
      this.cargandoDetalle = false;
    }
  }

  cerrarDetalle(): void {
    this.detalle = null;
    this.editando = false;
    this.errorEdicion = '';
  }

  iniciarEdicion(): void {
    if (!this.detalle || !this.esAdminGlobal) return;
    this.formEdicion = {
      nombre: this.detalle.nombre,
      correoContacto: this.detalle.correoContacto || '',
      ruc: this.detalle.ruc || '',
      moneda: this.detalle.moneda,
      tipoFreelance: this.detalle.tipoFreelance,
      portalMostrarFinanzas: this.detalle.portalMostrarFinanzas,
      motivo: ''
    };
    this.errorEdicion = '';
    this.editando = true;
  }

  async guardarEdicion(): Promise<void> {
    if (!this.detalle || this.guardandoEdicion || !this.esAdminGlobal) return;
    this.guardandoEdicion = true;
    this.errorEdicion = '';
    try {
      const actualizada = await this.adminApi.actualizarOrganizacion(this.detalle.id, {
        nombre: this.formEdicion.nombre?.trim(),
        correoContacto: this.formEdicion.correoContacto?.trim() || null,
        ruc: this.formEdicion.ruc?.trim() || null,
        moneda: this.formEdicion.moneda?.trim().toUpperCase(),
        tipoFreelance: this.formEdicion.tipoFreelance,
        portalMostrarFinanzas: this.formEdicion.portalMostrarFinanzas,
        motivo: this.formEdicion.motivo?.trim() || undefined
      });
      this.detalle = actualizada;
      this.editando = false;
      this.mostrarToast('Organización actualizada y auditada.');
      await this.cargar(this.paginacion.pagina);
    } catch (err: any) {
      this.errorEdicion = extraerErrorAdmin(err, 'No se pudo actualizar la organización.');
    } finally {
      this.guardandoEdicion = false;
    }
  }

  private mostrarToast(msg: string): void {
    this.toast = msg;
    setTimeout(() => {
      if (this.toast === msg) this.toast = '';
    }, 3400);
  }
}
