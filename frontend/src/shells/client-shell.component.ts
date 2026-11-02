import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-client-shell', standalone: true, imports: [CommonModule, RouterOutlet],
  template: `<header class="topnav client-shell-nav">
    <div class="brand"><span class="brand-mark"><i></i></span><strong>equinox</strong></div>
    <span>Portal del cliente</span>
    <button type="button" class="btn-secondary" (click)="salir()" [disabled]="saliendo">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
      <span>{{ saliendo ? 'Cerrando…' : 'Cerrar sesión' }}</span>
    </button>
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
  <router-outlet></router-outlet>`
})
export class ClientShellComponent {
  saliendo = false;
  errorCierre = false;
  salidaLocalPendiente = false;
  constructor(public auth: AuthService) {}
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
