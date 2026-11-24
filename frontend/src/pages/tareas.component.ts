import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription, firstValueFrom } from 'rxjs';
import { UiStateService } from '../state/ui-state.service';
import { AuthService } from '../auth/auth.service';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';
import { TPipe } from '../shared/t.pipe';
import { I18nService } from '../state/i18n.service';
import { obtenerBaseApi } from '../auth/api.config';
import { ClientesProyectosApiService, ProyectoApi } from '../services/clientes-proyectos-api.service';
import {
  EstadoTareaApi,
  PrioridadTareaApi,
  TareaApi,
  TrabajoApiService
} from '../services/trabajo-api.service';

export interface TareaVista extends TareaApi {
  proyectoNombre: string;
}

export type PestanaTareas = 'PENDIENTES' | 'COMPLETADAS';

@Component({
  selector: 'app-tareas',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogFocusDirective, TPipe],
  templateUrl: './tareas.component.html',
  styleUrl: './tareas.component.css'
})
export class TareasComponent implements OnInit, OnDestroy {
  pestanaActiva: PestanaTareas = 'PENDIENTES';
  busqueda = '';
  busquedaAbierta = false;

  tareas: TareaVista[] = [];
  proyectos: ProyectoApi[] = [];
  organizacionNombre = '';

  cargando = true;
  guardando = false;
  error = '';
  errorAccion = '';
  errorModal = '';

  // Menú contextual activo
  menuAbiertoId: string | null = null;

  // Modal Crear
  modalCrear = false;
  formCrear = {
    proyectoId: '',
    titulo: '',
    descripcion: '',
    prioridad: 'MEDIA' as PrioridadTareaApi,
    fechaVencimiento: ''
  };

  // Modal Editar
  modalEditar = false;
  tareaEditando: TareaVista | null = null;
  formEditar = {
    titulo: '',
    descripcion: '',
    estado: 'PENDIENTE' as EstadoTareaApi,
    prioridad: 'MEDIA' as PrioridadTareaApi,
    fechaVencimiento: ''
  };

  // Modal Confirmar Eliminar
  modalEliminar = false;
  tareaEliminando: TareaVista | null = null;

  // Creación rápida inline ("+ Añadir tarea")
  creacionRapidaAbierta = false;
  errorRapido = '';
  formRapido = {
    proyectoId: '',
    titulo: '',
    fechaVencimiento: ''
  };

  private solicitud = 0;
  private cambios?: Subscription;
  private sesion?: Subscription;

  constructor(
    public state: UiStateService,
    private proyectosApi: ClientesProyectosApiService,
    private trabajo: TrabajoApiService,
    private auth: AuthService,
    private http: HttpClient,
    private router: Router,
    private i18n?: I18nService
  ) {}

  private t(key: string, params?: Record<string, string | number>, fallback = key): string {
    if (this.i18n) {
      return this.i18n.t(key, params);
    }
    if (!params) return fallback;
    return fallback.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, name) => {
      const value = params[name];
      return value !== undefined && value !== null ? String(value) : match;
    });
  }

  ngOnInit(): void {
    this.cambios = this.trabajo.cambios$.subscribe(() => {
      void this.cargarSilencioso();
    });

    this.sesion = this.auth.sesion$.subscribe((sesion) => {
      if (sesion?.contexto.tipoAcceso === 'ORGANIZACION') {
        void this.cargar();
      } else {
        ++this.solicitud;
        this.tareas = [];
        this.proyectos = [];
        this.cargando = false;
        this.error = '';
      }
    });

    void this.cargar();
  }

  ngOnDestroy(): void {
    ++this.solicitud;
    this.cambios?.unsubscribe();
    this.sesion?.unsubscribe();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.menuAbiertoId = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuAbiertoId = null;
    if (this.modalCrear) this.cerrarModalCrear();
    if (this.modalEditar) this.cerrarModalEditar();
    if (this.modalEliminar) this.cerrarModalEliminar();
    if (this.creacionRapidaAbierta) this.cerrarCreacionRapida();
  }

  get nombreEstudio(): string {
    return this.organizacionNombre || this.state.configuracion?.nombreEstudio || '';
  }

  get totalPendientes(): number {
    return this.tareas.filter((t) => t.estado !== 'COMPLETADA' && t.estado !== 'CANCELADA').length;
  }

  get totalCompletadas(): number {
    return this.tareas.filter((t) => t.estado === 'COMPLETADA').length;
  }

  get tareasFiltradas(): TareaVista[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.tareas.filter((t) => {
      if (this.pestanaActiva === 'PENDIENTES') {
        if (t.estado === 'COMPLETADA' || t.estado === 'CANCELADA') return false;
      } else {
        if (t.estado !== 'COMPLETADA') return false;
      }

      if (!q) return true;
      const contenido = `${t.titulo} ${t.proyectoNombre} ${t.descripcion || ''} ${t.prioridad}`.toLowerCase();
      return contenido.includes(q);
    });
  }

  // Grupos para la pestaña "Pendientes"
  get grupoVencidas(): TareaVista[] {
    const hoy = this.hoyYMD();
    return this.tareasFiltradas
      .filter((t) => {
        const ymd = this.extraerYMD(t.fechaVencimiento);
        return !!ymd && ymd < hoy;
      })
      .sort((a, b) => (a.fechaVencimiento || '').localeCompare(b.fechaVencimiento || ''));
  }

  get grupoHoy(): TareaVista[] {
    const hoy = this.hoyYMD();
    return this.tareasFiltradas
      .filter((t) => {
        const ymd = this.extraerYMD(t.fechaVencimiento);
        return !!ymd && ymd === hoy;
      })
      .sort((a, b) => this.pesoPrioridad(b.prioridad) - this.pesoPrioridad(a.prioridad));
  }

  get grupoProximas(): TareaVista[] {
    const hoy = this.hoyYMD();
    return this.tareasFiltradas
      .filter((t) => {
        const ymd = this.extraerYMD(t.fechaVencimiento);
        return !!ymd && ymd > hoy;
      })
      .sort((a, b) => (a.fechaVencimiento || '').localeCompare(b.fechaVencimiento || ''));
  }

  get grupoSinFecha(): TareaVista[] {
    return this.tareasFiltradas
      .filter((t) => !this.extraerYMD(t.fechaVencimiento))
      .sort((a, b) => this.pesoPrioridad(b.prioridad) - this.pesoPrioridad(a.prioridad));
  }

  // Grupos para la pestaña "Completadas"
  get grupoCompletadasHoy(): TareaVista[] {
    const hoy = this.hoyYMD();
    return this.tareasFiltradas
      .filter((t) => {
        const ymd = this.extraerYMD(t.completadaEn || t.actualizadoEn);
        return ymd === hoy;
      })
      .sort((a, b) => (b.completadaEn || b.actualizadoEn || '').localeCompare(a.completadaEn || a.actualizadoEn || ''));
  }

  get grupoCompletadasAnteriores(): TareaVista[] {
    const hoy = this.hoyYMD();
    return this.tareasFiltradas
      .filter((t) => {
        const ymd = this.extraerYMD(t.completadaEn || t.actualizadoEn);
        return ymd !== hoy;
      })
      .sort((a, b) => (b.completadaEn || b.actualizadoEn || '').localeCompare(a.completadaEn || a.actualizadoEn || ''));
  }

  async cargar(): Promise<void> {
    const solicitud = ++this.solicitud;
    const token = this.auth.token;
    this.cargando = true;
    this.error = '';

    try {
      // Cargar organización si no está en caché
      void this.cargarOrganizacion();

      const proyectos = await this.proyectosApi.listarProyectos();
      this.proyectos = proyectos;

      const grupos = await Promise.all(
        proyectos.map(async (proyecto) => {
          const tareas = await this.trabajo.listarTareas(proyecto.id);
          return tareas.map((tarea) => ({ ...tarea, proyectoNombre: proyecto.nombre }));
        })
      );

      if (solicitud === this.solicitud && token === this.auth.token) {
        this.tareas = grupos.flat();
        this.trabajo.registrarTareas(this.tareas);
      }
    } catch {
      if (solicitud === this.solicitud && token === this.auth.token) {
        this.error = this.t('crm.tareas.errorCargar', undefined, 'No se pudieron cargar las tareas de la organización. Intenta nuevamente.');
      }
    } finally {
      if (solicitud === this.solicitud && token === this.auth.token) {
        this.cargando = false;
      }
    }
  }

  async cargarSilencioso(): Promise<void> {
    const solicitud = ++this.solicitud;
    const token = this.auth.token;
    try {
      const proyectos = await this.proyectosApi.listarProyectos();
      this.proyectos = proyectos;
      const grupos = await Promise.all(
        proyectos.map(async (proyecto) => {
          const tareas = await this.trabajo.listarTareas(proyecto.id);
          return tareas.map((tarea) => ({ ...tarea, proyectoNombre: proyecto.nombre }));
        })
      );
      if (solicitud === this.solicitud && token === this.auth.token) {
        this.tareas = grupos.flat();
        this.trabajo.registrarTareas(this.tareas);
      }
    } catch {
      // Silencioso
    }
  }

  private async cargarOrganizacion(): Promise<void> {
    try {
      const org = await firstValueFrom(this.http.get<any>(`${obtenerBaseApi()}/organizacion`));
      if (org?.nombre) {
        this.organizacionNombre = org.nombre;
      }
    } catch {
      // No bloqueante
    }
  }

  // Alternar estado completada / reabrir
  async alternar(tarea: TareaVista, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (this.guardando) return;

    const estadoOriginal = tarea.estado;
    const nuevoEstado: EstadoTareaApi =
      estadoOriginal === 'COMPLETADA' ? 'PENDIENTE' : 'COMPLETADA';

    // Actualización optimista inmediata
    tarea.estado = nuevoEstado;
    if (nuevoEstado === 'COMPLETADA') {
      tarea.completadaEn = new Date().toISOString();
    } else {
      tarea.completadaEn = null;
    }
    this.errorAccion = '';

    try {
      await this.trabajo.editarTarea(tarea.proyectoId, tarea.id, { estado: nuevoEstado });
      await this.cargarSilencioso();
    } catch {
      // Revertir ante error
      tarea.estado = estadoOriginal;
      this.errorAccion = this.t('crm.tareas.errorAlternar', undefined, 'No se pudo actualizar el estado de la tarea.');
    }
  }

  // Navegar al proyecto en Equinox
  navegarAProyecto(proyectoId: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    void this.router.navigate(['/proyectos'], { queryParams: { detalle: proyectoId } });
  }

  // Acciones menú
  toggleMenu(tareaId: string, event: Event): void {
    event.stopPropagation();
    this.menuAbiertoId = this.menuAbiertoId === tareaId ? null : tareaId;
  }

  // Modal Nueva Tarea
  abrirModalCrear(proyectoIdPredeterminado?: string): void {
    this.menuAbiertoId = null;
    this.errorModal = '';
    const primerProyectoId = proyectoIdPredeterminado || this.proyectos[0]?.id || '';
    this.formCrear = {
      proyectoId: primerProyectoId,
      titulo: '',
      descripcion: '',
      prioridad: 'MEDIA',
      fechaVencimiento: this.hoyYMD()
    };
    this.modalCrear = true;
  }

  cerrarModalCrear(): void {
    this.modalCrear = false;
    this.errorModal = '';
  }

  async guardarNuevaTarea(): Promise<void> {
    if (this.guardando) return;
    if (!this.formCrear.proyectoId) {
      this.errorModal = this.t('crm.tareas.errorSeleccionaProyectoCrear', undefined, 'Selecciona un proyecto para la tarea.');
      return;
    }
    const titulo = this.formCrear.titulo.trim();
    if (titulo.length < 2) {
      this.errorModal = this.t('crm.tareas.errorTituloCorto', undefined, 'El título debe tener al menos dos caracteres.');
      return;
    }

    this.guardando = true;
    this.errorModal = '';

    try {
      await this.trabajo.crearTarea(this.formCrear.proyectoId, {
        titulo,
        descripcion: this.formCrear.descripcion.trim() || null,
        prioridad: this.formCrear.prioridad,
        fechaVencimiento: this.formCrear.fechaVencimiento || null
      });
      this.cerrarModalCrear();
      await this.cargar();
    } catch (err: any) {
      this.errorModal = err?.error?.error || this.t('crm.tareas.errorCrear', undefined, 'No se pudo crear la tarea. Verifica los datos.');
    } finally {
      this.guardando = false;
    }
  }

  // Modal Editar Tarea
  abrirModalEditar(tarea: TareaVista, event?: Event): void {
    if (event) event.stopPropagation();
    this.menuAbiertoId = null;
    this.errorModal = '';
    this.tareaEditando = tarea;
    this.formEditar = {
      titulo: tarea.titulo,
      descripcion: tarea.descripcion || '',
      estado: tarea.estado,
      prioridad: tarea.prioridad,
      fechaVencimiento: this.extraerYMD(tarea.fechaVencimiento) || ''
    };
    this.modalEditar = true;
  }

  cerrarModalEditar(): void {
    this.modalEditar = false;
    this.tareaEditando = null;
    this.errorModal = '';
  }

  async guardarEdicion(): Promise<void> {
    if (this.guardando || !this.tareaEditando) return;
    const titulo = this.formEditar.titulo.trim();
    if (titulo.length < 2) {
      this.errorModal = this.t('crm.tareas.errorTituloCorto', undefined, 'El título debe tener al menos dos caracteres.');
      return;
    }

    this.guardando = true;
    this.errorModal = '';

    try {
      await this.trabajo.editarTarea(this.tareaEditando.proyectoId, this.tareaEditando.id, {
        titulo,
        descripcion: this.formEditar.descripcion.trim() || null,
        estado: this.formEditar.estado,
        prioridad: this.formEditar.prioridad,
        fechaVencimiento: this.formEditar.fechaVencimiento || null
      });
      this.cerrarModalEditar();
      await this.cargar();
    } catch (err: any) {
      this.errorModal = err?.error?.error || this.t('crm.tareas.errorGuardar', undefined, 'No se pudo guardar la tarea.');
    } finally {
      this.guardando = false;
    }
  }

  // Modal Confirmar Eliminar
  confirmarEliminar(tarea: TareaVista, event?: Event): void {
    if (event) event.stopPropagation();
    this.menuAbiertoId = null;
    this.tareaEliminando = tarea;
    this.modalEliminar = true;
  }

  cerrarModalEliminar(): void {
    this.modalEliminar = false;
    this.tareaEliminando = null;
  }

  async eliminarTareaConfirmada(): Promise<void> {
    if (this.guardando || !this.tareaEliminando) return;
    this.guardando = true;
    this.errorAccion = '';

    try {
      await this.trabajo.eliminarTarea(this.tareaEliminando.proyectoId, this.tareaEliminando.id);
      this.cerrarModalEliminar();
      await this.cargar();
    } catch {
      this.errorAccion = this.t('crm.tareas.errorEliminar', undefined, 'No se pudo eliminar la tarea.');
    } finally {
      this.guardando = false;
    }
  }

  // Toggle de búsqueda
  toggleBusqueda(): void {
    this.busquedaAbierta = !this.busquedaAbierta;
    if (!this.busquedaAbierta) {
      this.busqueda = '';
    }
  }

  limpiarBusqueda(): void {
    this.busqueda = '';
  }

  // Creación rápida inline
  abrirCreacionRapida(): void {
    if (!this.proyectos.length) return;
    this.creacionRapidaAbierta = true;
    this.errorRapido = '';
    this.formRapido = {
      proyectoId: this.proyectos[0]?.id || '',
      titulo: '',
      fechaVencimiento: this.hoyYMD()
    };
  }

  cerrarCreacionRapida(): void {
    this.creacionRapidaAbierta = false;
    this.errorRapido = '';
  }

  async guardarTareaRapida(): Promise<void> {
    if (this.guardando) return;
    if (!this.formRapido.proyectoId) {
      this.errorRapido = this.t('crm.tareas.errorSeleccionaProyectoRapido', undefined, 'Selecciona un proyecto.');
      return;
    }
    const titulo = this.formRapido.titulo.trim();
    if (titulo.length < 2) {
      this.errorRapido = this.t('crm.tareas.errorTituloCorto', undefined, 'El título debe tener al menos dos caracteres.');
      return;
    }

    this.guardando = true;
    this.errorRapido = '';

    try {
      await this.trabajo.crearTarea(this.formRapido.proyectoId, {
        titulo,
        prioridad: 'MEDIA',
        fechaVencimiento: this.formRapido.fechaVencimiento || null,
        descripcion: null
      });
      this.cerrarCreacionRapida();
      await this.cargar();
    } catch (err: any) {
      this.errorRapido = err?.error?.error || this.t('crm.tareas.errorCrearRapido', undefined, 'No se pudo crear la tarea.');
    } finally {
      this.guardando = false;
    }
  }

  // Helpers de fechas
  extraerYMD(fecha: string | null | undefined): string | null {
    if (!fecha) return null;
    const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  }

  hoyYMD(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  formatearFechaDisplay(fecha: string | null | undefined): string {
    const ymd = this.extraerYMD(fecha);
    if (!ymd) return '';
    const hoy = this.hoyYMD();
    if (ymd === hoy) return this.t('crm.tareas.hoy', undefined, 'Hoy');

    const mananaDate = new Date();
    mananaDate.setDate(mananaDate.getDate() + 1);
    const mananaYMD = `${mananaDate.getFullYear()}-${String(mananaDate.getMonth() + 1).padStart(2, '0')}-${String(mananaDate.getDate()).padStart(2, '0')}`;
    if (ymd === mananaYMD) return this.t('crm.tareas.manana', undefined, 'Mañana');

    const [y, m, d] = ymd.split('-').map(Number);
    const anioActual = new Date().getFullYear();
    if (this.i18n) {
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      return this.i18n.formatearFecha(dateObj, y !== anioActual
        ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', timeZone: 'UTC' });
    }
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const mes = meses[m - 1] || '';
    return y !== anioActual ? `${d} ${mes} ${y}` : `${d} ${mes}`;
  }

  esVencida(fecha: string | null | undefined): boolean {
    const ymd = this.extraerYMD(fecha);
    return !!ymd && ymd < this.hoyYMD();
  }

  private pesoPrioridad(prioridad: PrioridadTareaApi): number {
    switch (prioridad) {
      case 'URGENTE': return 4;
      case 'ALTA': return 3;
      case 'MEDIA': return 2;
      case 'BAJA': return 1;
      default: return 0;
    }
  }
}
