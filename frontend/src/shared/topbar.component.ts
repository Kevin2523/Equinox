import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiStateService } from '../state/ui-state.service';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './topbar.component.html'
})
export class TopbarComponent {
  menuAbierto = false;

  constructor(public state: UiStateService, public auth: AuthService) {}

  get iniciales(): string {
    const usuario = this.auth.sesion?.usuario;
    return `${usuario?.nombre?.slice(0, 1) ?? ''}${usuario?.apellido?.slice(0, 1) ?? ''}`.toUpperCase();
  }

  toggleMenu(evento: Event): void {
    evento.stopPropagation();
    this.menuAbierto = !this.menuAbierto;
  }

  irAConfiguracion(): void {
    this.menuAbierto = false;
    this.state.navigate('configuracion');
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  cerrarMenu(): void {
    this.menuAbierto = false;
  }
}
