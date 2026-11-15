import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { UiStateService } from '../state/ui-state.service';
import { AuthService } from '../auth/auth.service';
import { ClientesProyectosApiService } from '../services/clientes-proyectos-api.service';
import { EstadoTareaApi, PrioridadTareaApi, TareaApi, TrabajoApiService, progresoTareas } from '../services/trabajo-api.service';

interface TareaVista extends TareaApi { proyectoNombre: string }

@Component({ selector: 'app-tareas', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './tareas.component.html', styleUrl: './tareas.component.css' })
export class TareasComponent implements OnInit, OnDestroy {
  tareas: TareaVista[] = [];
  cargando = false;
  guardando = false;
  error = '';
  errorAccion = '';
  editandoId: string | null = null;
  confirmandoEliminarId: string | null = null;
  borrador = { titulo: '', descripcion: '', estado: 'PENDIENTE' as EstadoTareaApi, prioridad: 'MEDIA' as PrioridadTareaApi, fechaVencimiento: '' };
  private solicitud = 0;
  private cambios?: Subscription;
  private sesion?: Subscription;

  constructor(public state: UiStateService, private proyectosApi: ClientesProyectosApiService, private trabajo: TrabajoApiService, private auth: AuthService) {}
  ngOnInit(): void {
    this.cambios = this.trabajo.cambios$.subscribe(() => { void this.cargar(); });
    this.sesion = this.auth.sesion$.subscribe((sesion) => {
      if (sesion?.contexto.tipoAcceso === 'ORGANIZACION') void this.cargar();
      else { ++this.solicitud; this.tareas = []; this.cargando = false; this.error = ''; }
    });
  }
  ngOnDestroy(): void { ++this.solicitud; this.cambios?.unsubscribe(); this.sesion?.unsubscribe(); }

  get visibles(): TareaVista[] {
    const query = this.state.query.trim().toLocaleLowerCase();
    const hoy = this.hoyLocal();
    return this.tareas.filter((tarea) => {
      const fecha = tarea.fechaVencimiento?.slice(0, 10);
      if (this.state.taskFilter === 'COMPLETADAS' && tarea.estado !== 'COMPLETADA') return false;
      if (this.state.taskFilter === 'HOY' && (tarea.estado === 'COMPLETADA' || fecha !== hoy)) return false;
      if (this.state.taskFilter === 'PROXIMAS' && (tarea.estado === 'COMPLETADA' || !fecha || fecha <= hoy)) return false;
      return !query || `${tarea.titulo} ${tarea.proyectoNombre} ${tarea.prioridad}`.toLocaleLowerCase().includes(query);
    });
  }
  progreso(proyectoId: string): number | null { return progresoTareas(this.tareas.filter((tarea) => tarea.proyectoId === proyectoId)); }

  async cargar(): Promise<void> {
    const solicitud = ++this.solicitud;
    const token = this.auth.token;
    this.cargando = true; this.error = '';
    try {
      const proyectos = await this.proyectosApi.listarProyectos();
      const grupos = await Promise.all(proyectos.map(async (proyecto) =>
        (await this.trabajo.listarTareas(proyecto.id)).map((tarea) => ({ ...tarea, proyectoNombre: proyecto.nombre }))));
      if (solicitud === this.solicitud && token === this.auth.token) {
        this.tareas = grupos.flat();
        this.trabajo.registrarTareas(this.tareas);
      }
    } catch {
      if (solicitud === this.solicitud && token === this.auth.token) this.error = 'No se pudieron cargar las tareas. Reintenta la consulta.';
    } finally {
      if (solicitud === this.solicitud && token === this.auth.token) this.cargando = false;
    }
  }
  iniciarEdicion(tarea: TareaVista): void {
    this.editandoId = tarea.id; this.errorAccion = '';
    this.borrador = { titulo: tarea.titulo, descripcion: tarea.descripcion || '', estado: tarea.estado, prioridad: tarea.prioridad,
      fechaVencimiento: tarea.fechaVencimiento?.slice(0, 10) || '' };
  }
  async guardar(tarea: TareaVista): Promise<void> {
    if (this.guardando) return;
    if (this.borrador.titulo.trim().length < 2) { this.errorAccion = 'El título necesita al menos dos caracteres.'; return; }
    this.guardando = true; this.errorAccion = '';
    try {
      await this.trabajo.editarTarea(tarea.proyectoId, tarea.id, { titulo: this.borrador.titulo.trim(), descripcion: this.borrador.descripcion.trim() || null, estado: this.borrador.estado,
        prioridad: this.borrador.prioridad, fechaVencimiento: this.borrador.fechaVencimiento || null });
      this.editandoId = null;
    } catch { this.errorAccion = 'No se pudo guardar la tarea. Reintenta.'; }
    finally { this.guardando = false; }
  }
  async alternar(tarea: TareaVista): Promise<void> {
    if (this.guardando) return;
    this.guardando = true; this.errorAccion = '';
    try { await this.trabajo.editarTarea(tarea.proyectoId, tarea.id, { estado: tarea.estado === 'COMPLETADA' ? 'PENDIENTE' : 'COMPLETADA' }); }
    catch { this.errorAccion = 'No se pudo cambiar el estado. Reintenta.'; }
    finally { this.guardando = false; }
  }
  async eliminar(tarea: TareaVista): Promise<void> {
    if (this.guardando || this.confirmandoEliminarId !== tarea.id) return;
    this.guardando = true; this.errorAccion = '';
    try { await this.trabajo.eliminarTarea(tarea.proyectoId, tarea.id); this.confirmandoEliminarId = null; this.editandoId = null; }
    catch { this.errorAccion = 'No se pudo eliminar la tarea. Reintenta.'; }
    finally { this.guardando = false; }
  }
  private hoyLocal(): string {
    const fecha = new Date();
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  }
}
