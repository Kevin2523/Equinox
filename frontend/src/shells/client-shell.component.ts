import { CommonModule } from '@angular/common';
import { Component, Optional } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import {
  IDIOMAS_SOPORTADOS,
  IdiomaSoportado,
  METADATA_IDIOMAS,
  MetadataIdioma,
  esIdiomaSoportado,
} from '../i18n/i18n.types';
import { TPipe } from '../shared/t.pipe';
import { I18nService } from '../state/i18n.service';

@Component({
  selector: 'app-client-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, TPipe],
  template: `
    <header class="topnav client-shell-nav" role="banner">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><i></i></span>
        <strong>equinox</strong>
      </div>
      <span class="client-shell-title">{{ 'portal.shell.titulo' | t }}</span>
      <div class="client-shell-user">
        <span class="client-avatar" aria-hidden="true">{{ inicialUsuario }}</span>
        <span class="client-name">{{ nombreUsuario }}</span>
        <span class="client-divider" aria-hidden="true"></span>
        <select
          class="client-lang-select"
          [value]="idiomaActual"
          [disabled]="guardandoIdioma || saliendo"
          [attr.aria-label]="'portal.shell.idiomaAria' | t"
          [title]="'portal.shell.idiomaAria' | t"
          (change)="cambiarIdioma($any($event.target).value, $any($event.target))"
        >
          <option *ngFor="let lang of idiomasDisponibles" [value]="lang.codigo">
            {{ lang.etiquetaCorta }}
          </option>
        </select>
        <button type="button" class="client-logout-btn" (click)="salir()" [disabled]="saliendo">
          {{ (saliendo ? 'portal.shell.cerrando' : 'portal.shell.cerrarSesion') | t }}
        </button>
      </div>
    </header>
    <div class="client-lang-error" role="alert" *ngIf="errorIdioma">
      <span>{{ errorIdioma }}</span>
      <button type="button" class="client-lang-error-close" (click)="errorIdioma = ''" [attr.aria-label]="'portal.comun.cerrar' | t">✕</button>
    </div>
    <section class="auth-logout-error" role="alert" *ngIf="errorCierre">
      <p>{{ 'portal.shell.errorCierre' | t }}</p>
      <button type="button" class="btn-primary" (click)="salir()" [disabled]="saliendo">{{ 'portal.shell.reintentarCierre' | t }}</button>
      <button type="button" class="btn-secondary" (click)="confirmarSalidaLocal()" *ngIf="!salidaLocalPendiente">{{ 'portal.shell.cerrarSoloLocal' | t }}</button>
      <div *ngIf="salidaLocalPendiente">
        <p>{{ 'portal.shell.confirmarSalidaLocalTexto' | t }}</p>
        <button type="button" class="btn-primary" (click)="salirSoloLocal()">{{ 'portal.shell.confirmarSalidaLocalBtn' | t }}</button>
        <button type="button" class="btn-secondary" (click)="salidaLocalPendiente = false">{{ 'portal.comun.cancelar' | t }}</button>
      </div>
    </section>
    <router-outlet></router-outlet>
  `,
  styles: [`
    :host {
      display: block;
      background-color: #faf8f5;
      min-height: 100vh;
    }
    .client-shell-nav {
      background: #faf8f5;
      border-bottom: 1px solid #ebe8e2;
      height: 64px;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      padding: 0 40px;
      position: sticky;
      top: 0;
      z-index: 40;
    }
    .client-shell-title {
      font-size: 14px;
      font-weight: 500;
      color: #374151;
      text-align: center;
      letter-spacing: -0.01em;
    }
    .client-shell-user {
      justify-self: end;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .client-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #8b978f;
      color: #ffffff;
      display: grid;
      place-items: center;
      font-size: 14px;
      font-weight: 600;
      user-select: none;
      flex-shrink: 0;
    }
    .client-name {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      letter-spacing: -0.01em;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .client-divider {
      width: 1px;
      height: 20px;
      background: #d8d4cb;
      margin: 0 4px;
    }
    .client-lang-select {
      height: 30px;
      padding: 0 8px;
      border: 1px solid #d8d4cb;
      border-radius: 6px;
      background: #ffffff;
      color: #1f2937;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      cursor: pointer;
      flex-shrink: 0;
      transition: border-color 0.15s ease, opacity 0.15s ease;
    }
    .client-lang-select:hover:not(:disabled) {
      border-color: #9ca3af;
    }
    .client-lang-select:focus-visible {
      outline: 2px solid var(--blue, #3568f6);
      outline-offset: 2px;
    }
    .client-lang-select:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .client-lang-error {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 8px 16px;
      background: #fef2f2;
      border-bottom: 1px solid #fecaca;
      color: #991b1b;
      font-size: 13px;
    }
    .client-lang-error-close {
      background: transparent;
      border: none;
      color: #991b1b;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .client-logout-btn {
      background: transparent;
      border: none;
      font-size: 13.5px;
      font-weight: 500;
      color: #1f2937;
      cursor: pointer;
      padding: 6px 4px;
      border-radius: 4px;
      transition: color 0.15s ease, opacity 0.15s ease;
      white-space: nowrap;
    }
    .client-logout-btn:hover:not(:disabled) {
      color: #000000;
      text-decoration: underline;
    }
    .client-logout-btn:focus-visible {
      outline: 2px solid var(--blue, #3568f6);
      outline-offset: 2px;
    }
    .client-logout-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    @media (max-width: 900px) {
      .client-shell-nav {
        padding: 0 24px;
      }
      .client-name {
        max-width: 150px;
      }
    }
    @media (max-width: 780px) {
      .client-shell-nav {
        grid-template-columns: auto 1fr;
        grid-template-rows: auto;
        height: 60px;
        padding: 0 max(18px, env(safe-area-inset-right)) 0 max(18px, env(safe-area-inset-left));
        gap: 12px;
      }
      .client-shell-title {
        display: none;
      }
      .client-shell-user {
        gap: 8px;
      }
      .client-name {
        max-width: 130px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .client-divider {
        display: none;
      }
      .client-logout-btn {
        min-height: 40px;
        padding: 8px 10px;
        display: inline-flex;
        align-items: center;
      }
    }
    @media (max-width: 480px) {
      .client-shell-nav {
        padding: 0 max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
        gap: 8px;
      }
      .client-avatar {
        width: 28px;
        height: 28px;
        font-size: 12px;
      }
      .client-name {
        max-width: 68px;
        font-size: 13px;
      }
      .client-lang-select {
        min-height: 36px;
        padding: 0 6px;
        font-size: 11.5px;
      }
      .client-logout-btn {
        min-height: 44px;
        padding: 8px 6px;
        font-size: 12.5px;
      }
    }
    @media (max-width: 360px) {
      .client-shell-user {
        gap: 4px;
      }
      .client-name {
        max-width: 52px;
      }
      .client-logout-btn {
        padding: 8px 4px;
        font-size: 12px;
      }
    }
  `]
})
export class ClientShellComponent {
  saliendo = false;
  errorCierre = false;
  salidaLocalPendiente = false;
  guardandoIdioma = false;
  errorIdioma = '';

  readonly idiomasDisponibles: readonly MetadataIdioma[] = IDIOMAS_SOPORTADOS.map(
    (codigo) => METADATA_IDIOMAS[codigo]
  );

  constructor(
    public auth: AuthService,
    @Optional() public i18n?: I18nService
  ) {}

  get idiomaActual(): IdiomaSoportado {
    return this.i18n?.idiomaActual ?? 'es';
  }

  private t(key: string, fallback: string): string {
    return this.i18n?.t(key) ?? fallback;
  }

  get inicialUsuario(): string {
    const nombre = this.auth.sesion?.usuario?.nombre?.trim();
    return nombre ? nombre.charAt(0).toLowerCase() : 'c';
  }

  get nombreUsuario(): string {
    return this.auth.sesion?.usuario?.nombre || this.t('portal.comun.cliente', 'Cliente');
  }

  /**
   * Guarda el idioma preferido exclusivamente para la cuenta portal autenticada,
   * sin escribir el locale público en localStorage ni alterar la organización.
   */
  async cambiarIdioma(nuevoIdioma: string, selectEl?: HTMLSelectElement): Promise<void> {
    if (!esIdiomaSoportado(nuevoIdioma) || this.guardandoIdioma || !this.i18n) {
      return;
    }
    if (nuevoIdioma === this.i18n.idiomaActual) {
      return;
    }

    const anterior = this.i18n.idiomaActual;
    this.guardandoIdioma = true;
    this.errorIdioma = '';

    try {
      const confirmado = await this.i18n.guardarIdiomaUsuario(nuevoIdioma);
      this.auth.actualizarIdiomaLocal(confirmado);
    } catch {
      if (selectEl) {
        selectEl.value = anterior;
      }
      this.errorIdioma = this.t('portal.shell.errorIdioma', 'No se pudo guardar tu preferencia de idioma.');
    } finally {
      this.guardandoIdioma = false;
    }
  }

  async salir(): Promise<void> {
    if (this.saliendo) return;
    this.saliendo = true;
    this.errorCierre = false;
    this.salidaLocalPendiente = false;
    try { await this.auth.cerrar(); } catch { this.errorCierre = true; }
    finally { this.saliendo = false; }
  }

  confirmarSalidaLocal(): void { this.salidaLocalPendiente = true; }

  async salirSoloLocal(): Promise<void> {
    if (!this.salidaLocalPendiente) return;
    await this.auth.cerrarSoloLocal();
  }
}
