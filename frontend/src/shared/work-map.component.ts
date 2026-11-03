import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Subscription } from 'rxjs';
import { UiStateService } from '../state/ui-state.service';
import { ClientesProyectosApiService, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { EstadoHitoApi, HitoApi, TrabajoApiService } from '../services/trabajo-api.service';

@Component({
  selector: 'app-work-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-map.component.html'
})
export class WorkMapComponent implements OnInit, OnDestroy {
  cargando = false;
  error = '';
  filtroEstado: 'TODOS' | 'ACTIVO' | 'BORRADOR' | 'COMPLETADO' = 'TODOS';

  hitosProyecto: HitoApi[] = [];
  cargandoHitos = false;
  errorCargaHitos = '';
  mostrarFormularioHito = false;
  guardandoHito = false;
  errorHito = '';
  actualizandoHitoId: string | null = null;
  nuevoHito = {
    titulo: '',
    descripcion: '',
    fechaObjetivo: '',
    visibleEnPortal: true
  };

  private subSeleccion?: Subscription;
  private ultimoProyectoHitosId: string | null = null;
  private solicitudHitos = 0;

  constructor(
    public state: UiStateService,
    public api: ClientesProyectosApiService,
    private trabajo?: TrabajoApiService
  ) {}

  ngOnInit(): void {
    this.subSeleccion = this.api.proyectoSeleccionado$?.subscribe((proyecto) => {
      if (proyecto?.id) {
        if (this.ultimoProyectoHitosId !== proyecto.id) {
          void this.cargarHitosProyecto(proyecto.id);
        }
      } else {
        this.solicitudHitos++;
        this.ultimoProyectoHitosId = null;
        this.hitosProyecto = [];
        this.cargandoHitos = false;
        this.errorCargaHitos = '';
      }
    });
    void this.cargar();
  }

  ngOnDestroy(): void {
    this.solicitudHitos++;
    this.subSeleccion?.unsubscribe();
  }

  get proyectosMapa(): (ProyectoApi & { x: number; y: number; clienteNombre: string; visualClass: string })[] {
    const proyectos = this.api.proyectos;
    const total = proyectos.length;
    return proyectos.map((proyecto, index) => {
      const radio = total <= 1 ? 0 : Math.min(38, 10 + 28 * Math.sqrt((index + 0.5) / total));
      const angulo = index * 2.399963229728653;
      return {
        ...proyecto,
        x: Math.max(12, Math.min(88, 50 + Math.cos(angulo) * radio)),
        y: Math.max(16, Math.min(88, 48 + Math.sin(angulo) * radio)),
        clienteNombre: proyecto.cliente?.nombre || 'Cliente',
        visualClass: 'visual-building'
      };
    });
  }

  get proyectosVisibles(): (ProyectoApi & { x: number; y: number; clienteNombre: string; visualClass: string })[] {
    const query = this.state.query.trim().toLocaleLowerCase();
    return this.proyectosMapa.filter((p) => {
      const coincideEstado = this.filtroEstado === 'TODOS' || p.estado === this.filtroEstado;
      const coincideTexto = !query || `${p.nombre} ${p.clienteNombre} ${p.cliente?.empresa || ''} ${p.descripcion || ''}`.toLocaleLowerCase().includes(query);
      return coincideEstado && coincideTexto;
    });
  }

  get totalActivos(): number {
    return this.api.proyectos.filter((proyecto) => proyecto.estado === 'ACTIVO').length;
  }

  get hitosCompletadosCount(): number {
    return this.hitosProyecto.filter((h) => h.estado === 'COMPLETADO').length;
  }

  get porcentajeHitos(): number {
    if (!this.hitosProyecto.length) return 0;
    return Math.round((this.hitosCompletadosCount / this.hitosProyecto.length) * 100);
  }

  inicialesProyecto(nombre: string): string {
    return (nombre || 'PR')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((palabra) => palabra[0]?.toUpperCase() || '')
      .join('');
  }

  async cargar(): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      const [proyectos] = await Promise.all([this.api.listarProyectos(), this.api.listarClientes()]);
      const seleccionado = this.api.proyectoSeleccionado;
      if (!seleccionado || !proyectos.some((proyecto) => proyecto.id === seleccionado.id)) {
        this.api.limpiarProyectoSeleccionado();
        if (proyectos.length) {
          const nuevoSeleccionado = await this.api.seleccionarProyecto(proyectos[0].id);
          if (this.ultimoProyectoHitosId !== nuevoSeleccionado.id) void this.cargarHitosProyecto(nuevoSeleccionado.id);
        }
      } else {
        if (this.ultimoProyectoHitosId !== seleccionado.id) void this.cargarHitosProyecto(seleccionado.id);
      }
    } catch {
      this.error = 'No se pudo cargar el mapa de proyectos.';
    } finally {
      this.cargando = false;
    }
  }

  async seleccionar(proyecto: ProyectoApi): Promise<void> {
    try {
      await this.api.seleccionarProyecto(proyecto.id);
      if (this.api.proyectoSeleccionado?.id === proyecto.id && this.ultimoProyectoHitosId !== proyecto.id) void this.cargarHitosProyecto(proyecto.id);
    } catch {
      this.error = 'No se pudieron consultar los datos del proyecto.';
    }
  }

  async cargarHitosProyecto(proyectoId: string): Promise<void> {
    if (!this.trabajo || !proyectoId) return;
    const solicitud = ++this.solicitudHitos;
    this.ultimoProyectoHitosId = proyectoId;
    this.hitosProyecto = [];
    this.cargandoHitos = true;
    this.errorCargaHitos = '';
    this.errorHito = '';
    try {
      const hitos = await this.trabajo.listarHitos(proyectoId);
      if (this.ultimoProyectoHitosId === proyectoId && solicitud === this.solicitudHitos) {
        this.hitosProyecto = hitos;
      }
    } catch {
      if (this.ultimoProyectoHitosId === proyectoId && solicitud === this.solicitudHitos) {
        this.hitosProyecto = [];
        this.errorCargaHitos = 'No se pudieron consultar los hitos de este proyecto.';
      }
    } finally {
      if (this.ultimoProyectoHitosId === proyectoId && solicitud === this.solicitudHitos) {
        this.cargandoHitos = false;
      }
    }
  }

  async crearHitoEnMapa(): Promise<void> {
    const proyecto = this.api.proyectoSeleccionado;
    if (!this.trabajo || !proyecto || this.guardandoHito) return;
    const titulo = this.nuevoHito.titulo.trim();
    if (titulo.length < 2) {
      this.errorHito = 'El título del hito debe tener al menos 2 caracteres.';
      return;
    }
    this.guardandoHito = true;
    this.errorHito = '';
    try {
      const creado = await this.trabajo.crearHito(proyecto.id, {
        titulo,
        descripcion: this.nuevoHito.descripcion.trim() || null,
        fechaObjetivo: this.nuevoHito.fechaObjetivo || null,
        visibleEnPortal: this.nuevoHito.visibleEnPortal
      });
      if (this.api.proyectoSeleccionado?.id !== proyecto.id) return;
      this.hitosProyecto = [...this.hitosProyecto, creado];
      this.nuevoHito = { titulo: '', descripcion: '', fechaObjetivo: '', visibleEnPortal: true };
      this.mostrarFormularioHito = false;
    } catch {
      this.errorHito = 'No se pudo registrar el hito. Inténtalo de nuevo.';
    } finally {
      this.guardandoHito = false;
    }
  }

  async cambiarEstadoHito(hito: HitoApi, estado: EstadoHitoApi, event?: Event): Promise<void> {
    event?.stopPropagation();
    const proyecto = this.api.proyectoSeleccionado;
    if (!this.trabajo || !proyecto || this.actualizandoHitoId === hito.id || hito.estado === estado) return;
    this.actualizandoHitoId = hito.id;
    try {
      const actualizado = await this.trabajo.editarHito(proyecto.id, hito.id, { estado });
      if (this.api.proyectoSeleccionado?.id !== proyecto.id) return;
      this.hitosProyecto = this.hitosProyecto.map((item) => (item.id === hito.id ? actualizado : item));
    } catch {
      this.errorHito = 'No se pudo actualizar el estado del hito.';
    } finally {
      this.actualizandoHitoId = null;
    }
  }
}
