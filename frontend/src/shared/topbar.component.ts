import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiStateService } from '../state/ui-state.service';
import { AuthService } from '../auth/auth.service';
import { OrganizacionService } from '../auth/organizacion.service';
import { I18nService } from '../state/i18n.service';
import { IdiomaSoportado } from '../i18n/i18n.types';
import { TPipe } from './t.pipe';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TPipe],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.css']
})
export class TopbarComponent {
  public readonly i18n = inject(I18nService);
  menuAbierto = false;
  cambiandoIdioma = false;
  errorIdiomaKey = '';

  constructor(
    public state: UiStateService,
    public auth: AuthService,
    public orgService: OrganizacionService
  ) {}

  async cambiarIdiomaCuenta(codigo: IdiomaSoportado): Promise<void> {
    if (this.cambiandoIdioma || this.i18n.locale() === codigo) return;
    this.cambiandoIdioma = true;
    this.errorIdiomaKey = '';
    try {
      const confirmado = await this.i18n.guardarIdiomaUsuario(codigo);
      this.auth.actualizarIdiomaLocal(confirmado);
    } catch {
      this.errorIdiomaKey = 'publico.topbar.idiomaError';
    } finally {
      this.cambiandoIdioma = false;
    }
  }

  get esFotografia(): boolean {
    return this.orgService.tipoFreelance === 'FOTOGRAFIA';
  }

  navegarInicio(): void {
    if (this.esFotografia) {
      this.state.navigate('clientes');
    } else {
      this.state.navigate('hoy');
    }
  }

  get iniciales(): string {
    return this.obtenerIniciales();
  }

  obtenerIniciales(): string {
    const usuario = this.auth.sesion?.usuario;
    if (usuario?.nombre) {
      const p1 = usuario.nombre.trim()[0] || '';
      const p2 = usuario.apellido?.trim() ? usuario.apellido.trim()[0] : (usuario.nombre.trim()[1] || '');
      return (p1 + p2).toUpperCase();
    }
    if (usuario?.correo) {
      return usuario.correo.substring(0, 2).toUpperCase();
    }
    return 'EQ';
  }

  toggleMenu(evento: Event): void {
    evento.stopPropagation();
    this.menuAbierto = !this.menuAbierto;
    if (this.menuAbierto) {
      this.state.notificationsOpen = false;
      this.state.mobileMenuOpen = false;
    }
  }

  toggleNotificaciones(evento: Event): void {
    evento.stopPropagation();
    this.state.toggleNotifications();
    if (this.state.notificationsOpen) {
      this.menuAbierto = false;
      this.state.mobileMenuOpen = false;
    }
  }

  toggleMenuMovil(evento: Event): void {
    evento.stopPropagation();
    this.state.mobileMenuOpen = !this.state.mobileMenuOpen;
    if (this.state.mobileMenuOpen) {
      this.menuAbierto = false;
      this.state.notificationsOpen = false;
    }
  }

  irAConfiguracion(): void {
    this.menuAbierto = false;
    this.state.navigate('configuracion');
  }

  navegarMobile(pagina: 'hoy' | 'clientes' | 'proyectos' | 'tareas' | 'finanzas' | 'configuracion'): void {
    this.state.mobileMenuOpen = false;
    this.menuAbierto = false;
    this.state.navigate(pagina);
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  cerrarMenu(): void {
    this.menuAbierto = false;
    this.state.mobileMenuOpen = false;
    this.state.notificationsOpen = false;
  }
}
