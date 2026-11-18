import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-client-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <header class="topnav client-shell-nav" role="banner">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><i></i></span>
        <strong>equinox</strong>
      </div>
      <span class="client-shell-title">Portal del cliente</span>
      <div class="client-shell-user">
        <span class="client-avatar" aria-hidden="true">{{ inicialUsuario }}</span>
        <span class="client-name">{{ nombreUsuario }}</span>
        <span class="client-divider" aria-hidden="true"></span>
        <button type="button" class="client-logout-btn" (click)="salir()" [disabled]="saliendo">
          {{ saliendo ? 'Cerrando…' : 'Cerrar sesión' }}
        </button>
      </div>
    </header>
    <section class="auth-logout-error" role="alert" *ngIf="errorCierre">
      <p>No se pudo confirmar el cierre de sesión en el servidor. Tu sesión podría seguir activa.</p>
      <button type="button" class="btn-primary" (click)="salir()" [disabled]="saliendo">Reintentar cierre</button>
      <button type="button" class="btn-secondary" (click)="confirmarSalidaLocal()" *ngIf="!salidaLocalPendiente">Cerrar solo en este navegador</button>
      <div *ngIf="salidaLocalPendiente">
        <p>El acceso remoto podría continuar activo. ¿Quieres eliminar solo la sesión de este navegador?</p>
        <button type="button" class="btn-primary" (click)="salirSoloLocal()">Confirmar salida local</button>
        <button type="button" class="btn-secondary" (click)="salidaLocalPendiente = false">Cancelar</button>
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
    }
    .client-divider {
      width: 1px;
      height: 20px;
      background: #d8d4cb;
      margin: 0 4px;
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
    @media (max-width: 780px) {
      .client-shell-nav {
        grid-template-columns: auto 1fr;
        grid-template-rows: auto;
        height: 60px;
        padding: 0 18px;
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
    }
    @media (max-width: 480px) {
      .client-avatar {
        width: 28px;
        height: 28px;
        font-size: 12px;
      }
      .client-name {
        max-width: 90px;
        font-size: 13px;
      }
      .client-logout-btn {
        font-size: 12.5px;
      }
    }
  `]
})
export class ClientShellComponent {
  saliendo = false;
  errorCierre = false;
  salidaLocalPendiente = false;

  constructor(public auth: AuthService) {}

  get inicialUsuario(): string {
    const nombre = this.auth.sesion?.usuario?.nombre?.trim();
    return nombre ? nombre.charAt(0).toLowerCase() : 'c';
  }

  get nombreUsuario(): string {
    return this.auth.sesion?.usuario?.nombre || 'Cliente';
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
