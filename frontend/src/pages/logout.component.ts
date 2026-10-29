import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-logout', standalone: true, imports: [CommonModule, RouterLink],
  template: `<main class="auth-layout"><section class="auth-card">
    <h1>{{ cargando ? 'Cerrando sesión…' : 'Cerrar sesión' }}</h1>
    <div *ngIf="error" role="alert">
      <p>No se pudo confirmar el cierre de sesión en el servidor. Tu sesión podría seguir activa.</p>
      <button type="button" class="btn-primary" (click)="intentar()" [disabled]="cargando">Reintentar cierre</button>
      <button type="button" class="btn-secondary" (click)="confirmarSalidaLocal()" *ngIf="!salidaLocalPendiente">Cerrar solo en este navegador</button>
      <div *ngIf="salidaLocalPendiente">
        <p>El acceso remoto podría continuar activo. ¿Quieres eliminar solo la sesión de este navegador?</p>
        <button type="button" class="btn-primary" (click)="salirSoloLocal()">Confirmar salida local</button>
        <button type="button" class="btn-secondary" (click)="salidaLocalPendiente = false">Cancelar</button>
      </div>
    </div>
    <a routerLink="/dashboard" *ngIf="error">Volver al espacio de trabajo</a>
  </section></main>`
})
export class LogoutComponent implements OnInit {
  error = false;
  cargando = false;
  salidaLocalPendiente = false;
  constructor(private auth: AuthService) {}
  ngOnInit(): void { void this.intentar(); }
  async intentar(): Promise<void> {
    if (this.cargando) return;
    this.cargando = true;
    this.error = false;
    this.salidaLocalPendiente = false;
    try { await this.auth.cerrar(); } catch { this.error = true; }
    finally { this.cargando = false; }
  }
  confirmarSalidaLocal(): void { this.salidaLocalPendiente = true; }
  async salirSoloLocal(): Promise<void> {
    if (!this.salidaLocalPendiente) return;
    await this.auth.cerrarSoloLocal();
  }
}
