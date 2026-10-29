import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiStateService } from '../state/ui-state.service';
import { ClientesProyectosApiService, ProyectoApi } from '../services/clientes-proyectos-api.service';

@Component({
  selector: 'app-work-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-map.component.html'
})
export class WorkMapComponent {
  cargando = false;
  error = '';
  constructor(public state: UiStateService, public api: ClientesProyectosApiService) {}

  ngOnInit(): void { void this.cargar(); }

  get proyectosMapa(): (ProyectoApi & { x: number; y: number; clienteNombre: string; visualClass: string })[] {
    const proyectos = this.api.proyectos;
    const total = proyectos.length;
    return proyectos.map((proyecto, index) => {
      const radio = total <= 1 ? 0 : Math.min(38, 10 + 28 * Math.sqrt((index + 0.5) / total));
      const angulo = index * 2.399963229728653;
      return { ...proyecto, x: Math.max(12, Math.min(88, 50 + Math.cos(angulo) * radio)), y: Math.max(16, Math.min(88, 48 + Math.sin(angulo) * radio)), clienteNombre: proyecto.cliente?.nombre || 'Cliente', visualClass: 'visual-building' };
    });
  }

  get proyectosVisibles(): (ProyectoApi & { x: number; y: number; clienteNombre: string; visualClass: string })[] {
    const query = this.state.query.trim().toLocaleLowerCase();
    return this.proyectosMapa.filter((p) => !query || `${p.nombre} ${p.clienteNombre} ${p.cliente?.empresa || ''} ${p.descripcion || ''}`.toLocaleLowerCase().includes(query));
  }

  get totalActivos(): number { return this.api.proyectos.filter((proyecto) => proyecto.estado === 'ACTIVO').length; }

  async cargar(): Promise<void> {
    this.cargando = true; this.error = '';
    try {
      const [proyectos] = await Promise.all([this.api.listarProyectos(), this.api.listarClientes()]);
      const seleccionado = this.api.proyectoSeleccionado;
      if (!seleccionado || !proyectos.some((proyecto) => proyecto.id === seleccionado.id)) {
        this.api.limpiarProyectoSeleccionado();
        if (proyectos.length) await this.api.seleccionarProyecto(proyectos[0].id);
      }
    }
    catch { this.error = 'No se pudo cargar el mapa de proyectos.'; }
    finally { this.cargando = false; }
  }

  async seleccionar(proyecto: ProyectoApi): Promise<void> {
    try { await this.api.seleccionarProyecto(proyecto.id); }
    catch { this.error = 'No se pudieron consultar los datos del proyecto.'; }
  }
}
