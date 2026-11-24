import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TPipe } from '../shared/t.pipe';

@Component({ selector: 'app-not-found', standalone: true, imports: [RouterLink, TPipe],
  template: `<main class="standard"><section class="collection"><div class="page-title"><div><p class="eyebrow">{{ 'publico.notFound.eyebrow' | t }}</p><h1>{{ 'publico.notFound.titulo' | t }}</h1><p>{{ 'publico.notFound.subtitulo' | t }}</p></div><a class="btn-primary" routerLink="/dashboard">{{ 'publico.notFound.volver' | t }}</a></div></section></main>`
})
export class NotFoundComponent {}
