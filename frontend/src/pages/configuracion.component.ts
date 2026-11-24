import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';
import { I18nService } from '../state/i18n.service';
import { IdiomaSoportado } from '../i18n/i18n.types';
import { AuthService } from '../auth/auth.service';
import {
  OrganizacionData,
  OrganizacionService,
  VistaPreviaOrganizacion,
} from '../auth/organizacion.service';
import { TipoFreelance } from '../auth/auth.model';
import { PortalPreviewComponent } from '../shared/portal-preview.component';
import { TPipe } from '../shared/t.pipe';
import {
  COLOR_PRIMARIO_DEFECTO,
  COLOR_SECUNDARIO_DEFECTO,
  EvaluacionContrastePaleta,
  esHexValido,
  evaluarContrastePaleta,
  normalizarHex,
  obtenerFontStack,
} from '../utils/branding.util';

export type SeccionConfiguracion = 'estudio' | 'portal' | 'acceso' | 'preferencias';
export type ModoVistaPrevia = 'desktop' | 'movil';
export type EstadoGuardadoConfig = 'limpio' | 'sin_guardar' | 'guardando' | 'guardado' | 'error';

interface FormularioConfiguracion {
  nombre: string;
  correoContacto: string;
  telefono: string;
  ruc: string;
  direccion: string;
  moneda: string;
  colorPrimario: string;
  colorSecundario: string;
  portalMensajeBienvenida: string;
}

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule, PortalPreviewComponent, TPipe],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.css',
})
export class ConfiguracionComponent implements OnInit {
  public state = inject(UiStateService);
  public i18n = inject(I18nService);
  public auth = inject(AuthService);
  public orgService = inject(OrganizacionService);

  @ViewChild('inputNombreEstudio') inputNombreEstudio?: ElementRef<HTMLInputElement>;

  readonly monedasDisponibles = ['PAB', 'USD', 'EUR', 'MXN', 'COP', 'CRC'];

  seccionActiva: SeccionConfiguracion = 'portal';
  modoPreview: ModoVistaPrevia = 'desktop';

  form: FormularioConfiguracion = this.crearFormularioVacio();
  private snapshotGuardado = '';

  colorPrimarioTexto = COLOR_PRIMARIO_DEFECTO;
  colorSecundarioTexto = COLOR_SECUNDARIO_DEFECTO;

  tipoFreelanceActual: TipoFreelance = 'GENERAL';
  tipoFreelanceSeleccionado: TipoFreelance = 'GENERAL';
  portalMostrarFinanzas = false;

  vistaPrevia: VistaPreviaOrganizacion | null = null;
  cargandoOrg = false;
  cargandoVistaPrevia = false;
  guardando = false;
  guardadoReciente = false;
  errorGuardado = '';

  guardandoTipo = false;
  guardandoFinanzas = false;
  guardandoIdioma = false;
  idiomaSeleccionado: IdiomaSoportado = this.i18n.idiomaActual;
  mensajeExitoTipo = '';
  errorTipo = '';
  mensajeExitoFinanzas = '';
  errorFinanzas = '';
  mensajeExitoIdioma = '';
  errorIdioma = '';

  get esPropietario(): boolean {
    const sesion = this.auth.sesion;
    return (
      sesion?.contexto.tipoAcceso === 'ORGANIZACION' &&
      sesion.contexto.rolOrganizacion === 'PROPIETARIO'
    );
  }

  get esFotografia(): boolean {
    return this.tipoFreelanceActual === 'FOTOGRAFIA';
  }

  get nombreFreelancer(): string {
    const usuario = this.auth.sesion?.usuario;
    if (usuario) {
      const completo = `${usuario.nombre || ''} ${usuario.apellido || ''}`.trim();
      if (completo) return completo;
    }
    const propietario = this.orgService.organizacion?.miembros?.find(
      (m) => m.rol === 'PROPIETARIO'
    )?.usuario;
    if (propietario) {
      const completo = `${propietario.nombre || ''} ${propietario.apellido || ''}`.trim();
      if (completo) return completo;
    }
    return this.form.nombre || 'Propietario del estudio';
  }

  get placeholderMensajeBienvenida(): string {
    return this.esFotografia
      ? this.i18n.t('crm.configuracion.mensajeBienvenidaPlaceholderFoto')
      : this.i18n.t('crm.configuracion.mensajeBienvenidaPlaceholderGeneral');
  }

  get colorPrimarioPreview(): string {
    return normalizarHex(this.form.colorPrimario) ?? COLOR_PRIMARIO_DEFECTO;
  }

  get colorSecundarioPreview(): string {
    return normalizarHex(this.form.colorSecundario) ?? COLOR_SECUNDARIO_DEFECTO;
  }

  get fontFamilyPreview(): string {
    return obtenerFontStack();
  }

  get contrastePaleta(): EvaluacionContrastePaleta {
    return evaluarContrastePaleta(this.colorPrimarioPreview, this.colorSecundarioPreview);
  }

  get mensajeBienvenidaPreview(): string {
    const texto = this.form.portalMensajeBienvenida.trim();
    return texto || this.placeholderMensajeBienvenida;
  }

  get colorPrimarioValido(): boolean {
    return esHexValido(this.colorPrimarioTexto);
  }

  get colorSecundarioValido(): boolean {
    return esHexValido(this.colorSecundarioTexto);
  }

  get correoValido(): boolean {
    const correo = this.form.correoContacto.trim();
    if (!correo) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
  }

  get nombreValido(): boolean {
    return this.form.nombre.trim().length >= 2;
  }

  get formularioValido(): boolean {
    return (
      this.nombreValido &&
      this.correoValido &&
      this.colorPrimarioValido &&
      this.colorSecundarioValido
    );
  }

  get hayCambiosSinGuardar(): boolean {
    if (!this.snapshotGuardado) return false;
    return this.serializarFormulario() !== this.snapshotGuardado;
  }

  get estadoGuardado(): EstadoGuardadoConfig {
    if (this.guardando) return 'guardando';
    if (this.errorGuardado) return 'error';
    if (this.hayCambiosSinGuardar) return 'sin_guardar';
    if (this.guardadoReciente) return 'guardado';
    return 'limpio';
  }

  get porcentajeHitosPreview(): number {
    const proyecto = this.vistaPrevia?.proyecto;
    if (!proyecto || proyecto.totalHitos <= 0) return 0;
    return Math.round((proyecto.hitosCompletados / proyecto.totalHitos) * 100);
  }

  async ngOnInit(): Promise<void> {
    this.idiomaSeleccionado = this.i18n.idiomaActual;
    await this.cargarDatos();
  }

  async cargarDatos(): Promise<void> {
    this.cargandoOrg = true;
    this.errorGuardado = '';
    try {
      const org = await this.orgService.cargarOrganizacion();
      if (org) {
        this.aplicarOrganizacionAlFormulario(org);
      }
      await this.recargarVistaPrevia();
    } catch {
      this.errorGuardado = this.i18n.t('crm.configuracion.errCargarOrg');
    } finally {
      this.cargandoOrg = false;
    }
  }

  async recargarVistaPrevia(): Promise<void> {
    this.cargandoVistaPrevia = true;
    try {
      this.vistaPrevia = await this.orgService.cargarVistaPrevia();
    } finally {
      this.cargandoVistaPrevia = false;
    }
  }

  seleccionarSeccion(seccion: SeccionConfiguracion): void {
    this.seccionActiva = seccion;
  }

  irAEditarDatosEstudio(): void {
    this.seccionActiva = 'estudio';
    setTimeout(() => {
      this.inputNombreEstudio?.nativeElement?.focus();
    }, 30);
  }

  seleccionarModoPreview(modo: ModoVistaPrevia): void {
    this.modoPreview = modo;
  }

  alCambiarColorPicker(campo: 'primario' | 'secundario', valor: string): void {
    const normalizado = normalizarHex(valor);
    if (!normalizado) return;
    if (campo === 'primario') {
      this.form.colorPrimario = normalizado;
      this.colorPrimarioTexto = normalizado;
    } else {
      this.form.colorSecundario = normalizado;
      this.colorSecundarioTexto = normalizado;
    }
    this.marcarEditado();
  }

  alCambiarColorTexto(campo: 'primario' | 'secundario', valor: string): void {
    if (campo === 'primario') {
      this.colorPrimarioTexto = valor;
      const normalizado = normalizarHex(valor);
      if (normalizado) this.form.colorPrimario = normalizado;
    } else {
      this.colorSecundarioTexto = valor;
      const normalizado = normalizarHex(valor);
      if (normalizado) this.form.colorSecundario = normalizado;
    }
    this.marcarEditado();
  }

  marcarEditado(): void {
    this.guardadoReciente = false;
    this.errorGuardado = '';
  }

  async guardarCambios(): Promise<void> {
    if (!this.esPropietario || this.guardando || !this.formularioValido) {
      return;
    }
    this.guardando = true;
    this.errorGuardado = '';
    this.guardadoReciente = false;

    try {
      const actualizada = await this.orgService.actualizarOrganizacion({
        nombre: this.form.nombre.trim(),
        correoContacto: this.form.correoContacto.trim() || null,
        telefono: this.form.telefono.trim() || null,
        ruc: this.form.ruc.trim() || null,
        direccion: this.form.direccion.trim() || null,
        moneda: this.form.moneda,
        colorPrimario: this.colorPrimarioPreview,
        colorSecundario: this.colorSecundarioPreview,
        portalMensajeBienvenida: this.form.portalMensajeBienvenida.trim() || null,
      });
      this.aplicarOrganizacionAlFormulario(actualizada);
      this.sincronizarUiState(actualizada);
      this.guardadoReciente = true;
      setTimeout(() => {
        if (this.guardadoReciente && !this.hayCambiosSinGuardar) {
          this.guardadoReciente = false;
        }
      }, 4500);
    } catch (err: any) {
      if (err?.status === 403) {
        this.errorGuardado = this.i18n.t('crm.configuracion.errSoloPropGuardar');
      } else if (err?.status === 422 || err?.status === 400) {
        this.errorGuardado = this.i18n.t('crm.configuracion.errCamposInvalidos');
      } else {
        this.errorGuardado = this.i18n.t('crm.configuracion.errGuardar');
      }
    } finally {
      this.guardando = false;
    }
  }

  async cambiarPortalMostrarFinanzas(nuevoValor: boolean): Promise<void> {
    if (!this.esPropietario || this.guardandoFinanzas || this.cargandoOrg) {
      return;
    }
    const valorAnterior = this.portalMostrarFinanzas;
    this.portalMostrarFinanzas = nuevoValor;
    this.guardandoFinanzas = true;
    this.errorFinanzas = '';
    this.mensajeExitoFinanzas = '';

    try {
      await this.orgService.actualizarPortalMostrarFinanzas(nuevoValor);
      const msgExito = nuevoValor
        ? this.i18n.t('crm.configuracion.facturasActivadas')
        : this.i18n.t('crm.configuracion.facturasDesactivadas');
      this.mensajeExitoFinanzas = msgExito;
      setTimeout(() => {
        if (this.mensajeExitoFinanzas === msgExito) {
          this.mensajeExitoFinanzas = '';
        }
      }, 4000);
    } catch (err: any) {
      this.portalMostrarFinanzas = valorAnterior;
      if (err?.status === 403) {
        this.errorFinanzas = this.i18n.t('crm.configuracion.errFacturasSoloProp');
      } else {
        this.errorFinanzas = this.i18n.t('crm.configuracion.errFacturasGuardar');
      }
    } finally {
      this.guardandoFinanzas = false;
    }
  }

  async cambiarTipoFreelance(nuevoTipo: TipoFreelance): Promise<void> {
    if (!this.esPropietario || this.guardandoTipo || nuevoTipo === this.tipoFreelanceActual) {
      return;
    }
    this.guardandoTipo = true;
    this.errorTipo = '';
    this.mensajeExitoTipo = '';

    try {
      await this.orgService.actualizarTipoFreelance(nuevoTipo);
      this.tipoFreelanceActual = nuevoTipo;
      this.tipoFreelanceSeleccionado = nuevoTipo;
      const msgExitoTipo = this.i18n.t('crm.configuracion.modalidadExito');
      this.mensajeExitoTipo = msgExitoTipo;
      await this.recargarVistaPrevia();
      setTimeout(() => {
        if (this.mensajeExitoTipo === msgExitoTipo) {
          this.mensajeExitoTipo = '';
        }
      }, 4000);
    } catch (err: any) {
      this.tipoFreelanceSeleccionado = this.tipoFreelanceActual;
      if (err?.status === 403) {
        this.errorTipo = this.i18n.t('crm.configuracion.modalidadSoloProp');
      } else {
        this.errorTipo = this.i18n.t('crm.configuracion.errModalidad');
      }
    } finally {
      this.guardandoTipo = false;
    }
  }

  async cambiarIdiomaPersonal(nuevoIdioma: IdiomaSoportado): Promise<void> {
    if (this.guardandoIdioma || nuevoIdioma === this.i18n.idiomaActual) {
      return;
    }

    const anterior = this.i18n.idiomaActual;
    this.guardandoIdioma = true;
    this.errorIdioma = '';
    this.mensajeExitoIdioma = '';

    try {
      const confirmado = await this.i18n.guardarIdiomaUsuario(nuevoIdioma);
      this.idiomaSeleccionado = confirmado;
      this.auth.actualizarIdiomaLocal(confirmado);
      const etiqueta = this.i18n.t(`configuracion.idioma.${confirmado}`);
      this.mensajeExitoIdioma = this.i18n.t('configuracion.idioma.guardado', { idioma: etiqueta });
      setTimeout(() => {
        this.mensajeExitoIdioma = '';
      }, 4000);
    } catch {
      this.idiomaSeleccionado = anterior;
      this.errorIdioma = this.i18n.t('configuracion.idioma.error');
    } finally {
      this.guardandoIdioma = false;
    }
  }

  etiquetaEstadoProyecto(estado: string): string {
    const mapa: Record<string, string> = {
      BORRADOR: 'Borrador',
      ACTIVO: 'Activo',
      PAUSADO: 'Pausado',
      COMPLETADO: 'Completado',
      CANCELADO: 'Cancelado',
    };
    return mapa[estado] || estado;
  }

  private aplicarOrganizacionAlFormulario(org: OrganizacionData): void {
    const primario = normalizarHex(org.colorPrimario) ?? COLOR_PRIMARIO_DEFECTO;
    const secundario = normalizarHex(org.colorSecundario) ?? COLOR_SECUNDARIO_DEFECTO;

    this.form = {
      nombre: org.nombre || '',
      correoContacto: org.correoContacto || '',
      telefono: org.telefono || '',
      ruc: org.ruc || '',
      direccion: org.direccion || '',
      moneda: (org.moneda || 'PAB').toUpperCase(),
      colorPrimario: primario,
      colorSecundario: secundario,
      portalMensajeBienvenida: org.portalMensajeBienvenida || '',
    };
    this.colorPrimarioTexto = primario;
    this.colorSecundarioTexto = secundario;
    this.tipoFreelanceActual = org.tipoFreelance || 'GENERAL';
    this.tipoFreelanceSeleccionado = this.tipoFreelanceActual;
    this.portalMostrarFinanzas = Boolean(org.portalMostrarFinanzas);
    this.snapshotGuardado = this.serializarFormulario();
  }

  private sincronizarUiState(org: OrganizacionData): void {
    if (!this.state.configuracion) return;
    this.state.configuracion = {
      ...this.state.configuracion,
      nombreEstudio: org.nombre,
      correo: org.correoContacto || '',
      telefono: org.telefono || '',
      ruc: org.ruc || '',
      moneda: `B/. (${org.moneda || 'PAB'})`,
      colorPrimario: org.colorPrimario || COLOR_PRIMARIO_DEFECTO,
      colorSecundario: org.colorSecundario || COLOR_SECUNDARIO_DEFECTO,
      tipografia: 'Inter',
      mensajeBienvenida: org.portalMensajeBienvenida || this.placeholderMensajeBienvenida,
    };
  }

  private serializarFormulario(): string {
    return JSON.stringify({
      nombre: this.form.nombre.trim(),
      correoContacto: this.form.correoContacto.trim(),
      telefono: this.form.telefono.trim(),
      ruc: this.form.ruc.trim(),
      direccion: this.form.direccion.trim(),
      moneda: this.form.moneda,
      colorPrimario: this.colorPrimarioTexto.trim().toUpperCase(),
      colorSecundario: this.colorSecundarioTexto.trim().toUpperCase(),
      portalMensajeBienvenida: this.form.portalMensajeBienvenida.trim(),
    });
  }

  private crearFormularioVacio(): FormularioConfiguracion {
    return {
      nombre: '',
      correoContacto: '',
      telefono: '',
      ruc: '',
      direccion: '',
      moneda: 'PAB',
      colorPrimario: COLOR_PRIMARIO_DEFECTO,
      colorSecundario: COLOR_SECUNDARIO_DEFECTO,
      portalMensajeBienvenida: '',
    };
  }
}
