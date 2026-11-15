import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({ selector: 'app-not-found', standalone: true, imports: [RouterLink],
  template: '<main class="standard"><section class="collection"><div class="page-title"><div><p class="eyebrow">EQUINOX</p><h1>Página no encontrada</h1><p>La ruta solicitada no existe.</p></div><a class="btn-primary" routerLink="/dashboard">Volver al mapa</a></div></section></main>'
})
export class NotFoundComponent {}
