import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-shell.component.html',
  styleUrls: ['./admin-shell.component.css']
})
export class AdminShellComponent {
  menuMovilAbierto = false;
  cerrandoSesion = false;

  readonly enlaces = [
    { ruta: '/admin/resumen', etiqueta: 'Resumen' },
    { ruta: '/admin/organizaciones', etiqueta: 'Organizaciones' },
    { ruta: '/admin/usuarios', etiqueta: 'Usuarios y accesos' },
    { ruta: '/admin/suscripciones', etiqueta: 'Suscripciones' },
    { ruta: '/admin/auditoria', etiqueta: 'Auditoría' }
  ];

  constructor(public auth: AuthService) {}

  @HostListener('document:keydown.escape')
  alPresionarEscape(): void {
    this.menuMovilAbierto = false;
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
