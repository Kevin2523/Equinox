import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import { CATALOGO_EN } from '../i18n/en';
import { CATALOGO_ES } from '../i18n/es';
import {
  CatalogoTraducciones,
  IDIOMAS_SOPORTADOS,
  IdiomaSoportado,
  METADATA_IDIOMAS,
  MetadataIdioma,
  esIdiomaSoportado,
  normalizarIdioma,
} from '../i18n/i18n.types';
import { CATALOGO_PT } from '../i18n/pt';

const CLAVE_IDIOMA_LOCAL = 'equinox_idioma_local';

export const SCOPES_I18N = ['publico-shell', 'crm', 'fotografia-portal', 'admin'] as const;
export type ScopeI18n = (typeof SCOPES_I18N)[number];

const CATALOGOS: Record<IdiomaSoportado, CatalogoTraducciones> = {
  es: { ...CATALOGO_ES },
  en: { ...CATALOGO_EN },
  pt: { ...CATALOGO_PT },
};

const scopesCargados = new Set<string>();
const cargasEnCurso = new Map<string, Promise<void>>();

/**
 * Permite a módulos o tracks registrar catálogos por scope sin colisionar en un archivo único.
 * Las claves deben usar prefijo de scope (ej. 'crm.clientes.titulo').
 */
export function registrarCatalogosI18n(
  catalogos: Partial<Record<IdiomaSoportado, CatalogoTraducciones>>
): void {
  for (const idioma of IDIOMAS_SOPORTADOS) {
    const entradas = catalogos[idioma];
    if (entradas) {
      Object.assign(CATALOGOS[idioma], entradas);
    }
  }
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly http = inject(HttpClient, { optional: true });

  private readonly localeSignal = signal<IdiomaSoportado>(this.detectarLocalePreAuth());
  readonly locale: Signal<IdiomaSoportado> = this.localeSignal.asReadonly();
  readonly bcp47: Signal<string> = computed(() => METADATA_IDIOMAS[this.localeSignal()].bcp47);
  private readonly versionCatalogo = signal(0);

  private readonly localeSubject = new BehaviorSubject<IdiomaSoportado>(this.localeSignal());
  readonly locale$ = this.localeSubject.asObservable();

  readonly idiomasDisponibles: readonly MetadataIdioma[] = IDIOMAS_SOPORTADOS.map(
    (codigo) => METADATA_IDIOMAS[codigo]
  );

  constructor() {
    this.aplicarAtributoDocumento(this.localeSignal());
  }

  get idiomaActual(): IdiomaSoportado {
    return this.localeSignal();
  }

  registrarCatalogos(catalogos: Partial<Record<IdiomaSoportado, CatalogoTraducciones>>): void {
    registrarCatalogosI18n(catalogos);
    this.versionCatalogo.update((v) => v + 1);
  }

  async inicializar(): Promise<void> {
    const activo = this.localeSignal();
    await this.asegurarCatalogosIdioma('es');
    if (activo !== 'es') {
      await this.asegurarCatalogosIdioma(activo);
    }
  }

  async asegurarCatalogosIdioma(idioma: IdiomaSoportado): Promise<void> {
    if (typeof fetch !== 'function') return;
    await Promise.all(SCOPES_I18N.map((scope) => this.cargarScope(scope, idioma)));
  }

  private async cargarScope(scope: ScopeI18n, idioma: IdiomaSoportado): Promise<void> {
    const claveCache = `${scope}:${idioma}`;
    if (scopesCargados.has(claveCache)) return;
    const enCurso = cargasEnCurso.get(claveCache);
    if (enCurso) return enCurso;

    const promesa = (async () => {
      try {
        const res = await fetch(`/assets/i18n/${scope}/${idioma}.json`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const tipo = res.headers.get('content-type') || '';
        if (!tipo.includes('json') && !tipo.includes('text/plain')) return;
        const datos = (await res.json()) as CatalogoTraducciones;
        if (datos && typeof datos === 'object') {
          Object.assign(CATALOGOS[idioma], datos);
          this.versionCatalogo.update((v) => v + 1);
        }
        scopesCargados.add(claveCache);
      } catch {
        // Scope aún no creado o no disponible; se mantiene fallback 'es' / clave
      } finally {
        cargasEnCurso.delete(claveCache);
      }
    })();

    cargasEnCurso.set(claveCache, promesa);
    return promesa;
  }

  t(key: string, params?: Record<string, string | number>): string {
    this.versionCatalogo();
    const idioma = this.localeSignal();
    const plantilla = CATALOGOS[idioma]?.[key] ?? CATALOGOS.es[key] ?? key;

    if (!params) {
      return plantilla;
    }

    return plantilla.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (coincidencia, nombre) => {
      const valor = params[nombre];
      return valor !== undefined && valor !== null ? String(valor) : coincidencia;
    });
  }

  establecerIdiomaLocal(idioma: IdiomaSoportado | string): IdiomaSoportado {
    const normalizado = normalizarIdioma(idioma, 'es');
    this.guardarLocaleLocal(normalizado);
    this.aplicarLocale(normalizado);
    return normalizado;
  }

  sincronizarDesdeUsuario(idioma?: IdiomaSoportado | string | null): IdiomaSoportado {
    const normalizado = normalizarIdioma(idioma, 'es');
    this.aplicarLocale(normalizado);
    return normalizado;
  }

  alCerrarSesion(): IdiomaSoportado {
    const preAuth = this.detectarLocalePreAuth();
    this.aplicarLocale(preAuth);
    return preAuth;
  }

  async guardarIdiomaUsuario(idioma: IdiomaSoportado | string): Promise<IdiomaSoportado> {
    const normalizado = normalizarIdioma(idioma, 'es');
    if (!this.http) {
      throw new Error('HttpClient no disponible para guardar el idioma en el servidor.');
    }

    const respuesta = await firstValueFrom(
      this.http.put<{ idioma: IdiomaSoportado }>(`${obtenerBaseApi()}/perfil/idioma`, {
        idioma: normalizado,
      })
    );

    const confirmado = normalizarIdioma(respuesta?.idioma, normalizado);
    await this.asegurarCatalogosIdioma(confirmado);
    this.aplicarLocale(confirmado);
    return confirmado;
  }

  async cargarPreferenciasUsuario(): Promise<IdiomaSoportado> {
    if (!this.http) {
      return this.localeSignal();
    }

    const respuesta = await firstValueFrom(
      this.http.get<{ idioma: IdiomaSoportado }>(`${obtenerBaseApi()}/perfil/idioma`)
    );

    const confirmado = normalizarIdioma(respuesta?.idioma, 'es');
    this.aplicarLocale(confirmado);
    return confirmado;
  }

  formatearFecha(
    fecha: Date | string | number | null | undefined,
    opciones: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
  ): string {
    const date = this.convertirAFecha(fecha);
    if (!date) return '';
    return new Intl.DateTimeFormat(this.bcp47(), opciones).format(date);
  }

  formatearFechaHora(
    fecha: Date | string | number | null | undefined,
    opciones: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
  ): string {
    const date = this.convertirAFecha(fecha);
    if (!date) return '';
    return new Intl.DateTimeFormat(this.bcp47(), opciones).format(date);
  }

  formatearNumero(
    valor: number | string | null | undefined,
    opciones?: Intl.NumberFormatOptions
  ): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const numero = typeof valor === 'number' ? valor : Number(valor);
    if (!Number.isFinite(numero)) return '';
    return new Intl.NumberFormat(this.bcp47(), opciones).format(numero);
  }

  formatearMoneda(
    valor: number | string | null | undefined,
    moneda = 'PAB',
    opciones?: Intl.NumberFormatOptions
  ): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const numero = typeof valor === 'number' ? valor : Number(valor);
    if (!Number.isFinite(numero)) return '';
    const codigoMoneda = (moneda || 'PAB').trim().toUpperCase() || 'PAB';
    return new Intl.NumberFormat(this.bcp47(), {
      style: 'currency',
      currency: codigoMoneda,
      ...opciones,
    }).format(numero);
  }

  private aplicarLocale(idioma: IdiomaSoportado): void {
    if (this.localeSignal() !== idioma) {
      this.localeSignal.set(idioma);
      this.localeSubject.next(idioma);
    }
    this.aplicarAtributoDocumento(idioma);
    void this.asegurarCatalogosIdioma(idioma);
  }

  private aplicarAtributoDocumento(idioma: IdiomaSoportado): void {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = idioma;
    }
  }

  private detectarLocalePreAuth(): IdiomaSoportado {
    try {
      if (typeof localStorage !== 'undefined') {
        const guardado = localStorage.getItem(CLAVE_IDIOMA_LOCAL);
        if (esIdiomaSoportado(guardado)) {
          return guardado;
        }
      }
    } catch {
      // Ignorar errores de acceso a localStorage en entornos restringidos
    }

    if (typeof navigator !== 'undefined' && navigator.language) {
      return normalizarIdioma(navigator.language, 'es');
    }

    return 'es';
  }

  private guardarLocaleLocal(idioma: IdiomaSoportado): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CLAVE_IDIOMA_LOCAL, idioma);
      }
    } catch {
      // Ignorar errores de almacenamiento local
    }
  }

  private convertirAFecha(fecha: Date | string | number | null | undefined): Date | null {
    if (fecha === null || fecha === undefined || fecha === '') return null;
    const instancia = fecha instanceof Date ? fecha : new Date(fecha);
    return Number.isNaN(instancia.getTime()) ? null : instancia;
  }
}
