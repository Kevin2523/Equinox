import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import {
  EstadoSuscripcion,
  HistorialSuscripcionItem,
  OrganizacionSuscripcionItem,
  PaginacionAdmin,
  PlanSuscripcionAdmin
} from '../../models/admin.model';
import {
  ETIQUETAS_ESTADO_SUSCRIPCION,
  ETIQUETAS_TIPO_FREELANCE,
  claseEstadoSuscripcion,
  formatearFechaAdmin
} from './admin-formatters';

@Component({
  selector: 'app-admin-suscripciones',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-suscripciones.component.html',
  styleUrls: ['./admin.shared.css']
})
export class AdminSuscripcionesComponent implements OnInit {
  subtab: 'SUSCRIPCIONES' | 'PLANES' = 'SUSCRIPCIONES';
  toast = '';

  // Suscripciones por organización
  suscripciones: OrganizacionSuscripcionItem[] = [];
  pagSuscripciones: PaginacionAdmin = { pagina: 1, limite: 20, total: 0, totalPaginas: 0 };
  resumenEstados: Record<EstadoSuscripcion, number> = {
    SIN_SUSCRIPCION: 0,
    PRUEBA: 0,
    ACTIVA: 0,
    SUSPENDIDA: 0,
    CANCELADA: 0
  };
  busquedaSusc = '';
  filtroEstado: EstadoSuscripcion | '' = '';
  filtroPlanId = '';
  cargandoSusc = false;
  errorSusc = '';

  // Catálogo de planes
  planes: PlanSuscripcionAdmin[] = [];
  planesActivos: PlanSuscripcionAdmin[] = [];
  pagPlanes: PaginacionAdmin = { pagina: 1, limite: 20, total: 0, totalPaginas: 0 };
  busquedaPlanes = '';
  filtroPlanActivo: '' | 'true' | 'false' = '';
  cargandoPlanes = false;
  errorPlanes = '';

  // Modal Asignar / Editar Suscripción
  modalSuscripcion: {
    modo: 'ASIGNAR' | 'EDITAR';
    item: OrganizacionSuscripcionItem;
    planId: string;
    estado: 'PRUEBA' | 'ACTIVA' | 'SUSPENDIDA';
    fechaInicio: string;
    fechaFin: string;
    referenciaManual: string;
    motivo: string;
    notasInternas: string;
  } | null = null;
  guardandoSusc = false;
  errorModalSusc = '';

  // Modal Confirmación Suspender / Reactivar / Cancelar
  confirmacionSusc: {
    tipo: 'SUSPENDER' | 'REACTIVAR' | 'CANCELAR';
    item: OrganizacionSuscripcionItem;
    titulo: string;
    descripcion: string;
    motivo: string;
    notas: string;
  } | null = null;
  ejecutandoConfirm = false;
  errorConfirm = '';

  // Modal Historial
  historialItem: OrganizacionSuscripcionItem | null = null;
  historial: HistorialSuscripcionItem[] = [];
  pagHistorial: PaginacionAdmin = { pagina: 1, limite: 20, total: 0, totalPaginas: 0 };
  cargandoHistorial = false;
  errorHistorial = '';

  // Modal Plan
  modalPlan: {
    modo: 'CREAR' | 'EDITAR';
    planId?: string;
    codigo: string;
    nombre: string;
    descripcion: string;
    activo: boolean;
    esPlanPrueba: boolean;
    duracionSugeridaDias: number | null;
    orden: number;
  } | null = null;
  guardandoPlan = false;
  errorModalPlan = '';

  readonly estados: EstadoSuscripcion[] = ['SIN_SUSCRIPCION', 'PRUEBA', 'ACTIVA', 'SUSPENDIDA', 'CANCELADA'];
  readonly etiquetasEstado = ETIQUETAS_ESTADO_SUSCRIPCION;
  readonly etiquetasTipo = ETIQUETAS_TIPO_FREELANCE;
  readonly claseEstado = claseEstadoSuscripcion;
  readonly formatearFecha = formatearFechaAdmin;

  constructor(private adminApi: AdminApiService) {}

  ngOnInit(): void {
    void this.cargarPlanesActivos();
    void this.cargarSuscripciones(1);
  }

  async cargarPlanesActivos(): Promise<void> {
    try {
      const res = await this.adminApi.listarPlanes({ pagina: 1, limite: 100, activo: true });
      this.planesActivos = res.datos;
    } catch {
      // El listado principal informará si hay error de red/auth
    }
  }

  async cargarSuscripciones(pagina = this.pagSuscripciones.pagina): Promise<void> {
    this.cargandoSusc = true;
    this.errorSusc = '';
    try {
      const res = await this.adminApi.listarSuscripciones({
        pagina,
        limite: this.pagSuscripciones.limite,
        estado: this.filtroEstado,
        planId: this.filtroPlanId,
        busqueda: this.busquedaSusc
      });
      this.suscripciones = res.datos;
      this.pagSuscripciones = res.paginacion;
      this.resumenEstados = res.resumenEstados;
    } catch (err: any) {
      this.errorSusc = extraerErrorAdmin(err, 'No se pudieron cargar las suscripciones.');
    } finally {
      this.cargandoSusc = false;
    }
  }

  async cargarPlanes(pagina = this.pagPlanes.pagina): Promise<void> {
    this.cargandoPlanes = true;
    this.errorPlanes = '';
    try {
      const activo = this.filtroPlanActivo === '' ? '' : this.filtroPlanActivo === 'true';
      const res = await this.adminApi.listarPlanes({
        pagina,
        limite: this.pagPlanes.limite,
        activo,
        busqueda: this.busquedaPlanes
      });
      this.planes = res.datos;
      this.pagPlanes = res.paginacion;
    } catch (err: any) {
      this.errorPlanes = extraerErrorAdmin(err, 'No se pudo cargar el catálogo de planes.');
    } finally {
      this.cargandoPlanes = false;
    }
  }

  cambiarSubtab(tab: 'SUSCRIPCIONES' | 'PLANES'): void {
    this.subtab = tab;
    if (tab === 'PLANES' && this.planes.length === 0) {
      void this.cargarPlanes(1);
    }
  }

  limpiarFiltrosSusc(): void {
    this.busquedaSusc = '';
    this.filtroEstado = '';
    this.filtroPlanId = '';
    void this.cargarSuscripciones(1);
  }

  abrirAsignar(item: OrganizacionSuscripcionItem): void {
    this.errorModalSusc = '';
    this.modalSuscripcion = {
      modo: 'ASIGNAR',
      item,
      planId: this.planesActivos[0]?.id || '',
      estado: 'ACTIVA',
      fechaInicio: '',
      fechaFin: '',
      referenciaManual: '',
      motivo: '',
      notasInternas: ''
    };
  }

  abrirEditarSuscripcion(item: OrganizacionSuscripcionItem): void {
    this.errorModalSusc = '';
    const estadoActual = item.suscripcion.estado;
    const estadoEditable: 'PRUEBA' | 'ACTIVA' | 'SUSPENDIDA' =
      estadoActual === 'PRUEBA' || estadoActual === 'SUSPENDIDA' ? estadoActual : 'ACTIVA';

    this.modalSuscripcion = {
      modo: 'EDITAR',
      item,
      planId: item.suscripcion.plan?.id || this.planesActivos[0]?.id || '',
      estado: estadoEditable,
      fechaInicio: this.aInputFecha(item.suscripcion.fechaInicio),
      fechaFin: this.aInputFecha(item.suscripcion.fechaFin),
      referenciaManual: item.suscripcion.referenciaManual || '',
      motivo: '',
      notasInternas: item.suscripcion.notasInternas || ''
    };
  }

  async guardarModalSuscripcion(): Promise<void> {
    if (!this.modalSuscripcion || this.guardandoSusc) return;
    const m = this.modalSuscripcion;
    if (!m.planId) {
      this.errorModalSusc = 'Selecciona un plan manual activo.';
      return;
    }
    this.guardandoSusc = true;
    this.errorModalSusc = '';
    try {
      const fechaInicio = m.fechaInicio ? new Date(`${m.fechaInicio}T00:00:00.000Z`).toISOString() : undefined;
      const fechaFin = m.fechaFin ? new Date(`${m.fechaFin}T23:59:59.000Z`).toISOString() : null;
      if (m.modo === 'ASIGNAR') {
        await this.adminApi.asignarSuscripcion(m.item.organizacion.id, {
          planId: m.planId,
          estado: m.estado === 'PRUEBA' ? 'PRUEBA' : 'ACTIVA',
          ...(fechaInicio ? { fechaInicio } : {}),
          fechaFin,
          referenciaManual: m.referenciaManual.trim() || undefined,
          motivo: m.motivo.trim() || undefined,
          notasInternas: m.notasInternas.trim() || undefined
        });
        this.mostrarToast('Suscripción manual asignada.');
      } else {
        await this.adminApi.actualizarSuscripcion(m.item.organizacion.id, {
          planId: m.planId,
          estado: m.estado,
          ...(fechaInicio ? { fechaInicio } : {}),
          fechaFin,
          referenciaManual: m.referenciaManual.trim() || undefined,
          motivo: m.motivo.trim() || undefined,
          notasInternas: m.notasInternas.trim() || undefined
        });
        this.mostrarToast('Suscripción manual actualizada.');
      }
      this.modalSuscripcion = null;
      await this.cargarSuscripciones(this.pagSuscripciones.pagina);
    } catch (err: any) {
      this.errorModalSusc = extraerErrorAdmin(err, 'No se pudo guardar la suscripción.');
    } finally {
      this.guardandoSusc = false;
    }
  }

  pedirConfirmacionSusc(tipo: 'SUSPENDER' | 'REACTIVAR' | 'CANCELAR', item: OrganizacionSuscripcionItem): void {
    this.errorConfirm = '';
    const nombre = item.organizacion.nombre;
    const config = {
      SUSPENDER: {
        titulo: `Suspender suscripción de ${nombre}`,
        descripcion: 'La suscripción comercial pasará a estado SUSPENDIDA manualmente (seguimiento administrativo; no bloquea el acceso de la organización).'
      },
      REACTIVAR: {
        titulo: `Reactivar suscripción de ${nombre}`,
        descripcion: 'La suscripción volverá a estado ACTIVA manualmente (gestión manual, no se procesan pagos).'
      },
      CANCELAR: {
        titulo: `Cancelar suscripción de ${nombre}`,
        descripcion: 'La suscripción pasará a estado CANCELADA y quedará registrada en el historial de auditoría.'
      }
    }[tipo];
    this.confirmacionSusc = { tipo, item, ...config, motivo: '', notas: '' };
  }

  async ejecutarConfirmacionSusc(): Promise<void> {
    if (!this.confirmacionSusc || this.ejecutandoConfirm) return;
    const c = this.confirmacionSusc;
    this.ejecutandoConfirm = true;
    this.errorConfirm = '';
    try {
      if (c.tipo === 'CANCELAR') {
        await this.adminApi.cancelarSuscripcion(c.item.organizacion.id, {
          motivoCancelacion: c.motivo.trim() || undefined,
          notas: c.notas.trim() || undefined
        });
        this.mostrarToast('Suscripción cancelada manualmente.');
      } else {
        await this.adminApi.actualizarSuscripcion(c.item.organizacion.id, {
          estado: c.tipo === 'SUSPENDER' ? 'SUSPENDIDA' : 'ACTIVA',
          motivo: c.motivo.trim() || undefined,
          notasInternas: c.notas.trim() || undefined
        });
        this.mostrarToast(c.tipo === 'SUSPENDER' ? 'Suscripción suspendida.' : 'Suscripción reactivada.');
      }
      this.confirmacionSusc = null;
      await this.cargarSuscripciones(this.pagSuscripciones.pagina);
    } catch (err: any) {
      this.errorConfirm = extraerErrorAdmin(err, 'No se pudo completar la operación.');
    } finally {
      this.ejecutandoConfirm = false;
    }
  }

  async verHistorial(item: OrganizacionSuscripcionItem, pagina = 1): Promise<void> {
    this.historialItem = item;
    this.cargandoHistorial = true;
    this.errorHistorial = '';
    try {
      const res = await this.adminApi.listarHistorialSuscripcion(item.organizacion.id, pagina, 20);
      this.historial = res.datos;
      this.pagHistorial = res.paginacion;
    } catch (err: any) {
      this.errorHistorial = extraerErrorAdmin(err, 'No se pudo cargar el historial.');
    } finally {
      this.cargandoHistorial = false;
    }
  }

  abrirNuevoPlan(): void {
    this.errorModalPlan = '';
    this.modalPlan = {
      modo: 'CREAR',
      codigo: '',
      nombre: '',
      descripcion: '',
      activo: true,
      esPlanPrueba: false,
      duracionSugeridaDias: null,
      orden: 0
    };
  }

  abrirEditarPlan(plan: PlanSuscripcionAdmin): void {
    this.errorModalPlan = '';
    this.modalPlan = {
      modo: 'EDITAR',
      planId: plan.id,
      codigo: plan.codigo,
      nombre: plan.nombre,
      descripcion: plan.descripcion || '',
      activo: plan.activo,
      esPlanPrueba: plan.esPlanPrueba,
      duracionSugeridaDias: plan.duracionSugeridaDias ?? null,
      orden: plan.orden
    };
  }

  async guardarPlan(): Promise<void> {
    if (!this.modalPlan || this.guardandoPlan) return;
    const p = this.modalPlan;
    this.guardandoPlan = true;
    this.errorModalPlan = '';
    try {
      const payload = {
        codigo: p.codigo.trim().toUpperCase(),
        nombre: p.nombre.trim(),
        descripcion: p.descripcion.trim() || null,
        activo: p.activo,
        esPlanPrueba: p.esPlanPrueba,
        duracionSugeridaDias: p.duracionSugeridaDias ? Number(p.duracionSugeridaDias) : null,
        orden: Number(p.orden) || 0
      };
      if (p.modo === 'CREAR') {
        await this.adminApi.crearPlan(payload);
        this.mostrarToast('Plan manual creado.');
      } else if (p.planId) {
        await this.adminApi.actualizarPlan(p.planId, payload);
        this.mostrarToast('Plan manual actualizado.');
      }
      this.modalPlan = null;
      await Promise.all([this.cargarPlanes(this.pagPlanes.pagina), this.cargarPlanesActivos()]);
    } catch (err: any) {
      this.errorModalPlan = extraerErrorAdmin(err, 'No se pudo guardar el plan.');
    } finally {
      this.guardandoPlan = false;
    }
  }

  private aInputFecha(iso?: string | null): string {
    if (!iso) return '';
    return iso.slice(0, 10);
  }

  private mostrarToast(msg: string): void {
    this.toast = msg;
    setTimeout(() => {
      if (this.toast === msg) this.toast = '';
    }, 3200);
  }
}
