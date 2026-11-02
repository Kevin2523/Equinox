import { Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { EquinoxService } from '../services/equinox.service';
import { ClientesProyectosApiService, ClienteApi, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { TrabajoApiService } from '../services/trabajo-api.service';
import { AuthService } from '../auth/auth.service';
import { FacturasApiService, FacturaApi, TotalesFacturasApi, TotalMonedaApi } from '../services/facturas-api.service';
import {
  Cliente,
  Proyecto,
  Tarea,
  Factura,
  ConfiguracionEstudio,
  Notificacion
} from '../models/equinox.model';

@Injectable({ providedIn: 'root' })
export class UiStateService {
  // Navigation & view states
  page: 'hoy' | 'clientes' | 'proyectos' | 'tareas' | 'finanzas' | 'configuracion' | 'portal' = 'hoy';
  tab: 'resumen' | 'tareas' | 'archivos' | 'factura' | 'feedback' = 'resumen';
  mobileMenuOpen = false;

  // Search & Filters
  query = '';
  clientFilter: 'TODOS' | 'ACTIVO' | 'PROSPECTO' = 'TODOS';
  projectFilter = 'TODOS';
  taskFilter: 'TODAS' | 'HOY' | 'PROXIMAS' | 'COMPLETADAS' = 'TODAS';
  invoiceFilter: 'TODAS' | 'PENDIENTES' | 'PAGADAS' = 'TODAS';

  // Overlays & Modals
  searchOpen = false;
  searchLoading = false;
  searchError = '';
  createModalOpen = false;
  activeCreateType: 'Cliente' | 'Proyecto' | 'Tarea' | 'Factura' | null = null;
  notificationsOpen = false;
  collaboratorModalOpen = false;
  clientDetailModal: Cliente | null = null;
  projectDetailModal: Proyecto | null = null;

  // Form states for quick create
  nuevoCliente = { nombre: '', empresa: '', correo: '', telefono: '', notas: '' };
  nuevoProyecto = { nombre: '', clienteId: '', descripcion: '', estado: 'BORRADOR' as ProyectoApi['estado'], presupuesto: 0, moneda: 'PAB', fechaInicio: '', fechaEntrega: '' };
  crearLoading = false;
  createError = '';
  cargandoClientesFactura = false;
  private solicitudClientesFactura = 0;
  nuevaTarea = { proyectoId: '', titulo: '', prioridad: 'ALTA' as 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE', fechaVencimiento: '' };
  nuevaFactura = { clienteId: '', proyectoId: '', concepto: '', monto: 1200, fechaVencimiento: '' };
  compartirNuevaFactura = false;
  nuevoColaborador = { nombre: '', rol: 'Diseñador UI', iniciales: '' };

  // Inline forms
  inlineTaskTitle = '';
  inlineCommentText = '';
  inlineTaskError = '';
  inlineCommentError = '';
  inlineTaskLoading = false;
  inlineCommentLoading = false;

  // Data references from service
  clientes: Cliente[] = [];
  proyectos: Proyecto[] = [];
  configuracion!: ConfiguracionEstudio;
  notificaciones: Notificacion[] = [];
  selectedProject: Proyecto | null = null;
  toastMessage = '';
  facturasReales: Factura[] = [];
  totalesFacturas: TotalesFacturasApi | null = null;
  haCargadoFacturas = false;
  cargandoFacturas = false;
  errorFacturas = '';
  portalMostrarFinanzas: boolean | null = null;
  cargandoPortalFinanzas = false;
  errorPortalFinanzas = '';
  visibilidadFacturaEnCursoId: string | null = null;
  errorVisibilidadFactura = '';

  // Payment modal state
  pagoModalOpen = false;
  facturaSeleccionadaPago: Factura | null = null;
  nuevoPago = { monto: 0, moneda: 'PAB', metodo: 'TRANSFERENCIA', referencia: '', notas: '' };
  pagoLoading = false;
  pagoError = '';

  get totalesPorMoneda(): TotalMonedaApi[] {
    return this.totalesFacturas?.totalesPorMoneda || [];
  }

  constructor(public equinox: EquinoxService, public clientesProyectosApi: ClientesProyectosApiService, private router: Router, public trabajo: TrabajoApiService, private auth: AuthService, public facturasApi?: FacturasApiService) {
    this.initialize();
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      const segmento = event.urlAfterRedirects.split('?')[0].split('/')[1];
      const pagina = segmento === 'dashboard' ? 'hoy' : segmento === 'vista-previa-portal' ? 'portal' : segmento;
      if (['hoy', 'clientes', 'proyectos', 'tareas', 'finanzas', 'configuracion', 'portal'].includes(pagina)) {
        this.page = pagina as typeof this.page;
      }
    });
  }

  private initialize(): void {
    this.clientesProyectosApi.clientes$.subscribe((c) => (this.clientes = c.map((cliente) => this.adaptarCliente(cliente))));
    this.clientesProyectosApi.proyectos$.subscribe((p) => (this.proyectos = p.map((proyecto) => this.adaptarProyecto(proyecto))));
    this.equinox.configuracion$.subscribe((cfg) => (this.configuracion = cfg));
    this.equinox.notificaciones$.subscribe((n) => (this.notificaciones = n));
    this.equinox.proyectoSeleccionado$.subscribe((sel) => {
      if (sel) this.selectedProject = sel;
    });
    this.equinox.toast$.subscribe((msg) => (this.toastMessage = msg));
    this.auth.sesion$.subscribe((sesion) => {
      if (sesion && sesion.contexto?.tipoAcceso === 'ORGANIZACION') {
        void this.cargarFacturas();
        void this.cargarConfiguracionPortalFinanzas();
      } else {
        this.facturasReales = [];
        this.totalesFacturas = null;
        this.haCargadoFacturas = false;
        this.portalMostrarFinanzas = null;
      }
    });
  }

  get mapActive(): boolean {
    return this.page === 'hoy';
  }

  get unreadNotifsCount(): number {
    return this.notificaciones.filter((n) => !n.leida).length;
  }

  // Filtered projects for map or list
  get visibleProjects(): Proyecto[] {
    const q = this.query.trim().toLowerCase();
    let lista = this.proyectos;

    if (this.projectFilter !== 'TODOS') {
      lista = lista.filter((p) => p.estado === this.projectFilter);
    }

    if (!q) return lista;

    return lista.filter((p) =>
      `${p.nombre} ${p.clienteNombre} ${p.tipo} ${p.descripcion}`.toLowerCase().includes(q)
    );
  }

  // Filtered clients
  get visibleClients(): Cliente[] {
    const q = this.query.trim().toLowerCase();
    let lista = this.clientes;

    if (this.clientFilter !== 'TODOS') {
      lista = lista.filter((c) => c.estado === this.clientFilter);
    }

    if (!q) return lista;

    return lista.filter((c) =>
      `${c.nombre} ${c.empresa} ${c.correo} ${c.telefono} ${c.notas}`.toLowerCase().includes(q)
    );
  }

  // Filtered tasks across all projects
  get allTasks(): Tarea[] {
    const tareas: Tarea[] = this.trabajo.tareasActuales.map((tarea) => ({ ...tarea, proyectoNombre: this.proyectos.find((p) => p.id === tarea.proyectoId)?.nombre || '', fechaVencimiento: tarea.fechaVencimiento || '' }));
    const q = this.query.trim().toLowerCase();
    const fecha = new Date();
    const hoy = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
    let res = tareas;

    if (this.taskFilter === 'COMPLETADAS') {
      res = res.filter((t) => t.estado === 'COMPLETADA');
    } else if (this.taskFilter === 'HOY') {
      res = res.filter((t) => t.estado !== 'COMPLETADA' && t.fechaVencimiento.slice(0, 10) === hoy);
    } else if (this.taskFilter === 'PROXIMAS') {
      res = res.filter((t) => t.estado !== 'COMPLETADA' && t.fechaVencimiento.slice(0, 10) > hoy);
    }

    if (!q) return res;
    return res.filter((t) =>
      `${t.titulo} ${t.proyectoNombre} ${t.prioridad}`.toLowerCase().includes(q)
    );
  }

  // Filtered invoices across all projects
  get allInvoices(): Factura[] {
    const q = this.query.trim().toLowerCase();
    let res = this.facturasReales;

    if (this.invoiceFilter === 'PENDIENTES') {
      res = res.filter((f) => f.estado === 'PENDIENTE' || f.estado === 'ENVIADA' || f.estado === 'VENCIDA' || f.estado === 'BORRADOR');
    } else if (this.invoiceFilter === 'PAGADAS') {
      res = res.filter((f) => f.estado === 'PAGADA');
    }

    if (!q) return res;
    return res.filter((f) =>
      `${f.numero} ${f.concepto} ${f.clienteNombre} ${f.proyectoNombre || ''}`.toLowerCase().includes(q)
    );
  }

  // Navigation handlers
  navigate(p: 'hoy' | 'clientes' | 'proyectos' | 'tareas' | 'finanzas' | 'configuracion' | 'portal') {
    this.page = p;
    void this.router.navigate(['/', p === 'hoy' ? 'dashboard' : p === 'portal' ? 'vista-previa-portal' : p]);
    this.query = '';
    this.mobileMenuOpen = false;
    this.notificationsOpen = false;
  }

  selectProject(p: Proyecto) {
    this.selectedProject = p;
    this.equinox.seleccionarProyecto(p);
    this.tab = 'resumen';
    this.equinox.mostrarToast(`Proyecto seleccionado: ${p.nombre}`);
  }

  switchTab(t: 'resumen' | 'tareas' | 'archivos' | 'factura' | 'feedback') {
    this.tab = t;
  }

  toggleTask(tareaId: string) {
    const tarea = this.trabajo.tareasActuales.find((item) => item.id === tareaId);
    if (tarea) void this.trabajo.editarTarea(tarea.proyectoId, tarea.id, { estado: tarea.estado === 'COMPLETADA' ? 'PENDIENTE' : 'COMPLETADA' });
  }

  // Create Flow
  openQuickCreate(type?: 'Cliente' | 'Proyecto' | 'Tarea' | 'Factura') {
    this.createModalOpen = true;
    this.activeCreateType = type || null;
    this.createError = '';
    if (type === 'Tarea') {
      this.nuevaTarea.proyectoId = this.clientesProyectosApi?.proyectoSeleccionado?.id || this.proyectos[0]?.id || '';
    }
    if (type === 'Factura' && this.nuevaFactura) {
      this.compartirNuevaFactura = false;
      this.nuevaFactura.proyectoId = '';
      if (!this.clientes.some((cliente) => cliente.id === this.nuevaFactura.clienteId)) {
        this.nuevaFactura.clienteId = this.clientes[0]?.id || '';
      }
      if (this.clientes.length === 0) void this.cargarClientesParaFactura();
    }
    if (this.clientes && this.clientes.length > 0 && this.nuevoProyecto && !this.nuevoProyecto.clienteId) {
      this.nuevoProyecto.clienteId = this.clientes[0].id;
    }
  }

  selectCreateType(type: 'Cliente' | 'Proyecto' | 'Tarea' | 'Factura') {
    this.activeCreateType = type;
    if (type === 'Factura') {
      this.nuevaFactura.proyectoId = '';
      if (!this.clientes.some((cliente) => cliente.id === this.nuevaFactura.clienteId)) {
        this.nuevaFactura.clienteId = this.clientes[0]?.id || '';
      }
      if (this.clientes.length === 0) void this.cargarClientesParaFactura();
    }
  }

  async cargarClientesParaFactura(): Promise<void> {
    if (!this.clientesProyectosApi || this.cargandoClientesFactura) return;
    const solicitud = ++this.solicitudClientesFactura;
    this.cargandoClientesFactura = true;
    this.createError = '';
    try {
      const clientes = await this.clientesProyectosApi.listarClientes();
      if (solicitud !== this.solicitudClientesFactura || !this.createModalOpen || this.activeCreateType !== 'Factura') return;
      if (!clientes.some((cliente) => cliente.id === this.nuevaFactura.clienteId)) {
        this.nuevaFactura.clienteId = clientes[0]?.id || '';
      }
    } catch {
      if (solicitud === this.solicitudClientesFactura && this.createModalOpen && this.activeCreateType === 'Factura') {
        this.createError = 'No se pudieron cargar los clientes. Reintenta.';
      }
    } finally {
      if (solicitud === this.solicitudClientesFactura) this.cargandoClientesFactura = false;
    }
  }

  async submitCreate() {
    if (this.activeCreateType === 'Cliente') {
      if (!this.nuevoCliente.nombre) return;
      this.crearLoading = true; this.createError = '';
      try {
        await this.clientesProyectosApi.crearCliente({ nombre: this.nuevoCliente.nombre.trim(), empresa: this.nuevoCliente.empresa || null, correo: this.nuevoCliente.correo || null, telefono: this.nuevoCliente.telefono || null, notasInternas: this.nuevoCliente.notas || null });
        this.nuevoCliente = { nombre: '', empresa: '', correo: '', telefono: '', notas: '' };
      } catch (error: any) { this.createError = error?.status === 422 ? 'Revisa los datos ingresados.' : 'No se pudo guardar el cliente.'; this.crearLoading = false; return; }
      this.crearLoading = false;
    } else if (this.activeCreateType === 'Proyecto') {
      if (!this.nuevoProyecto.nombre) return;
      if (!this.nuevoProyecto.clienteId) { this.createError = 'Selecciona un cliente de tu organización.'; return; }
      this.crearLoading = true; this.createError = '';
      try {
        await this.clientesProyectosApi.crearProyecto({ nombre: this.nuevoProyecto.nombre.trim(), clienteId: this.nuevoProyecto.clienteId, descripcion: this.nuevoProyecto.descripcion || null, estado: this.nuevoProyecto.estado, presupuesto: Number(this.nuevoProyecto.presupuesto) || 0, moneda: this.nuevoProyecto.moneda || 'PAB', fechaInicio: this.nuevoProyecto.fechaInicio || null, fechaEntrega: this.nuevoProyecto.fechaEntrega || null });
        this.nuevoProyecto = { nombre: '', clienteId: this.clientes[0]?.id || '', descripcion: '', estado: 'BORRADOR', presupuesto: 0, moneda: 'PAB', fechaInicio: '', fechaEntrega: '' };
      } catch (error: any) { this.createError = error?.status === 422 ? 'El cliente seleccionado o los datos no son válidos.' : 'No se pudo guardar el proyecto.'; this.crearLoading = false; return; }
      this.crearLoading = false;
    } else if (this.activeCreateType === 'Tarea') {
      const pId = this.nuevaTarea.proyectoId;
      if (this.nuevaTarea.titulo.trim().length < 2 || !pId || !this.proyectos.some((p) => p.id === pId)) {
        this.createError = 'Escribe un título de al menos dos caracteres y selecciona un proyecto.'; return;
      }
      this.crearLoading = true; this.createError = '';
      try {
        await this.trabajo.crearTarea(pId, { titulo: this.nuevaTarea.titulo.trim(), prioridad: this.nuevaTarea.prioridad,
          fechaVencimiento: this.nuevaTarea.fechaVencimiento || null });
        this.nuevaTarea = { proyectoId: '', titulo: '', prioridad: 'ALTA', fechaVencimiento: '' };
      } catch { this.createError = 'No se pudo crear la tarea. Reintenta.'; this.crearLoading = false; return; }
      this.crearLoading = false;
    } else if (this.activeCreateType === 'Factura') {
      if (this.cargandoClientesFactura) return;
      if (!this.nuevaFactura.concepto || !this.nuevaFactura.monto) {
        this.createError = 'El concepto y el monto son obligatorios.';
        return;
      }
      const textoMontoFactura = String(this.nuevaFactura.monto).trim();
      if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(textoMontoFactura) || Number(textoMontoFactura) <= 0) {
        this.createError = 'Introduce un monto positivo con máximo dos decimales.';
        return;
      }
      if (!this.nuevaFactura.clienteId || !this.clientes.some(c => c.id === this.nuevaFactura.clienteId)) {
        this.createError = 'Selecciona un cliente válido.';
        return;
      }
      if (this.nuevaFactura.fechaVencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(this.nuevaFactura.fechaVencimiento)) {
        this.createError = 'Selecciona una fecha de vencimiento válida.';
        return;
      }
      const cId = this.nuevaFactura.clienteId;
      if (!cId) {
        this.createError = 'Debes seleccionar un cliente válido.';
        return;
      }
      this.crearLoading = true;
      this.createError = '';
      try {
        if (this.facturasApi && this.auth.token) {
          await this.facturasApi.crearFactura({
            clienteId: cId,
            proyectoId: null,
            concepto: this.nuevaFactura.concepto.trim(),
            monto: Number(this.nuevaFactura.monto),
            estado: this.compartirNuevaFactura ? 'ENVIADA' : 'BORRADOR',
            visibleEnPortal: this.compartirNuevaFactura,
            fechaVencimiento: this.nuevaFactura.fechaVencimiento || null
          });
          await this.cargarFacturas();
          this.nuevaFactura = { clienteId: '', proyectoId: '', concepto: '', monto: 1200, fechaVencimiento: '' };
          this.compartirNuevaFactura = false;
          this.createModalOpen = false;
          this.activeCreateType = null;
          this.equinox.mostrarToast('Factura generada con éxito');
        } else {
          this.createError = 'Servicio de facturación no disponible.';
        }
      } catch (error: any) {
        if (error?.status === 403) {
          this.createError = 'Solo los propietarios pueden emitir facturas.';
        } else if (error?.status === 422) {
          const detalle = error?.error?.detalles?.[0];
          this.createError = typeof error?.error?.error === 'string' && error.error.error !== 'Datos inválidos'
            ? error.error.error
            : detalle && Array.isArray(detalle.path) && typeof detalle.message === 'string'
              ? `${detalle.path.join('.') || 'Factura'}: ${detalle.message}`
              : 'Revisa los datos ingresados en la factura.';
        } else {
          this.createError = 'No se pudo generar la factura en el servidor.';
        }
        return;
      } finally {
        this.crearLoading = false;
      }
      return;
    }

    this.createModalOpen = false;
    this.activeCreateType = null;
  }

  private adaptarCliente(cliente: ClienteApi): Cliente {
    return { id: cliente.id, nombre: cliente.nombre, empresa: cliente.empresa || '', correo: cliente.correo || '', telefono: cliente.telefono || '', estado: cliente.estado, notas: cliente.notasInternas || '', proyectosCount: cliente._count?.proyectos || 0, avatarColor: '#3568f6' };
  }

  private adaptarProyecto(proyecto: ProyectoApi): Proyecto {
    const badge: Proyecto['estadoBadgeClass'] = proyecto.estado === 'ACTIVO' ? 'progreso' : proyecto.estado === 'COMPLETADO' ? 'completado' : proyecto.estado === 'BORRADOR' ? 'planificacion' : proyecto.estado === 'PAUSADO' ? 'aprobar' : 'revision';
    return { id: proyecto.id, key: proyecto.id, nombre: proyecto.nombre, clienteId: proyecto.clienteId, clienteNombre: proyecto.cliente?.nombre || '', tipo: 'Proyecto', descripcion: proyecto.descripcion || '', progreso: 0, estado: proyecto.estado, estadoBadgeClass: badge, presupuesto: Number(proyecto.presupuesto || 0), fechaEntrega: proyecto.fechaEntrega || '', tag: proyecto.nombre.slice(0, 2).toUpperCase(), color: '#3568f6', x: 50, y: 50, visualClass: 'visual-building', participantes: [], tareas: [], hitos: [], archivos: [], facturas: [], comentarios: [], entregaDestacada: { fecha: proyecto.fechaEntrega || '', descripcion: '' } };
  }

  closeCreateModal() {
    this.solicitudClientesFactura++;
    this.cargandoClientesFactura = false;
    this.compartirNuevaFactura = false;
    this.createModalOpen = false;
    this.activeCreateType = null;
  }

  // Inline inspector actions
  async addInlineTask(): Promise<void> {
    const id = this.clientesProyectosApi.proyectoSeleccionado?.id;
    const titulo = this.inlineTaskTitle.trim();
    if (!titulo || !id || this.inlineTaskLoading) return;
    this.inlineTaskLoading = true; this.inlineTaskError = '';
    try {
      await this.trabajo.crearTarea(id, { titulo, prioridad: 'ALTA' });
      if (this.inlineTaskTitle.trim() === titulo) this.inlineTaskTitle = '';
    } catch {
      this.inlineTaskError = 'No se pudo crear la tarea. Reintenta.';
    } finally { this.inlineTaskLoading = false; }
  }

  async addInlineComment(): Promise<void> {
    const id = this.clientesProyectosApi.proyectoSeleccionado?.id;
    const contenido = this.inlineCommentText.trim();
    if (!contenido || !id || this.inlineCommentLoading) return;
    this.inlineCommentLoading = true; this.inlineCommentError = '';
    try {
      await this.trabajo.comentar(id, contenido);
      if (this.inlineCommentText.trim() === contenido) this.inlineCommentText = '';
    } catch {
      this.inlineCommentError = 'No se pudo enviar el comentario. Reintenta.';
    } finally { this.inlineCommentLoading = false; }
  }

  addClientFeedbackPortal(text: string) {
    if (!text.trim() || !this.selectedProject) return;
    this.equinox.agregarComentario(this.selectedProject.id, text.trim(), 'CLIENTE');
  }

  abrirModalPago(factura: Factura): void {
    this.facturaSeleccionadaPago = factura;
    const saldo = factura.montoPendiente !== undefined && factura.montoPendiente > 0
      ? factura.montoPendiente
      : factura.monto;
    this.nuevoPago = {
      monto: saldo,
      moneda: factura.moneda || 'PAB',
      metodo: 'TRANSFERENCIA',
      referencia: '',
      notas: '',
    };
    this.pagoError = '';
    this.pagoModalOpen = true;
  }

  cerrarModalPago(): void {
    if (!this.pagoLoading) {
      this.pagoModalOpen = false;
      this.pagoError = '';
      this.facturaSeleccionadaPago = null;
    }
  }

  async confirmarPago(): Promise<void> {
    if (!this.facturaSeleccionadaPago) return;
    const textoMonto = String(this.nuevoPago.monto).trim();
    const monto = Number(textoMonto);
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(textoMonto) || !Number.isFinite(monto) || monto <= 0) {
      this.pagoError = 'Introduce un monto positivo con máximo dos decimales.';
      return;
    }
    if (!this.facturasApi || !this.auth.token) {
      this.pagoError = 'No hay conexión autenticada con el servidor.';
      return;
    }
    this.pagoLoading = true;
    this.pagoError = '';
    try {
      await this.facturasApi.registrarPago(this.facturaSeleccionadaPago.id, {
        monto,
        moneda: this.nuevoPago.moneda,
        metodo: this.nuevoPago.metodo,
        referencia: this.nuevoPago.referencia?.trim() || null,
        notas: this.nuevoPago.notas?.trim() || null,
      });
      await this.cargarFacturas();
      const num = this.facturaSeleccionadaPago.numero;
      this.pagoModalOpen = false;
      this.facturaSeleccionadaPago = null;
      this.equinox.mostrarToast(`Pago registrado para la factura ${num}`);
    } catch (error: any) {
      if (error?.status === 403) {
        this.pagoError = 'Solo los propietarios pueden registrar pagos.';
      } else if (error?.status === 422) {
        this.pagoError = error?.error?.mensaje || 'El monto o los datos del pago no son válidos.';
      } else {
        this.pagoError = 'No se pudo registrar el pago en el servidor.';
      }
    } finally {
      this.pagoLoading = false;
    }
  }

  markInvoicePaid(facturaId: string): void {
    const factura = this.facturasReales.find((f) => f.id === facturaId);
    if (factura) {
      this.abrirModalPago(factura);
    }
  }

  get puedeGestionarFacturas(): boolean {
    return this.auth.sesion?.contexto.tipoAcceso === 'ORGANIZACION'
      && this.auth.sesion.contexto.rolOrganizacion === 'PROPIETARIO';
  }

  async cargarConfiguracionPortalFinanzas(): Promise<void> {
    if (!this.facturasApi?.consultarPortalFinanzas || !this.auth.token) return;
    this.cargandoPortalFinanzas = true;
    this.errorPortalFinanzas = '';
    try {
      const organizacion = await this.facturasApi.consultarPortalFinanzas();
      this.portalMostrarFinanzas = organizacion.portalMostrarFinanzas;
    } catch {
      this.portalMostrarFinanzas = null;
      this.errorPortalFinanzas = 'No se pudo consultar si las facturas están habilitadas en el portal.';
    } finally {
      this.cargandoPortalFinanzas = false;
    }
  }

  async cambiarPortalFinanzas(): Promise<void> {
    if (!this.facturasApi || !this.puedeGestionarFacturas || this.portalMostrarFinanzas === null || this.cargandoPortalFinanzas) return;
    this.cargandoPortalFinanzas = true;
    this.errorPortalFinanzas = '';
    try {
      const resultado = await this.facturasApi.configurarPortalFinanzas(!this.portalMostrarFinanzas);
      this.portalMostrarFinanzas = resultado.portalMostrarFinanzas;
    } catch {
      this.errorPortalFinanzas = 'No se pudo guardar la configuración del portal. Reintenta.';
    } finally {
      this.cargandoPortalFinanzas = false;
    }
  }

  async cambiarVisibilidadFactura(factura: Factura): Promise<void> {
    if (!this.facturasApi || !this.auth.token || this.visibilidadFacturaEnCursoId) return;
    if (factura.estado === 'CANCELADA') return;
    this.visibilidadFacturaEnCursoId = factura.id;
    this.errorVisibilidadFactura = '';
    const emitir = factura.estado === 'BORRADOR';
    try {
      await this.facturasApi.actualizarFactura(factura.id, emitir
        ? { estado: 'ENVIADA', visibleEnPortal: true }
        : { visibleEnPortal: !factura.visibleEnPortal });
      await this.cargarFacturas();
    } catch {
      this.errorVisibilidadFactura = 'No se pudo cambiar la visibilidad de la factura. Reintenta.';
    } finally {
      this.visibilidadFacturaEnCursoId = null;
    }
  }

  async cargarFacturas(): Promise<void> {
    if (!this.facturasApi || !this.auth.token) {
      this.facturasReales = [];
      this.totalesFacturas = null;
      return;
    }
    this.cargandoFacturas = true;
    this.errorFacturas = '';
    try {
      const [facturas, totales] = await Promise.all([
        this.facturasApi.listarFacturas(),
        this.facturasApi.consultarTotales()
      ]);
      this.facturasReales = facturas.map((f) => this.adaptarFactura(f));
      this.totalesFacturas = totales;
    } catch {
      this.errorFacturas = 'No se pudieron cargar las facturas autorizadas.';
      this.facturasReales = [];
      this.totalesFacturas = null;
    } finally {
      this.cargandoFacturas = false;
    }
  }

  private adaptarFactura(f: FacturaApi): Factura {
    const estado = f.estado;
    const monto = typeof f.monto === 'number' ? f.monto : parseFloat(f.monto as any) || 0;
    const montoPendiente = f.montoPendiente !== undefined ? f.montoPendiente : monto;
    return {
      id: f.id,
      numero: f.numero,
      concepto: f.concepto,
      clienteId: f.clienteId,
      clienteNombre: f.cliente?.nombre || this.clientes?.find((c) => c.id === f.clienteId)?.nombre || 'Cliente',
      proyectoId: f.proyectoId || undefined,
      proyectoNombre: f.proyecto?.nombre || this.proyectos?.find((p) => p.id === f.proyectoId)?.nombre || '',
      monto,
      moneda: f.moneda || 'PAB',
      visibleEnPortal: f.visibleEnPortal,
      montoPendiente,
      estado,
      fechaEmision: f.fechaEmision ? f.fechaEmision.slice(0, 10) : '',
      fechaVencimiento: f.fechaVencimiento ? f.fechaVencimiento.slice(0, 10) : 'Sin fecha',
      pagadaEn: f.pagadaEn ? f.pagadaEn.slice(0, 10) : undefined
    };
  }

  // Collaborator action
  addCollaborator() {
    if (!this.nuevoColaborador.nombre.trim() || !this.selectedProject) return;
    const iniciales = this.nuevoColaborador.nombre
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    this.selectedProject.participantes.push({
      iniciales,
      color: '#7a55d8'
    });
    this.equinox.mostrarToast(`Colaborador ${this.nuevoColaborador.nombre} añadido`);
    this.nuevoColaborador = { nombre: '', rol: 'Diseñador UI', iniciales: '' };
    this.collaboratorModalOpen = false;
  }

  // Global search
  openSearch() {
    this.searchOpen = true;
    this.searchError = '';
    void this.cargarTareasBusqueda();
    setTimeout(() => {
      const el = document.getElementById('globalSearchInput');
      if (el) el.focus();
    }, 50);
  }

  async cargarTareasBusqueda(): Promise<void> {
    if (this.searchLoading || this.auth.sesion?.contexto.tipoAcceso !== 'ORGANIZACION') return;
    const token = this.auth.token;
    this.searchLoading = true; this.searchError = '';
    try {
      const proyectos = this.clientesProyectosApi.proyectos.length ? this.clientesProyectosApi.proyectos : await this.clientesProyectosApi.listarProyectos();
      const tareas = (await Promise.all(proyectos.map((proyecto) => this.trabajo.listarTareas(proyecto.id)))).flat();
      if (this.auth.token === token) this.trabajo.registrarTareas(tareas);
    } catch {
      if (this.auth.token === token) this.searchError = 'No se pudieron buscar las tareas.';
    } finally { this.searchLoading = false; }
  }

  closeSearch() {
    this.searchOpen = false;
  }

  selectSearchResult(type: 'proyecto' | 'cliente' | 'tarea' | 'factura', item: any) {
    this.searchOpen = false;
    if (type === 'proyecto') {
      void this.clientesProyectosApi.seleccionarProyecto(item.id).catch(() => {
        this.equinox.mostrarToast('No se pudo consultar el proyecto.');
      });
      this.navigate('hoy');
    } else if (type === 'cliente') {
      this.navigate('clientes');
      this.clientDetailModal = item;
    } else if (type === 'tarea') {
      this.navigate('tareas');
    } else if (type === 'factura') {
      this.navigate('finanzas');
    }
  }

  toggleNotifications() {
    this.notificationsOpen = !this.notificationsOpen;
    if (this.notificationsOpen) {
      this.equinox.marcarNotificacionesLeidas();
    }
  }

  saveConfig() {
    this.equinox.actualizarConfiguracion(this.configuracion);
  }

  handleKeyboardShortcut(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closeSearch();
      this.closeCreateModal();
      this.notificationsOpen = false;
      this.collaboratorModalOpen = false;
      this.clientDetailModal = null;
      this.projectDetailModal = null;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openSearch();
    }
  }
}
