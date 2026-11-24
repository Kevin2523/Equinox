import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  Optional,
  ViewChild,
} from '@angular/core';
import { VistaPreviaOrganizacion } from '../auth/organizacion.service';
import { I18nService } from '../state/i18n.service';
import {
  COLOR_PRIMARIO_DEFECTO,
  COLOR_SECUNDARIO_DEFECTO,
  evaluarContrastePaleta,
  normalizarHex,
  obtenerFontStack,
} from '../utils/branding.util';
import { PortalHeroComponent } from './portal-hero.component';
import { TPipe } from './t.pipe';

@Component({
  selector: 'app-portal-preview',
  standalone: true,
  imports: [CommonModule, PortalHeroComponent, TPipe],
  templateUrl: './portal-preview.component.html',
  styleUrls: ['../shared/portal-editorial.css', './portal-preview.component.css'],
})
export class PortalPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() modo: 'desktop' | 'movil' = 'desktop';
  @Input() nombreEstudio = '';
  @Input() esFotografia = false;
  @Input() colorPrimario = COLOR_PRIMARIO_DEFECTO;
  @Input() colorSecundario = COLOR_SECUNDARIO_DEFECTO;
  @Input() mensajeBienvenida = '';
  @Input() portalMostrarFinanzas = false;
  @Input() vistaPrevia: VistaPreviaOrganizacion | null = null;
  @Input() cargando = false;

  @ViewChild('stageEl') stageEl?: ElementRef<HTMLElement>;
  @ViewChild('canvasEl') canvasEl?: ElementRef<HTMLElement>;

  readonly anchoVirtualDesktop = 1040;
  escalaDesktop = 0.44;
  alturaEscalada: number | null = null;

  private observer?: ResizeObserver;

  constructor(@Optional() public i18n?: I18nService) {}

  private t(key: string, fallback: string, params?: Record<string, string | number>): string {
    if (this.i18n) {
      return this.i18n.t(key, params);
    }
    if (!params) return fallback;
    return fallback.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, name) => {
      const valor = params[name];
      return valor !== undefined && valor !== null ? String(valor) : match;
    });
  }

  get primarioSeguro(): string {
    return normalizarHex(this.colorPrimario) ?? COLOR_PRIMARIO_DEFECTO;
  }

  get secundarioSeguro(): string {
    return normalizarHex(this.colorSecundario) ?? COLOR_SECUNDARIO_DEFECTO;
  }

  get contraste() {
    return evaluarContrastePaleta(this.primarioSeguro, this.secundarioSeguro);
  }

  get fontFamilyFija(): string {
    return obtenerFontStack();
  }

  get nombreEstudioVisible(): string {
    return this.nombreEstudio.trim() || this.t('portal.preview.tuEstudio', 'Tu estudio');
  }

  get clienteNombre(): string | null {
    const nombre = this.vistaPrevia?.clienteNombre?.trim();
    return nombre ? nombre : null;
  }

  get inicialCliente(): string {
    return this.clienteNombre ? this.clienteNombre.charAt(0).toLowerCase() : 'c';
  }

  get mensajeContextual(): string {
    const personalizado = this.mensajeBienvenida.trim();
    if (personalizado) return personalizado;
    const estudio = this.nombreEstudioVisible;
    if (this.esFotografia) {
      return this.t(
        'portal.home.mensajeFotografia',
        `Aquí encontrarás las sesiones y documentos que ${estudio} comparta contigo.`,
        { estudio }
      );
    }
    return this.t(
      'portal.home.mensajeGeneral',
      `Aquí encontrarás los proyectos, documentos y facturas que ${estudio} comparta contigo.`,
      { estudio }
    );
  }

  get totalElementosColumnaPrincipal(): number {
    if (this.esFotografia) {
      return this.vistaPrevia?.sesion ? 1 : 0;
    }
    return this.vistaPrevia?.proyecto ? 1 : 0;
  }

  get facturasVisibles() {
    if (!this.portalMostrarFinanzas) return [];
    return this.vistaPrevia?.facturas ?? [];
  }

  get porcentajeHitos(): number | null {
    const proyecto = this.vistaPrevia?.proyecto;
    if (!proyecto || proyecto.totalHitos <= 0) return null;
    return Math.round((proyecto.hitosCompletados / proyecto.totalHitos) * 100);
  }

  ngAfterViewInit(): void {
    if (typeof ResizeObserver !== 'undefined' && this.stageEl?.nativeElement) {
      this.observer = new ResizeObserver(() => this.recalcularEscala());
      this.observer.observe(this.stageEl.nativeElement);
      if (this.canvasEl?.nativeElement) {
        this.observer.observe(this.canvasEl.nativeElement);
      }
    }
    setTimeout(() => this.recalcularEscala(), 0);
  }

  ngOnChanges(): void {
    setTimeout(() => this.recalcularEscala(), 0);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  recalcularEscala(): void {
    const stage = this.stageEl?.nativeElement;
    const canvas = this.canvasEl?.nativeElement;
    if (!stage || !canvas) return;

    if (this.modo === 'movil') {
      this.alturaEscalada = null;
      return;
    }

    const anchoDisponible = stage.clientWidth;
    if (anchoDisponible > 0) {
      this.escalaDesktop = Math.min(1, anchoDisponible / this.anchoVirtualDesktop);
      const altoNatural = canvas.scrollHeight || 680;
      this.alturaEscalada = Math.ceil(altoNatural * this.escalaDesktop);
    }
  }
}
