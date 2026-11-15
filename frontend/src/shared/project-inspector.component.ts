import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesProyectosApiService, EstadoProyectoApi, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-project-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-inspector.component.html',
  styleUrls: ['./project-inspector.component.css']
})
export class ProjectInspectorComponent {
  constructor(public api: ClientesProyectosApiService, private router: Router) {}

  nuevoProyecto(): void {
    void this.router.navigate(['/proyectos']);
  }

  editar(id: string): void {
    void this.router.navigate(['/proyectos'], { queryParams: { editar: id } });
  }

  verEnProyectos(id: string): void {
    void this.router.navigate(['/proyectos'], { queryParams: { proyecto: id } });
  }

  verCliente(clienteId?: string): void {
    if (clienteId) {
      void this.router.navigate(['/clientes'], { queryParams: { cliente: clienteId } });
    }
  }

  obtenerIniciales(nombre?: string | null): string {
    if (!nombre) return 'P';
    const partes = nombre.trim().split(/\s+/);
    if (partes.length >= 2) {
      return (partes[0][0] + partes[1][0]).toUpperCase();
    }
    return nombre.substring(0, 2).toUpperCase();
  }

  claseEstado(estado: EstadoProyectoApi): string {
    return `status-${(estado || 'BORRADOR').toLowerCase()}`;
  }

  calcularPorcentajeTiempo(proyecto: ProyectoApi): number {
    if (!proyecto.fechaInicio || !proyecto.fechaEntrega) return 0;
    const inicio = new Date(proyecto.fechaInicio).getTime();
    const fin = new Date(proyecto.fechaEntrega).getTime();
    const hoy = Date.now();

    if (fin <= inicio) return 100;
    if (hoy <= inicio) return 0;
    if (hoy >= fin) return 100;

    const pct = Math.round(((hoy - inicio) / (fin - inicio)) * 100);
    return Math.min(Math.max(pct, 0), 100);
  }

  diasRestantes(fechaEntrega?: string | null): string | null {
    if (!fechaEntrega) return null;
    const fin = new Date(fechaEntrega).getTime();
    const hoy = Date.now();
    const diffDias = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));

    if (diffDias < 0) {
      const diasVencido = Math.abs(diffDias);
      return `Venció hace ${diasVencido} ${diasVencido === 1 ? 'día' : 'días'}`;
    }
    if (diffDias === 0) return 'Vence hoy';
    if (diffDias === 1) return 'Vence mañana';
    return `${diffDias} días restantes`;
  }
}
