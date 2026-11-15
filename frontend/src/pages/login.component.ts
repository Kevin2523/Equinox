import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ConflictoContextos, OpcionContexto, SeleccionContexto } from '../auth/auth.model';
import { API_ORIGIN } from '../auth/api.config';

@Component({
  selector: 'app-login', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<main class="auth-layout"><section class="auth-card">
    <div class="auth-brand"><span class="brand-mark"><i></i></span><strong>equinox</strong></div>
    <p class="eyebrow">BIENVENIDO DE NUEVO</p><h1>Inicia sesión</h1>
    <p class="auth-intro">Accede a tu espacio de trabajo o portal.</p>
    <p class="auth-error" role="alert" *ngIf="!apiDisponible">La API no está configurada para este entorno. Contacta al administrador de Equinox.</p>
    <form #form="ngForm" (ngSubmit)="entrar(form)" *ngIf="!opciones.length">
      <div class="form-group"><label for="correo">Correo</label>
        <input id="correo" class="form-control" type="email" name="correo" [(ngModel)]="correo" required email autocomplete="username" #correoControl="ngModel">
        <small class="auth-validation" *ngIf="correoControl.invalid && (correoControl.touched || enviado)">Introduce un correo válido.</small></div>
      <div class="form-group"><label for="contrasena">Contraseña</label>
        <input id="contrasena" class="form-control" type="password" name="contrasena" [(ngModel)]="contrasena" required autocomplete="current-password" #claveControl="ngModel">
        <small class="auth-validation" *ngIf="claveControl.invalid && (claveControl.touched || enviado)">Introduce tu contraseña.</small></div>
      <p class="auth-error" role="alert" *ngIf="error">{{ error }}</p>
      <button class="btn-primary auth-submit" type="submit" [disabled]="cargando">{{ cargando ? 'Validando…' : 'Entrar' }}</button>
    </form>
    <div *ngIf="opciones.length" class="context-options">
      <h2>Selecciona tu acceso</h2><p>Tu cuenta tiene más de un contexto disponible.</p>
      <button class="context-option" type="button" *ngFor="let opcion of opciones" (click)="seleccionar(opcion)" [disabled]="cargando">
        <b>{{ opcion.tipoAcceso === 'ORGANIZACION' ? opcion.organizacion.nombre : opcion.cliente?.nombre }}</b>
        <small>{{ opcion.tipoAcceso === 'ORGANIZACION' ? 'Espacio de trabajo' : 'Portal del cliente' }} · {{ opcion.rol }}</small>
      </button>
      <p class="auth-error" role="alert" *ngIf="error">{{ error }}</p>
      <button class="auth-text-link" type="button" (click)="volver()">Usar otra cuenta</button>
    </div>
    <div class="auth-links"><a routerLink="/recuperar-contrasena">¿Olvidaste tu contraseña?</a><a routerLink="/registro">Crear cuenta</a></div>
  </section></main>`
})
export class LoginComponent {
  readonly apiDisponible = !!API_ORIGIN;
  correo = '';
  contrasena = '';
  enviado = false;
  cargando = false;
  error = '';
  opciones: OpcionContexto[] = [];
  constructor(private auth: AuthService, private router: Router) {}

  async entrar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || this.cargando) return;
    await this.iniciar();
  }

  async seleccionar(opcion: OpcionContexto): Promise<void> {
    if (this.cargando) return;
    const seleccion: SeleccionContexto = opcion.tipoAcceso === 'ORGANIZACION'
      ? { tipoAcceso: 'ORGANIZACION', organizacionId: opcion.organizacionId }
      : { tipoAcceso: 'CLIENTE', organizacionId: opcion.organizacionId, clienteId: opcion.clienteId! };
    await this.iniciar(seleccion);
  }

  volver(): void { this.opciones = []; this.contrasena = ''; this.error = ''; this.enviado = false; }

  private async iniciar(seleccion?: SeleccionContexto): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      await this.auth.iniciar(this.correo, this.contrasena, seleccion);
      this.contrasena = '';
      await this.router.navigateByUrl(this.auth.rutaInicial());
    } catch (error: any) {
      const conflicto = error?.error as ConflictoContextos | undefined;
      if (error?.status === 409 && conflicto?.contextos && Array.isArray(conflicto.contextos.organizaciones) && Array.isArray(conflicto.contextos.clientes)) {
        this.opciones = [...conflicto.contextos.organizaciones, ...conflicto.contextos.clientes];
      } else if (error?.status === 401) {
        this.error = 'Correo o contraseña incorrectos.';
      } else if (error?.status === 403) {
        this.error = 'No tienes acceso al contexto seleccionado.';
      } else {
        this.error = API_ORIGIN ? 'No se pudo iniciar sesión. Comprueba tu conexión e inténtalo de nuevo.'
          : 'La API de este entorno no está configurada. Contacta al administrador de Equinox.';
      }
    } finally { this.cargando = false; }
  }
}
