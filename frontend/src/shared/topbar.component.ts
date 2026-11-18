import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';
import { AuthService } from '../auth/auth.service';
import { OrganizacionService } from '../auth/organizacion.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.css']
})
export class TopbarComponent {
  constructor(
    public state: UiStateService,
    public auth: AuthService,
    public orgService: OrganizacionService
  ) {}

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
}
