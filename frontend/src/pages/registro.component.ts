import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { API_ORIGIN } from '../auth/api.config';

@Component({
  selector: 'app-registro', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<main class="auth-layout"><section class="auth-card">
    <div class="auth-brand"><span class="brand-mark"><i></i></span><strong>equinox</strong></div>
    <p class="eyebrow">TU ESPACIO DE TRABAJO</p><h1>Crea tu cuenta</h1>
    <p class="auth-intro">Registra tu estudio y empieza a organizar tus proyectos.</p>
    <p class="auth-error" role="alert" *ngIf="!apiDisponible">La API no está configurada para este entorno. Contacta al administrador de Equinox.</p>
    <form #form="ngForm" (ngSubmit)="registrar(form)">
      <div class="form-group"><label for="nombre">Nombre</label><input id="nombre" class="form-control" name="nombre" [(ngModel)]="datos.nombre" required minlength="2" autocomplete="given-name"></div>
      <div class="form-group"><label for="apellido">Apellido (opcional)</label><input id="apellido" class="form-control" name="apellido" [(ngModel)]="datos.apellido" autocomplete="family-name"></div>
      <div class="form-group"><label for="correo-registro">Correo</label><input id="correo-registro" class="form-control" type="email" name="correo" [(ngModel)]="datos.correo" required email autocomplete="email"></div>
      <div class="form-group"><label for="clave-registro">Contraseña</label><input id="clave-registro" class="form-control" type="password" name="contrasena" [(ngModel)]="datos.contrasena" required minlength="8" autocomplete="new-password"><small>Al menos 8 caracteres.</small></div>
      <div class="form-group"><label for="estudio">Nombre del estudio</label><input id="estudio" class="form-control" name="nombreEstudio" [(ngModel)]="datos.nombreEstudio" required minlength="2"></div>
      <div class="form-group"><label for="slug">Identificador del estudio</label><input id="slug" class="form-control" name="slug" [(ngModel)]="datos.slug" required minlength="2" pattern="[a-z0-9-]+" placeholder="mi-estudio"><small>Solo minúsculas, números y guiones.</small></div>
      <p class="auth-validation" *ngIf="enviado && form.invalid">Revisa los campos obligatorios y su formato.</p>
      <p class="auth-error" role="alert" *ngIf="error">{{ error }}</p>
      <button class="btn-primary auth-submit" type="submit" [disabled]="cargando">{{ cargando ? 'Creando cuenta…' : 'Crear cuenta' }}</button>
    </form>
    <div class="auth-links"><a routerLink="/inicio-sesion">Ya tengo cuenta</a></div>
  </section></main>`
})
export class RegistroComponent {
  readonly apiDisponible = !!API_ORIGIN;
  datos = { correo: '', contrasena: '', nombre: '', apellido: '', nombreEstudio: '', slug: '' };
  cargando = false;
  enviado = false;
  error = '';
  constructor(private auth: AuthService, private router: Router) {}
  async registrar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || this.cargando) return;
    this.cargando = true; this.error = '';
    try {
      await this.auth.registrar(this.datos);
      this.datos.contrasena = '';
      await this.router.navigateByUrl(this.auth.rutaInicial());
    } catch (error: any) {
      this.error = error?.status === 409 ? 'El correo o identificador del estudio ya está en uso.'
        : error?.status === 422 ? 'Revisa los datos del formulario.'
        : API_ORIGIN ? 'No se pudo crear la cuenta. Comprueba tu conexión e inténtalo de nuevo.'
        : 'La API de este entorno no está configurada. Contacta al administrador de Equinox.';
    } finally { this.cargando = false; }
  }
}
