import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ClienteApi, ClientesProyectosApiService, EstadoProyectoApi, ProyectoApi } from '../services/clientes-proyectos-api.service';

@Component({ selector: 'app-proyectos', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './proyectos.component.html' })
export class ProyectosComponent implements OnInit {
  clientes: ClienteApi[] = [];
  busqueda = '';
  filtroEstado: 'TODOS' | EstadoProyectoApi = 'TODOS';
  cargando = false;
  guardando = false;
  error = '';
  errorGuardar = '';
  enviado = false;
  modalFormulario = false;
  modalDetalle = false;
  detalleCargando = false;
  detalleError = '';
  editandoId: string | null = null;
  proyectoDetalle: ProyectoApi | null = null;
  formulario = this.formularioVacio();

  constructor(public api: ClientesProyectosApiService, private route: ActivatedRoute) {}
  ngOnInit(): void {
    void this.inicializar();
  }

  get proyectos(): ProyectoApi[] { return this.api.proyectos; }
  get proyectosVisibles(): ProyectoApi[] {
    const query = this.busqueda.trim().toLocaleLowerCase();
    return this.proyectos.filter((p) => (this.filtroEstado === 'TODOS' || p.estado === this.filtroEstado) &&
      (!query || `${p.nombre} ${p.cliente?.nombre || ''} ${p.cliente?.empresa || ''} ${p.descripcion || ''}`.toLocaleLowerCase().includes(query)));
  }
  get proyectosActivos(): number { return this.proyectos.filter((p) => p.estado === 'ACTIVO').length; }
  claseEstado(estado: EstadoProyectoApi): string {
    return `badge-${estado === 'ACTIVO' ? 'progreso' : estado === 'COMPLETADO' ? 'completado' : estado === 'BORRADOR' ? 'planificacion' : estado === 'PAUSADO' ? 'aprobar' : 'revision'}`;
  }

  private async inicializar(): Promise<void> {
    if (await this.cargar()) {
      const editarId = this.route.snapshot.queryParamMap.get('editar');
      if (editarId) await this.abrirEdicion(editarId);
    }
  }

  async cargar(): Promise<boolean> {
    this.cargando = true; this.error = '';
    try { await Promise.all([this.api.listarProyectos(), this.api.listarClientes()]); this.clientes = this.api.clientes; return true; }
    catch { this.error = 'No se pudieron cargar los proyectos y clientes. Comprueba la conexión e inténtalo de nuevo.'; return false; }
    finally { this.cargando = false; }
  }

  async reintentarCarga(): Promise<void> {
    if (await this.cargar()) {
      const editarId = this.route.snapshot.queryParamMap.get('editar');
      if (editarId) await this.abrirEdicion(editarId);
    }
  }

  nuevo(): void { this.editandoId = null; this.formulario = this.formularioVacio(); this.formulario.clienteId = this.clientes[0]?.id || ''; this.enviado = false; this.errorGuardar = ''; this.modalFormulario = true; }

  async verDetalle(proyecto: ProyectoApi): Promise<void> {
    this.modalDetalle = true; this.detalleCargando = true; this.detalleError = ''; this.proyectoDetalle = null;
    try { this.proyectoDetalle = await this.api.consultarProyecto(proyecto.id); }
    catch { this.detalleError = 'No se pudieron consultar los datos de este proyecto.'; }
    finally { this.detalleCargando = false; }
  }

  async abrirEdicion(id: string): Promise<void> {
    if (this.cargando || !this.clientes.length) return;
    this.editandoId = id; this.detalleCargando = true; this.detalleError = ''; this.errorGuardar = '';
    try {
      const proyecto = await this.api.consultarProyecto(id);
      if (!this.clientes.some((cliente) => cliente.id === proyecto.clienteId)) {
        this.error = 'No se pudo cargar el cliente asociado al proyecto. Reintenta la carga para editarlo.';
        this.modalFormulario = false;
        return;
      }
      this.formulario = { nombre: proyecto.nombre, clienteId: proyecto.clienteId, descripcion: proyecto.descripcion || '', estado: proyecto.estado, presupuesto: proyecto.presupuesto === null ? '' : String(proyecto.presupuesto), moneda: proyecto.moneda, fechaInicio: proyecto.fechaInicio?.slice(0, 10) || '', fechaEntrega: proyecto.fechaEntrega?.slice(0, 10) || '' };
      this.modalDetalle = false; this.modalFormulario = true; this.enviado = false;
    } catch { this.detalleError = 'No se pudo abrir el proyecto para editarlo.'; this.modalDetalle = true; }
    finally { this.detalleCargando = false; }
  }

  async guardar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || !this.formulario.clienteId || this.guardando) return;
    this.guardando = true; this.errorGuardar = '';
    const datos = {
      nombre: this.formulario.nombre.trim(), clienteId: this.formulario.clienteId,
      descripcion: this.formulario.descripcion.trim() || null, estado: this.formulario.estado,
      presupuesto: this.formulario.presupuesto === '' ? null : Number(this.formulario.presupuesto),
      moneda: this.formulario.moneda.trim().toUpperCase(),
      fechaInicio: this.formulario.fechaInicio || null, fechaEntrega: this.formulario.fechaEntrega || null
    };
    try {
      if (this.editandoId) await this.api.editarProyecto(this.editandoId, datos);
      else await this.api.crearProyecto(datos);
      this.modalFormulario = false;
    } catch (error: any) {
      this.errorGuardar = error?.status === 422 ? 'El cliente seleccionado o los datos del proyecto no son válidos.' : error?.status === 404 ? 'El proyecto ya no está disponible.' : 'No se pudo guardar el proyecto.';
    } finally { this.guardando = false; }
  }

  private formularioVacio() {
    return { nombre: '', clienteId: '', descripcion: '', estado: 'BORRADOR' as EstadoProyectoApi, presupuesto: '0', moneda: 'PAB', fechaInicio: '', fechaEntrega: '' };
  }
}
