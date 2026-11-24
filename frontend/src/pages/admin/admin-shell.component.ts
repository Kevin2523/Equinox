import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { IdiomaSoportado } from '../../i18n/i18n.types';
import { TPipe } from '../../shared/t.pipe';
import { I18nService } from '../../state/i18n.service';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TPipe],
  templateUrl: './admin-shell.component.html',
  styleUrls: ['./admin-shell.component.css']
})
export class AdminShellComponent {
  readonly i18n = inject(I18nService);

  menuMovilAbierto = false;
  cerrandoSesion = false;
  guardandoIdioma = false;
  errorIdioma = '';

  readonly enlaces = [
    { ruta: '/admin/resumen', clave: 'admin.shell.nav.resumen' },
    { ruta: '/admin/organizaciones', clave: 'admin.shell.nav.organizaciones' },
    { ruta: '/admin/usuarios', clave: 'admin.shell.nav.usuarios' },
    { ruta: '/admin/suscripciones', clave: 'admin.shell.nav.suscripciones' },
    { ruta: '/admin/auditoria', clave: 'admin.shell.nav.auditoria' }
  ];

  constructor(public auth: AuthService) {}

  @HostListener('document:keydown.escape')
  alPresionarEscape(): void {
    this.menuMovilAbierto = false;
  }

  async cambiarIdioma(nuevoIdioma: IdiomaSoportado, selectEl?: HTMLSelectElement): Promise<void> {
    if (this.guardandoIdioma || nuevoIdioma === this.i18n.idiomaActual) {
      return;
    }

    const anterior = this.i18n.idiomaActual;
    this.guardandoIdioma = true;
    this.errorIdioma = '';

    try {
      const confirmado = await this.i18n.guardarIdiomaUsuario(nuevoIdioma);
      this.auth.actualizarIdiomaLocal(confirmado);
    } catch {
      if (selectEl) {
        selectEl.value = anterior;
      }
      this.errorIdioma = this.i18n.t('admin.shell.idiomaError');
      setTimeout(() => {
        this.errorIdioma = '';
      }, 4000);
    } finally {
      this.guardandoIdioma = false;
    }
  }

  obtenerIniciales(): string {
    const u = this.auth.sesion?.usuario;
    if (!u) return 'AD';
    const p1 = u.nombre?.trim()[0] || '';
    const p2 = u.apellido?.trim()[0] || u.nombre?.trim()[1] || '';
    return (p1 + p2).toUpperCase() || 'AD';
  }

  async cerrarSesion(): Promise<void> {
    if (this.cerrandoSesion) return;
    this.cerrandoSesion = true;
    try {
      await this.auth.cerrar('/admin/acceso');
    } catch {
      await this.auth.cerrarSoloLocal('/admin/acceso');
    } finally {
      this.cerrandoSesion = false;
    }
  }
}
