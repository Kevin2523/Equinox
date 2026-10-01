import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EquinoxService } from './services/equinox.service';
import {
  Cliente,
  Proyecto,
  Tarea,
  Factura,
  ConfiguracionEstudio,
  Notificacion
} from './models/equinox.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
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
  createModalOpen = false;
  activeCreateType: 'Cliente' | 'Proyecto' | 'Tarea' | 'Factura' | null = null;
  notificationsOpen = false;
  collaboratorModalOpen = false;
  clientDetailModal: Cliente | null = null;
  projectDetailModal: Proyecto | null = null;

  // Form states for quick create
  nuevoCliente = { nombre: '', empresa: '', correo: '', telefono: '', notas: '' };
  nuevoProyecto = { nombre: '', clienteId: '', tipo: 'Sitio web', presupuesto: 2000, fechaEntrega: '', color: '#3568f6' };
  nuevaTarea = { proyectoId: '', titulo: '', prioridad: 'ALTA' as 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE', fechaVencimiento: '' };
  nuevaFactura = { clienteId: '', proyectoId: '', concepto: '', monto: 1200, fechaVencimiento: '' };
  nuevoColaborador = { nombre: '', rol: 'Diseñador UI', iniciales: '' };

  // Inline forms
  inlineTaskTitle = '';
  inlineCommentText = '';

  // Data references from service
  clientes: Cliente[] = [];
  proyectos: Proyecto[] = [];
  configuracion!: ConfiguracionEstudio;
  notificaciones: Notificacion[] = [];
  selectedProject: Proyecto | null = null;
  toastMessage = '';

  constructor(public equinox: EquinoxService) {}

  ngOnInit(): void {
    this.equinox.clientes$.subscribe((c) => (this.clientes = c));
    this.equinox.proyectos$.subscribe((p) => {
      this.proyectos = p;
      if (!this.selectedProject && p.length > 0) {
        this.selectedProject = p[0];
      }
    });
    this.equinox.configuracion$.subscribe((cfg) => (this.configuracion = cfg));
    this.equinox.notificaciones$.subscribe((n) => (this.notificaciones = n));
    this.equinox.proyectoSeleccionado$.subscribe((sel) => {
      if (sel) this.selectedProject = sel;
    });
    this.equinox.toast$.subscribe((msg) => (this.toastMessage = msg));
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
    const tareas = this.equinox.todasLasTareas();
    const q = this.query.trim().toLowerCase();
    let res = tareas;

    if (this.taskFilter === 'COMPLETADAS') {
      res = res.filter((t) => t.estado === 'COMPLETADA');
    } else if (this.taskFilter === 'HOY') {
      res = res.filter((t) => t.estado !== 'COMPLETADA' && (t.fechaVencimiento.includes('abr') || t.prioridad === 'URGENTE'));
    } else if (this.taskFilter === 'PROXIMAS') {
      res = res.filter((t) => t.estado !== 'COMPLETADA');
    }

    if (!q) return res;
    return res.filter((t) =>
      `${t.titulo} ${t.proyectoNombre} ${t.prioridad}`.toLowerCase().includes(q)
    );
  }

  // Filtered invoices across all projects
  get allInvoices(): Factura[] {
    const facturas = this.equinox.todasLasFacturas();
    const q = this.query.trim().toLowerCase();
    let res = facturas;

    if (this.invoiceFilter === 'PENDIENTES') {
      res = res.filter((f) => f.estado === 'PENDIENTE' || f.estado === 'VENCIDA');
    } else if (this.invoiceFilter === 'PAGADAS') {
      res = res.filter((f) => f.estado === 'PAGADA');
    }

    if (!q) return res;
    return res.filter((f) =>
      `${f.numero} ${f.concepto} ${f.clienteNombre} ${f.proyectoNombre}`.toLowerCase().includes(q)
    );
  }

  // Total pending collection balance
  get totalPorCobrar(): number {
    return this.allInvoices
      .filter((f) => f.estado !== 'PAGADA')
      .reduce((acc, f) => acc + (f.montoPendiente || f.monto), 0);
  }

  // Total collected
  get totalCobrado(): number {
    return this.allInvoices
      .filter((f) => f.estado === 'PAGADA')
      .reduce((acc, f) => acc + f.monto, 0);
  }

  // Navigation handlers
  navigate(p: 'hoy' | 'clientes' | 'proyectos' | 'tareas' | 'finanzas' | 'configuracion' | 'portal') {
    this.page = p;
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
    this.equinox.toggleEstadoTarea(tareaId);
  }

  // Create Flow
  openQuickCreate(type?: 'Cliente' | 'Proyecto' | 'Tarea' | 'Factura') {
    this.createModalOpen = true;
    this.activeCreateType = type || null;
    if (this.selectedProject) {
      this.nuevaTarea.proyectoId = this.selectedProject.id;
      this.nuevaFactura.proyectoId = this.selectedProject.id;
      this.nuevaFactura.clienteId = this.selectedProject.clienteId;
    }
    if (this.clientes.length > 0 && !this.nuevoProyecto.clienteId) {
      this.nuevoProyecto.clienteId = this.clientes[0].id;
    }
  }

  selectCreateType(type: 'Cliente' | 'Proyecto' | 'Tarea' | 'Factura') {
    this.activeCreateType = type;
  }

  submitCreate() {
    if (this.activeCreateType === 'Cliente') {
      if (!this.nuevoCliente.nombre) return;
      this.equinox.crearCliente(this.nuevoCliente);
      this.nuevoCliente = { nombre: '', empresa: '', correo: '', telefono: '', notas: '' };
    } else if (this.activeCreateType === 'Proyecto') {
      if (!this.nuevoProyecto.nombre) return;
      const p = this.equinox.crearProyecto(this.nuevoProyecto);
      this.selectedProject = p;
      this.nuevoProyecto = { nombre: '', clienteId: this.clientes[0]?.id || '', tipo: 'Sitio web', presupuesto: 2000, fechaEntrega: '', color: '#3568f6' };
    } else if (this.activeCreateType === 'Tarea') {
      if (!this.nuevaTarea.titulo) return;
      const pId = this.nuevaTarea.proyectoId || this.selectedProject?.id || this.proyectos[0]?.id;
      this.equinox.agregarTarea(pId, this.nuevaTarea.titulo, this.nuevaTarea.prioridad, this.nuevaTarea.fechaVencimiento);
      this.nuevaTarea = { proyectoId: '', titulo: '', prioridad: 'ALTA', fechaVencimiento: '' };
    } else if (this.activeCreateType === 'Factura') {
      if (!this.nuevaFactura.concepto || !this.nuevaFactura.monto) return;
      const cId = this.nuevaFactura.clienteId || this.clientes[0]?.id || 'c-1';
      this.equinox.crearFactura({
        clienteId: cId,
        proyectoId: this.nuevaFactura.proyectoId || this.selectedProject?.id,
        concepto: this.nuevaFactura.concepto,
        monto: this.nuevaFactura.monto,
        fechaVencimiento: this.nuevaFactura.fechaVencimiento || '30 días'
      });
      this.nuevaFactura = { clienteId: '', proyectoId: '', concepto: '', monto: 1200, fechaVencimiento: '' };
    }

    this.createModalOpen = false;
    this.activeCreateType = null;
  }

  closeCreateModal() {
    this.createModalOpen = false;
    this.activeCreateType = null;
  }

  // Inline inspector actions
  addInlineTask() {
    if (!this.inlineTaskTitle.trim() || !this.selectedProject) return;
    this.equinox.agregarTarea(this.selectedProject.id, this.inlineTaskTitle.trim(), 'ALTA', 'Próxima semana');
    this.inlineTaskTitle = '';
  }

  addInlineComment() {
    if (!this.inlineCommentText.trim() || !this.selectedProject) return;
    this.equinox.agregarComentario(this.selectedProject.id, this.inlineCommentText.trim(), 'FREELANCER');
    this.inlineCommentText = '';
  }

  addClientFeedbackPortal(text: string) {
    if (!text.trim() || !this.selectedProject) return;
    this.equinox.agregarComentario(this.selectedProject.id, text.trim(), 'CLIENTE');
  }

  markInvoicePaid(facturaId: string) {
    this.equinox.marcarFacturaPagada(facturaId);
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
    setTimeout(() => {
      const el = document.getElementById('globalSearchInput');
      if (el) el.focus();
    }, 50);
  }

  closeSearch() {
    this.searchOpen = false;
  }

  selectSearchResult(type: 'proyecto' | 'cliente' | 'tarea' | 'factura', item: any) {
    this.searchOpen = false;
    if (type === 'proyecto') {
      this.selectProject(item);
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

  @HostListener('document:keydown', ['$event'])
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
