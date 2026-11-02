import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ClienteApi, ClientesProyectosApiService, EstadoProyectoApi, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { ComentarioApi, HitoApi, TareaApi, TrabajoApiService, progresoTareas } from '../services/trabajo-api.service';

@Component({ selector: 'app-proyectos', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './proyectos.component.html', styleUrl: './proyectos.component.css' })
export class ProyectosComponent implements OnInit, OnDestroy {
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
  detalleId: string | null = null;
  tareasDetalle: TareaApi[] = [];
  hitosDetalle: HitoApi[] = [];
  comentariosDetalle: ComentarioApi[] = [];
  nuevoHito = { titulo: '', descripcion: '', fechaObjetivo: '', visibleEnPortal: false };
  editandoHitoId: string | null = null;
  confirmandoHitoId: string | null = null;
  hitoBorrador = { titulo: '', descripcion: '', estado: 'PENDIENTE' as HitoApi['estado'], fechaObjetivo: '', visibleEnPortal: false };
  comentarioNuevo = '';
  guardandoHito = false;
  enviandoComentario = false;
  errorHitos = '';
  errorComentario = '';
  private solicitudDetalle = 0;
  private operacionHito = 0;
  private operacionComentario = 0;
  private reiniciarDetalle(): void {
    ++this.operacionHito; ++this.operacionComentario;
    this.guardandoHito = false; this.enviandoComentario = false;
    this.nuevoHito = { titulo: '', descripcion: '', fechaObjetivo: '', visibleEnPortal: false };
    this.hitoBorrador = { titulo: '', descripcion: '', estado: 'PENDIENTE', fechaObjetivo: '', visibleEnPortal: false };
    this.comentarioNuevo = ''; this.editandoHitoId = null; this.confirmandoHitoId = null;
    this.errorHitos = ''; this.errorComentario = '';
  }
  formulario = this.formularioVacio();

  constructor(public api: ClientesProyectosApiService, private route: ActivatedRoute, private trabajo: TrabajoApiService) {}
  ngOnInit(): void {
    void this.inicializar();
  }
  ngOnDestroy(): void { this.cerrarDetalle(); }

  get proyectos(): ProyectoApi[] { return this.api.proyectos; }
  get proyectosVisibles(): ProyectoApi[] {
    const query = this.busqueda.trim().toLocaleLowerCase();
    return this.proyectos.filter((p) => (this.filtroEstado === 'TODOS' || p.estado === this.filtroEstado) &&
      (!query || `${p.nombre} ${p.cliente?.nombre || ''} ${p.cliente?.empresa || ''} ${p.descripcion || ''}`.toLocaleLowerCase().includes(query)));
  }
  get proyectosActivos(): number { return this.proyectos.filter((p) => p.estado === 'ACTIVO').length; }
  get progresoProyecto(): number | null { return progresoTareas(this.tareasDetalle); }
  autor(comentario: ComentarioApi): string {
    const nombre = [comentario.usuario?.nombre, comentario.usuario?.apellido].filter(Boolean).join(' ');
    return nombre || 'Cuenta eliminada';
  }
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
    this.modalDetalle = true;
    await this.cargarDetalle(proyecto.id);
  }

  async cargarDetalle(id: string): Promise<void> {
    if (!id) return;
    this.reiniciarDetalle();
    this.detalleId = id;
    const solicitud = ++this.solicitudDetalle;
    this.detalleCargando = true; this.detalleError = ''; this.proyectoDetalle = null;
    this.tareasDetalle = []; this.hitosDetalle = []; this.comentariosDetalle = [];
    this.errorHitos = ''; this.errorComentario = '';
    try {
      const [proyecto, tareas, hitos, comentarios] = await Promise.all([
        this.api.consultarProyecto(id), this.trabajo.listarTareas(id), this.trabajo.listarHitos(id), this.trabajo.listarComentarios(id)
      ]);
      if (solicitud !== this.solicitudDetalle || !this.modalDetalle) return;
      this.proyectoDetalle = proyecto; this.tareasDetalle = tareas; this.hitosDetalle = hitos; this.comentariosDetalle = comentarios;
    } catch {
      if (solicitud === this.solicitudDetalle && this.modalDetalle) this.detalleError = 'No se pudieron consultar tareas, hitos o comentarios. Reintenta.';
    } finally {
      if (solicitud === this.solicitudDetalle) this.detalleCargando = false;
    }
  }
  cerrarDetalle(): void { this.reiniciarDetalle(); ++this.solicitudDetalle; this.modalDetalle = false; this.proyectoDetalle = null; this.detalleId = null; }

  async crearHito(): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || this.guardandoHito) return;
    if (this.nuevoHito.titulo.trim().length < 2) { this.errorHitos = 'El título requiere al menos dos caracteres.'; return; }
    const generacion = ++this.operacionHito;
    this.guardandoHito = true; this.errorHitos = '';
    try {
      const hito = await this.trabajo.crearHito(id, { titulo: this.nuevoHito.titulo.trim(), descripcion: this.nuevoHito.descripcion.trim() || null,
        fechaObjetivo: this.nuevoHito.fechaObjetivo || null, visibleEnPortal: this.nuevoHito.visibleEnPortal });
      if (generacion === this.operacionHito && this.proyectoDetalle?.id === id && this.modalDetalle) {
        this.hitosDetalle = [...this.hitosDetalle, hito];
        this.nuevoHito = { titulo: '', descripcion: '', fechaObjetivo: '', visibleEnPortal: false };
      }
    } catch { if (generacion === this.operacionHito) this.errorHitos = 'No se pudo crear el hito. Reintenta.'; }
    finally { if (generacion === this.operacionHito) this.guardandoHito = false; }
  }
  editarHito(hito: HitoApi): void {
    this.editandoHitoId = hito.id; this.errorHitos = '';
    this.hitoBorrador = { titulo: hito.titulo, descripcion: hito.descripcion || '', estado: hito.estado, fechaObjetivo: hito.fechaObjetivo?.slice(0, 10) || '', visibleEnPortal: hito.visibleEnPortal };
  }
  async guardarHito(hito: HitoApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || this.guardandoHito) return;
    if (this.hitoBorrador.titulo.trim().length < 2) { this.errorHitos = 'El título requiere al menos dos caracteres.'; return; }
    const generacion = ++this.operacionHito;
    this.guardandoHito = true; this.errorHitos = '';
    try {
      const actualizado = await this.trabajo.editarHito(id, hito.id, { titulo: this.hitoBorrador.titulo.trim(), descripcion: this.hitoBorrador.descripcion.trim() || null, estado: this.hitoBorrador.estado,
        fechaObjetivo: this.hitoBorrador.fechaObjetivo || null, visibleEnPortal: this.hitoBorrador.visibleEnPortal });
      if (generacion === this.operacionHito && this.proyectoDetalle?.id === id && this.modalDetalle) {
        this.hitosDetalle = this.hitosDetalle.map((item) => item.id === hito.id ? actualizado : item);
        this.editandoHitoId = null;
      }
    } catch { if (generacion === this.operacionHito) this.errorHitos = 'No se pudo guardar el hito. Reintenta.'; }
    finally { if (generacion === this.operacionHito) this.guardandoHito = false; }
  }
  async eliminarHito(hito: HitoApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || this.guardandoHito) return;
    const generacion = ++this.operacionHito;
    this.guardandoHito = true; this.errorHitos = '';
    try {
      await this.trabajo.eliminarHito(id, hito.id);
      if (generacion === this.operacionHito && this.proyectoDetalle?.id === id && this.modalDetalle) this.hitosDetalle = this.hitosDetalle.filter((item) => item.id !== hito.id);
    } catch { if (generacion === this.operacionHito) this.errorHitos = 'No se pudo eliminar el hito. Reintenta.'; }
    finally { if (generacion === this.operacionHito) this.guardandoHito = false; }
  }
  async enviarComentario(): Promise<void> {
    const id = this.proyectoDetalle?.id;
    const contenido = this.comentarioNuevo.trim();
    if (!id || this.enviandoComentario) return;
    if (!contenido || contenido.length > 2000) { this.errorComentario = 'Escribe entre 1 y 2000 caracteres.'; return; }
    const generacion = ++this.operacionComentario;
    this.enviandoComentario = true; this.errorComentario = '';
    try {
      const comentario = await this.trabajo.comentar(id, contenido);
      if (generacion === this.operacionComentario && this.proyectoDetalle?.id === id && this.modalDetalle) { this.comentariosDetalle = [...this.comentariosDetalle, comentario]; this.comentarioNuevo = ''; }
    } catch { if (generacion === this.operacionComentario) this.errorComentario = 'No se pudo enviar el comentario. Reintenta.'; }
    finally { if (generacion === this.operacionComentario) this.enviandoComentario = false; }
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
