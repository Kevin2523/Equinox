import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ClientesProyectosApiService, EstadoProyectoApi, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { TrabajoApiService, TareaApi, HitoApi, progresoTareas } from '../services/trabajo-api.service';
import { I18nService } from '../state/i18n.service';
import { TPipe } from './t.pipe';
import { UiStateService } from '../state/ui-state.service';

export interface HitoVisual {
  id?: string;
  numStr: string;
  titulo: string;
  meta: string;
  estado: 'COMPLETADO' | 'EN_CURSO' | 'PENDIENTE';
}

@Component({
  selector: 'app-project-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './project-inspector.component.html',
  styleUrls: ['./project-inspector.component.css']
})
export class ProjectInspectorComponent implements OnInit, OnDestroy {
  hitos: HitoVisual[] = [];
  tareas: TareaApi[] = [];
  cargandoDetalles = false;
  errorHitos = '';
  private detallesSeq = 0;
  private proyectoActivoId: string | null = null;
  private subProyecto?: Subscription;
  private subCambios?: Subscription;

  constructor(
    public api: ClientesProyectosApiService,
    public trabajoApi: TrabajoApiService,
    public state: UiStateService,
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
    this.subProyecto = this.api.proyectoSeleccionado$.subscribe((p) => {
      if (p?.id) {
        const cambioProyecto = this.proyectoActivoId !== p.id;
        this.proyectoActivoId = p.id;
        if (cambioProyecto) {
          this.hitos = [];
          this.tareas = [];
          void this.cargarDetalles(p);
        }
      } else {
        this.detallesSeq++;
        this.proyectoActivoId = null;
        this.hitos = [];
        this.tareas = [];
        this.cargandoDetalles = false;
      }
    });

    this.subCambios = this.trabajoApi.cambios$.subscribe(() => {
      const p = this.api.proyectoSeleccionado;
      if (p?.id) {
        void this.cargarDetalles(p);
      }
    });
  }

  ngOnDestroy(): void {
    this.subProyecto?.unsubscribe();
    this.subCambios?.unsubscribe();
  }

  get proyectoIndex(): string {
    const sel = this.api.proyectoSeleccionado;
    if (!sel) return '01';
    const idx = this.api.proyectos.findIndex((p) => p.id === sel.id);
    return idx >= 0 ? `0${idx + 1}`.slice(-2) : '01';
  }

  get subtitulo(): string {
    const sel = this.api.proyectoSeleccionado;
    if (!sel) return '';
    if (sel.descripcion?.trim()) return sel.descripcion.trim();
    if (sel.cliente?.empresa) return sel.cliente.empresa;
    if (sel.cliente?.nombre) return this.t('crm.projectInspector.clientePrefijo', { nombre: sel.cliente.nombre }, `Cliente: ${sel.cliente.nombre}`);
    return this.t('crm.projectInspector.serviciosProfesionales', undefined, 'Servicios profesionales');
  }

  estadoLegible(estado?: string): string {
    switch (estado) {
      case 'ACTIVO': return this.t('crm.projectInspector.estadoActivo', undefined, 'En desarrollo');
      case 'COMPLETADO': return this.t('crm.projectInspector.estadoCompletado', undefined, 'Completado');
      case 'PAUSADO': return this.t('crm.projectInspector.estadoPausado', undefined, 'En pausa');
      case 'BORRADOR': return this.t('crm.projectInspector.estadoBorrador', undefined, 'Borrador');
      case 'CANCELADO': return this.t('crm.projectInspector.estadoCancelado', undefined, 'Cancelado');
      default: return estado ? estado.toLowerCase() : this.t('crm.projectInspector.estadoActivo', undefined, 'En desarrollo');
    }
  }

  get progresoCalculado(): number {
    const sel = this.api.proyectoSeleccionado;
    if (!sel) return 0;
    if (sel.estado === 'COMPLETADO') return 100;

    if (this.tareas.length > 0) {
      const pct = progresoTareas(this.tareas);
      if (pct !== null) return pct;
    }

    if (this.hitos.length > 0) {
      const completados = this.hitos.filter((h) => h.estado === 'COMPLETADO').length;
      return Math.round((completados / this.hitos.length) * 100);
    }

    return 0;
  }

  get fechaEntregaFormateada(): string {
    const sel = this.api.proyectoSeleccionado;
    if (!sel?.fechaEntrega) return '';
    const d = new Date(sel.fechaEntrega);
    if (isNaN(d.getTime())) return '';
    if (this.i18n) {
      return this.i18n.formatearFecha(d, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
    }
    const meses = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const dia = d.getUTCDate();
    const mes = meses[d.getUTCMonth()];
    const anio = d.getUTCFullYear();
    return `${dia} ${mes} ${anio}`;
  }

  formatearFechaCorta(d: Date): string {
    if (!d || isNaN(d.getTime())) return '';
    if (this.i18n) {
      return this.i18n.formatearFecha(d, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dia = d.getUTCDate();
    const mes = meses[d.getUTCMonth()];
    const anio = d.getUTCFullYear();
    return `${dia} ${mes} ${anio}`;
  }

  get tareasMostradas(): TareaApi[] {
    const noCanceladas = this.tareas.filter((t) => t.estado !== 'CANCELADA');
    const pendientes = noCanceladas.filter((t) => t.estado !== 'COMPLETADA');
    const completadas = noCanceladas.filter((t) => t.estado === 'COMPLETADA');
    return [...pendientes, ...completadas].slice(0, 6);
  }

  get tareasPendientesCount(): number {
    return this.tareas.filter((t) => t.estado !== 'COMPLETADA' && t.estado !== 'CANCELADA').length;
  }

  async cargarDetalles(p: ProyectoApi): Promise<void> {
    const seq = ++this.detallesSeq;
    const proyectoId = p.id;
    this.cargandoDetalles = true;
    this.errorHitos = '';
    this.hitos = [];
    try {
      const [hitosRes, tareasRes] = await Promise.allSettled([
        this.trabajoApi.listarHitos(proyectoId),
        this.trabajoApi.listarTareas(proyectoId)
      ]);

      if (seq !== this.detallesSeq || this.api.proyectoSeleccionado?.id !== proyectoId) {
        return;
      }

      this.tareas = tareasRes.status === 'fulfilled' ? tareasRes.value : [];

      if (hitosRes.status === 'rejected') {
        this.errorHitos = this.t('crm.projectInspector.errorHitos', undefined, 'No se pudieron cargar los hitos del proyecto.');
        this.hitos = [];
        return;
      }

      const hitosApi = hitosRes.value;

      if (hitosApi.length > 0) {
        this.hitos = hitosApi.map((h, i) => {
          let estadoVisual: 'COMPLETADO' | 'EN_CURSO' | 'PENDIENTE' = 'PENDIENTE';
          let meta = this.t('crm.projectInspector.hitoPendiente', undefined, 'Pendiente');
          if (h.estado === 'COMPLETADO') {
            estadoVisual = 'COMPLETADO';
            if (h.completadoEn) {
              const fecha = this.formatearFechaCorta(new Date(h.completadoEn));
              meta = this.t('crm.projectInspector.hitoCompletadoFecha', { fecha }, `Completado · ${fecha}`);
            } else {
              meta = this.t('crm.projectInspector.hitoCompletado', undefined, 'Completado');
            }
          } else if (h.estado === 'EN_PROGRESO') {
            estadoVisual = 'EN_CURSO';
            if (h.fechaObjetivo) {
              const fecha = this.formatearFechaCorta(new Date(h.fechaObjetivo));
              meta = this.t('crm.projectInspector.hitoEnCursoMeta', { fecha }, `En curso · Meta: ${fecha}`);
            } else {
              meta = this.t('crm.projectInspector.hitoEnCurso', undefined, 'En curso');
            }
          } else if (h.fechaObjetivo) {
            const fecha = this.formatearFechaCorta(new Date(h.fechaObjetivo));
            meta = this.t('crm.projectInspector.hitoMeta', { fecha }, `Meta: ${fecha}`);
          }

          return {
            id: h.id,
            numStr: `0${i + 1}`.slice(-2),
            titulo: h.titulo,
            meta,
            estado: estadoVisual
          };
        });
      } else {
        this.hitos = [];
      }
    } finally {
      if (seq === this.detallesSeq) {
        this.cargandoDetalles = false;
      }
    }
  }

  reintentarDetalles(): void {
    const sel = this.api.proyectoSeleccionado;
    if (sel) void this.cargarDetalles(sel);
  }

  async toggleTarea(tarea: TareaApi): Promise<void> {
    const nuevoEstado = tarea.estado === 'COMPLETADA' ? 'PENDIENTE' : 'COMPLETADA';
    const estadoAnterior = tarea.estado;
    tarea.estado = nuevoEstado;

    const sel = this.api.proyectoSeleccionado;
    if (sel?.id) {
      try {
        await this.trabajoApi.editarTarea(sel.id, tarea.id, { estado: nuevoEstado });
      } catch (err) {
        tarea.estado = estadoAnterior;
        console.warn('Error al actualizar tarea:', err);
      }
    }
  }

  nuevoProyecto(): void {
    void this.router.navigate(['/proyectos']);
  }

  editar(id: string): void {
    void this.router.navigate(['/proyectos'], { queryParams: { editar: id } });
  }

  verEnProyectos(id: string): void {
    void this.router.navigate(['/proyectos'], { queryParams: { proyecto: id } });
  }

  abrirProyecto(id: string): void {
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
      return diasVencido === 1
        ? this.t('crm.projectInspector.vencioUno', undefined, 'Venció hace 1 día')
        : this.t('crm.projectInspector.vencioVarios', { dias: diasVencido }, `Venció hace ${diasVencido} días`);
    }
    if (diffDias === 0) return this.t('crm.projectInspector.venceHoy', undefined, 'Vence hoy');
    if (diffDias === 1) return this.t('crm.projectInspector.venceManana', undefined, 'Vence mañana');
    return this.t('crm.projectInspector.diasRestantes', { dias: diffDias }, `${diffDias} días restantes`);
  }
}
