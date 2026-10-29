import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClientesProyectosApiService, EstadoProyectoApi } from '../services/clientes-proyectos-api.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-project-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-inspector.component.html'
})
export class ProjectInspectorComponent {
  constructor(public api: ClientesProyectosApiService, private router: Router) {}

  editar(id: string): void { void this.router.navigate(['/proyectos'], { queryParams: { editar: id } }); }
  claseEstado(estado: EstadoProyectoApi): string {
    return `badge-${estado === 'ACTIVO' ? 'progreso' : estado === 'COMPLETADO' ? 'completado' : estado === 'BORRADOR' ? 'planificacion' : estado === 'PAUSADO' ? 'aprobar' : 'revision'}`;
  }
}
