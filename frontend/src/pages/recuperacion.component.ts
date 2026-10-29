import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-recuperacion', standalone: true, imports: [RouterLink],
  template: `<main class="auth-layout"><section class="auth-card">
    <div class="auth-brand"><span class="brand-mark"><i></i></span><strong>equinox</strong></div>
    <p class="eyebrow">ACCESO A TU CUENTA</p><h1>Recuperar contraseña</h1>
    <p class="auth-intro">La recuperación de contraseña aún no está disponible. Todavía no existe un canal de envío configurado.</p>
    <a class="btn-primary auth-submit" routerLink="/inicio-sesion">Volver al inicio de sesión</a>
  </section></main>`
})
export class RecuperacionComponent {}
