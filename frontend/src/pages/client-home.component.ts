import { Component } from '@angular/core';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-client-home', standalone: true,
  template: `<main class="standard"><section class="collection">
    <div class="page-title"><div><p class="eyebrow">PORTAL DEL CLIENTE</p>
      <h1>Hola, {{ auth.sesion?.usuario?.nombre }}</h1>
      <p>Tu sesión de cliente está activa.</p></div></div>
    <div class="auth-notice">El contenido autenticado del portal estará disponible cuando se integre su API. Esta vista no muestra datos de demostración como datos de tu cuenta.</div>
  </section></main>`
})
export class ClientHomeComponent { constructor(public auth: AuthService) {} }
