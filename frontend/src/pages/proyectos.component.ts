import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import { AuthService } from '../auth/auth.service';
import { ClienteApi, ClientesProyectosApiService, EstadoProyectoApi, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { ComentarioApi, HitoApi, PrioridadTareaApi, TareaApi, TrabajoApiService, progresoTareas } from '../services/trabajo-api.service';
import { ArchivoApi, ArchivosApiService } from '../services/archivos-api.service';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';
import { UiStateService } from '../state/ui-state.service';

@Component({
  selector: 'app-proyectos',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogFocusDirective],
  templateUrl: './proyectos.component.html',
  styleUrl: './proyectos.component.css'
})
export class ProyectosComponent implements OnInit, OnDestroy {
  @HostListener('document:keydown.escape')
  cerrarModalConEscape(): void {
    if (this.confirmandoEliminarId) this.confirmandoEliminarId = null;
    else if (this.modalDetalle) this.cerrarDetalle();
    else this.modalFormulario = false;
  }
  private archivoInput?: HTMLInputElement;
  clientes: ClienteApi[] = [];
  busqueda = '';
  filtroEstado: 'TODOS' | EstadoProyectoApi = 'TODOS';
  vista: 'grid' | 'list' = 'grid';

  cargando = false;
  guardando = false;
  error = '';
  errorGuardar = '';
  enviado = false;

  modalFormulario = false;
  modalDetalle = false;
  pestanaDetalle: 'resumen' | 'tareas' | 'hitos' | 'archivos' | 'bitacora' = 'resumen';

  moverPestana(event: KeyboardEvent): void {
    const orden: Array<typeof this.pestanaDetalle> = ['resumen', 'tareas', 'hitos', 'archivos', 'bitacora'];
    const actual = orden.indexOf(this.pestanaDetalle);
    const siguiente = event.key === 'ArrowRight' ? (actual + 1) % orden.length
      : event.key === 'ArrowLeft' ? (actual + orden.length - 1) % orden.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? orden.length - 1 : -1;
    if (siguiente < 0) return;
    event.preventDefault();
    this.pestanaDetalle = orden[siguiente];
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[siguiente]?.focus();
  }
  mostrarFormularioHito = false;
  detalleCargando = false;
  detalleError = '';
  editandoId: string | null = null;
  proyectoDetalle: ProyectoApi | null = null;
  detalleId: string | null = null;

  menuAbiertoId: string | null = null;
  confirmandoEliminarId: string | null = null;
  eliminandoProyecto = false;

  // Cache de tareas por proyecto para calcular progreso real
  tareasPorProyecto = new Map<string, TareaApi[]>();
  archivosPorProyecto = new Map<string, (ArchivoApi & { url?: string })[]>();

  // Tareas del proyecto en detalle
  tareasDetalle: TareaApi[] = [];
  nuevaTarea = { titulo: '', prioridad: 'MEDIA' as PrioridadTareaApi, fechaVencimiento: '', descripcion: '' };
  guardandoTarea = false;
  errorTareas = '';

  // Hitos del proyecto en detalle
  hitosDetalle: HitoApi[] = [];
  nuevoHito = { titulo: '', descripcion: '', fechaObjetivo: '', visibleEnPortal: false };
  editandoHitoId: string | null = null;
  confirmandoHitoId: string | null = null;
  hitoBorrador = { titulo: '', descripcion: '', estado: 'PENDIENTE' as HitoApi['estado'], fechaObjetivo: '', visibleEnPortal: false };
  guardandoHito = false;
  errorHitos = '';

  // Archivos del proyecto en detalle
  archivosDetalle: (ArchivoApi & { url?: string })[] = [];
  archivoElegido: File | null = null;
  visibilidadArchivo: ArchivoApi['visibilidad'] = 'INTERNA';
  progresoArchivo = 0;
  subiendoArchivo = false;
  errorArchivos = '';
  descargandoArchivoId: string | null = null;
  eliminandoArchivoId: string | null = null;
  confirmarEliminarArchivoId: string | null = null;

  // Comentarios / Bitácora del proyecto en detalle
  comentariosDetalle: ComentarioApi[] = [];
  comentarioNuevo = '';
  enviandoComentario = false;
  errorComentario = '';

  private solicitudDetalle = 0;
  private operacionHito = 0;
  private operacionComentario = 0;
  private operacionArchivo = 0;

  formulario = this.formularioVacio();

  constructor(
    public api: ClientesProyectosApiService,
    private route: ActivatedRoute,
    private trabajo: TrabajoApiService,
    private http: HttpClient,
    public auth: AuthService,
    public uiState: UiStateService,
    private archivosApi?: ArchivosApiService
  ) {}
  ngOnInit(): void {
    void this.inicializar();
  }

  ngOnDestroy(): void {
    this.cerrarDetalle();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.menuAbiertoId = null;
  }

  get proyectos(): ProyectoApi[] {
    return this.api.proyectos;
  }

  get nombreOrganizacion(): string {
    return this.uiState.configuracion?.nombreEstudio || (this.auth.sesion?.usuario?.nombre ? `${this.auth.sesion.usuario.nombre} Studios` : 'Mena Studios');
  }

  get conteoTodos(): number {
    return this.proyectos.length;
  }

  get conteoEnProgreso(): number {
    return this.proyectos.filter((p) => p.estado === 'ACTIVO').length;
  }

  get conteoPlanificacion(): number {
    return this.proyectos.filter((p) => p.estado === 'BORRADOR').length;
  }

  get conteoEnPausa(): number {
    return this.proyectos.filter((p) => p.estado === 'PAUSADO').length;
  }

  get conteoCompletados(): number {
    return this.proyectos.filter((p) => p.estado === 'COMPLETADO').length;
  }

  get conteoCancelados(): number {
    return this.proyectos.filter((p) => p.estado === 'CANCELADO').length;
  }

  get proyectosVisibles(): ProyectoApi[] {
    const query = this.busqueda.trim().toLocaleLowerCase();
    return this.proyectos.filter((p) => {
      const coincideEstado = this.filtroEstado === 'TODOS' || p.estado === this.filtroEstado;
      if (!coincideEstado) return false;
      if (!query) return true;
      const categoriaTexto = this.categoria(p).toLocaleLowerCase();
      const contenido = `${p.nombre} ${p.cliente?.nombre || ''} ${p.cliente?.empresa || ''} ${p.descripcion || ''} ${categoriaTexto}`.toLocaleLowerCase();
      return contenido.includes(query);
    });
  }

  categoria(p: ProyectoApi): string {
    const texto = `${p.nombre} ${p.descripcion || ''}`.toLocaleLowerCase();
    const tagMatch = p.nombre.match(/\[(.*?)\]/) || (p.descripcion && p.descripcion.match(/\[(.*?)\]/));
    if (tagMatch) return tagMatch[1];
    if (texto.includes('web') || texto.includes('sitio') || texto.includes('tienda') || texto.includes('ecommerce')) return 'Web';
    if (texto.includes('software') || texto.includes('sistema') || texto.includes('portal') || texto.includes('b2b') || texto.includes('api')) return 'Software';
    if (texto.includes('branding') || texto.includes('identidad') || texto.includes('marca') || texto.includes('logo')) return 'Branding';
    if (texto.includes('fotografía') || texto.includes('fotografia') || texto.includes('foto') || texto.includes('audiovisual') || texto.includes('campaña') || texto.includes('campana')) return 'Fotografía';
    if (texto.includes('arquitectura') || texto.includes('espacio') || texto.includes('diseño interior') || texto.includes('edificio') || texto.includes('portafolio')) return 'Arquitectura';
    if (texto.includes('móvil') || texto.includes('movil') || texto.includes('app') || texto.includes('mobile')) return 'Mobile';
    if (texto.includes('diseño') || texto.includes('diseno') || texto.includes('ui') || texto.includes('ux')) return 'Diseño';
    if (texto.includes('estrategia') || texto.includes('consultoría') || texto.includes('consultoria')) return 'Estrategia';
    return p.cliente?.empresa ? p.cliente.empresa.split(' ')[0] : 'General';
  }

  clienteTexto(p: ProyectoApi): string {
    if (!p.cliente) return 'Cliente sin asignar';
    return [p.cliente.nombre, p.cliente.empresa].filter(Boolean).join(' · ');
  }

  progreso(p: ProyectoApi): number {
    if (p.estado === 'COMPLETADO') return 100;
    const tareas = this.tareasPorProyecto.get(p.id);
    if (!tareas || !tareas.length) return 0;
    const vigentes = tareas.filter((t) => t.estado !== 'CANCELADA');
    if (!vigentes.length) return 0;
    return Math.round((vigentes.filter((t) => t.estado === 'COMPLETADA').length / vigentes.length) * 100);
  }

  progresoDetalle(): number {
    if (!this.proyectoDetalle) return 0;
    if (this.proyectoDetalle.estado === 'COMPLETADO') return 100;
    const pct = progresoTareas(this.tareasDetalle);
    return pct !== null ? pct : 0;
  }

  obtenerPortadaReal(p: ProyectoApi): string | null {
    const archivos = this.archivosPorProyecto.get(p.id);
    if (archivos && archivos.length) {
      const img = archivos.find((a) => a.tipo === 'IMAGEN' || a.tipoMime.startsWith('image/'));
      if (img?.url) return img.url;
    }
    return null;
  }

  obtenerGraficoNeutro(p: ProyectoApi) {
    const palabras = p.nombre.trim().split(/\s+/).filter(Boolean);
    const iniciales = palabras.length >= 2
      ? (palabras[0][0] + palabras[1][0]).toUpperCase()
      : (p.nombre.slice(0, 2).toUpperCase() || 'EQ');
    const hash = Math.abs(this.hashString(p.id || p.nombre)) % 5;
    const temas = [
      { bg: '#f5f2eb', line: '#e0d9cb', accent: '#706351', monoBg: '#ede7da' },
      { bg: '#f1f5f9', line: '#cbd5e1', accent: '#334155', monoBg: '#e2e8f0' },
      { bg: '#eef3ef', line: '#cfded1', accent: '#3b5443', monoBg: '#dde8e0' },
      { bg: '#f0f3f9', line: '#cbd8ef', accent: '#263f68', monoBg: '#e1ebfb' },
      { bg: '#f7f3ef', line: '#e6ded5', accent: '#695244', monoBg: '#ece3d8' }
    ];
    return { iniciales, ...temas[hash] };
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  etiquetaEstado(estado: EstadoProyectoApi): string {
    switch (estado) {
      case 'ACTIVO': return 'En progreso';
      case 'BORRADOR': return 'Planificación';
      case 'PAUSADO': return 'En pausa';
      case 'COMPLETADO': return 'Completado';
      case 'CANCELADO': return 'Cancelado';
      default: return estado;
    }
  }

  claseEstadoDot(estado: EstadoProyectoApi): string {
    switch (estado) {
      case 'ACTIVO': return 'dot-progreso';
      case 'BORRADOR': return 'dot-planificacion';
      case 'PAUSADO': return 'dot-pausa';
      case 'COMPLETADO': return 'dot-completado';
      case 'CANCELADO': return 'dot-cancelado';
      default: return 'dot-planificacion';
    }
  }

  autor(comentario: ComentarioApi): string {
    const nombre = [comentario.usuario?.nombre, comentario.usuario?.apellido].filter(Boolean).join(' ');
    return nombre || 'Cuenta eliminada';
  }

  private async inicializar(): Promise<void> {
    if (await this.cargar()) {
      const editarId = this.route.snapshot.queryParamMap.get('editar');
      if (editarId) await this.abrirEdicion(editarId);
      const proyectoId = this.route.snapshot.queryParamMap.get('proyecto') || this.route.snapshot.queryParamMap.get('detalle');
      if (proyectoId) {
        this.modalDetalle = true;
        await this.cargarDetalle(proyectoId);
      }
    }
  }

  async cargar(): Promise<boolean> {
    this.cargando = true;
    this.error = '';
    try {
      await Promise.all([this.api.listarProyectos(), this.api.listarClientes()]);
      this.clientes = this.api.clientes;
      void this.cargarTareasTodos();
      return true;
    } catch {
      this.error = 'No se pudieron cargar los proyectos y clientes. Comprueba la conexión e inténtalo de nuevo.';
      return false;
    } finally {
      this.cargando = false;
    }
  }

  private async cargarTareasTodos(): Promise<void> {
    const proyectos = this.api.proyectos;
    if (!proyectos.length) return;
    await Promise.all(
      proyectos.map(async (p) => {
        try {
          const tareas = await this.trabajo.listarTareas(p.id);
          this.tareasPorProyecto.set(p.id, tareas);
        } catch {
          // Ignorar fallas silenciosas en tareas de fondo
        }
      })
    );
  }

  async reintentarCarga(): Promise<void> {
    if (await this.cargar()) {
      const editarId = this.route.snapshot.queryParamMap.get('editar');
      if (editarId) await this.abrirEdicion(editarId);
      const proyectoId = this.route.snapshot.queryParamMap.get('proyecto') || this.route.snapshot.queryParamMap.get('detalle');
      if (proyectoId) {
        this.modalDetalle = true;
        await this.cargarDetalle(proyectoId);
      }
    }
  }

  nuevo(): void {
    this.editandoId = null;
    this.formulario = this.formularioVacio();
    this.enviado = false;
    this.errorGuardar = '';
    this.modalFormulario = true;
  }

  async verDetalle(proyecto: ProyectoApi): Promise<void> {
    this.modalDetalle = true;
    await this.cargarDetalle(proyecto.id);
  }

  async cargarDetalle(id: string): Promise<void> {
    if (!id) return;
    this.reiniciarDetalle();
    this.detalleId = id;
    const solicitud = ++this.solicitudDetalle;
    this.detalleCargando = true;
    this.detalleError = '';
    this.proyectoDetalle = null;
    this.tareasDetalle = [];
    this.hitosDetalle = [];
    this.archivosDetalle = [];
    this.comentariosDetalle = [];
    try {
      const [proyecto, tareas, hitos, comentarios, archivos] = await Promise.all([
        this.api.consultarProyecto(id),
        this.trabajo.listarTareas(id),
        this.trabajo.listarHitos(id),
        this.trabajo.listarComentarios(id),
        this.archivosApi?.listar(id) ?? Promise.resolve([])
      ]);
      if (solicitud !== this.solicitudDetalle || !this.modalDetalle) return;
      this.proyectoDetalle = proyecto;
      this.tareasDetalle = tareas;
      this.tareasPorProyecto.set(id, tareas);
      this.hitosDetalle = hitos;
      this.comentariosDetalle = comentarios;
      this.archivosDetalle = archivos.length ? archivos : ((proyecto as any).archivos || []);
      this.archivosPorProyecto.set(id, this.archivosDetalle);
    } catch {
      if (solicitud === this.solicitudDetalle && this.modalDetalle) {
        this.detalleError = 'No se pudieron consultar tareas, hitos, archivos o comentarios. Reintenta.';
      }
    } finally {
      if (solicitud === this.solicitudDetalle) this.detalleCargando = false;
    }
  }

  cerrarDetalle(): void {
    this.reiniciarDetalle();
    ++this.solicitudDetalle;
    this.modalDetalle = false;
    this.proyectoDetalle = null;
    this.detalleId = null;
  }

  private reiniciarDetalle(): void {
    ++this.operacionHito;
    ++this.operacionComentario;
    this.pestanaDetalle = 'resumen';
    this.guardandoHito = false;
    this.enviandoComentario = false;
    this.nuevoHito = { titulo: '', descripcion: '', fechaObjetivo: '', visibleEnPortal: false };
    this.hitoBorrador = { titulo: '', descripcion: '', estado: 'PENDIENTE', fechaObjetivo: '', visibleEnPortal: false };
    this.nuevaTarea = { titulo: '', prioridad: 'MEDIA', fechaVencimiento: '', descripcion: '' };
    this.comentarioNuevo = '';
    this.editandoHitoId = null;
    this.confirmandoHitoId = null;
    this.errorHitos = '';
    this.errorTareas = '';
    this.errorArchivos = '';
    this.errorComentario = '';
    ++this.operacionArchivo;
    this.archivosDetalle = [];
    this.archivoElegido = null;
    this.archivoInput = undefined;
    this.progresoArchivo = 0;
    this.subiendoArchivo = false;
    this.descargandoArchivoId = null;
    this.eliminandoArchivoId = null;
    this.confirmarEliminarArchivoId = null;
  }

  // === GESTIÓN DE ACCIONES Y MENÚ ===
  abrirMenu(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.menuAbiertoId = this.menuAbiertoId === id ? null : id;
  }

  async cambiarEstadoRapido(p: ProyectoApi, nuevoEstado: EstadoProyectoApi, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    this.menuAbiertoId = null;
    try {
      await this.api.editarProyecto(p.id, { estado: nuevoEstado });
      if (this.proyectoDetalle?.id === p.id) {
        this.proyectoDetalle = { ...this.proyectoDetalle, estado: nuevoEstado };
      }
    } catch {
      this.error = 'No se pudo actualizar el estado del proyecto.';
    }
  }

  iniciarEliminar(id: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.menuAbiertoId = null;
    this.confirmandoEliminarId = id;
  }

  async confirmarEliminar(): Promise<void> {
    const id = this.confirmandoEliminarId;
    if (!id || this.eliminandoProyecto) return;
    this.eliminandoProyecto = true;
    try {
      await firstValueFrom(this.http.delete(`${obtenerBaseApi()}/proyectos/${encodeURIComponent(id)}`));
      this.confirmandoEliminarId = null;
      if (this.modalDetalle && this.detalleId === id) {
        this.cerrarDetalle();
      }
      await this.api.listarProyectos();
    } catch {
      this.error = 'No se pudo eliminar el proyecto. Reintenta.';
    } finally {
      this.eliminandoProyecto = false;
    }
  }

  // === GESTIÓN DE TAREAS ===
  async crearTarea(): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || this.guardandoTarea) return;
    if (this.nuevaTarea.titulo.trim().length < 2) {
      this.errorTareas = 'El título de la tarea requiere al menos 2 caracteres.';
      return;
    }
    this.guardandoTarea = true;
    this.errorTareas = '';
    try {
      const creada = await this.trabajo.crearTarea(id, {
        titulo: this.nuevaTarea.titulo.trim(),
        prioridad: this.nuevaTarea.prioridad,
        fechaVencimiento: this.nuevaTarea.fechaVencimiento || null,
        descripcion: this.nuevaTarea.descripcion.trim() || null
      });
      this.tareasDetalle = [...this.tareasDetalle, creada];
      this.tareasPorProyecto.set(id, this.tareasDetalle);
      this.nuevaTarea = { titulo: '', prioridad: 'MEDIA', fechaVencimiento: '', descripcion: '' };
    } catch {
      this.errorTareas = 'No se pudo crear la tarea. Reintenta.';
    } finally {
      this.guardandoTarea = false;
    }
  }

  async alternarTarea(tarea: TareaApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id) return;
    const nuevoEstado = tarea.estado === 'COMPLETADA' ? 'PENDIENTE' : 'COMPLETADA';
    try {
      const actualizada = await this.trabajo.editarTarea(id, tarea.id, { estado: nuevoEstado });
      this.tareasDetalle = this.tareasDetalle.map((t) => (t.id === tarea.id ? actualizada : t));
      this.tareasPorProyecto.set(id, this.tareasDetalle);
    } catch {
      this.errorTareas = 'No se pudo actualizar el estado de la tarea.';
    }
  }

  async eliminarTarea(tarea: TareaApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id) return;
    try {
      await this.trabajo.eliminarTarea(id, tarea.id);
      this.tareasDetalle = this.tareasDetalle.filter((t) => t.id !== tarea.id);
      this.tareasPorProyecto.set(id, this.tareasDetalle);
    } catch {
      this.errorTareas = 'No se pudo eliminar la tarea.';
    }
  }

  // === GESTIÓN DE ARCHIVOS ===
  elegirArchivo(evento: Event): void {
    this.archivoInput = evento.target as HTMLInputElement;
    this.archivoElegido = this.archivoInput.files?.[0] ?? null;
    this.errorArchivos = '';
    this.progresoArchivo = 0;
  }

  async subirArchivo(): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || !this.archivoElegido || this.subiendoArchivo || !this.archivosApi) return;
    if (this.archivoElegido.size > 8 * 1024 * 1024) {
      this.errorArchivos = 'El archivo supera el máximo de 8 MB.';
      return;
    }
    const generacion = ++this.operacionArchivo;
    this.subiendoArchivo = true;
    this.errorArchivos = '';
    this.progresoArchivo = 0;
    try {
      const nuevo = await this.archivosApi.subir(id, this.archivoElegido, this.visibilidadArchivo, (valor) => {
        if (generacion === this.operacionArchivo) this.progresoArchivo = valor;
      });
      if (generacion === this.operacionArchivo && this.proyectoDetalle?.id === id && this.modalDetalle) {
        this.archivosDetalle = [nuevo, ...this.archivosDetalle];
        this.archivosPorProyecto.set(id, this.archivosDetalle);
        this.archivoElegido = null;
        this.progresoArchivo = 100;
        if (this.archivoInput) this.archivoInput.value = '';
      }
    } catch {
      if (generacion === this.operacionArchivo) {
        this.errorArchivos = 'No se pudo subir el archivo. Comprueba formato, tamaño y conexión; puedes reintentar.';
      }
    } finally {
      if (generacion === this.operacionArchivo) this.subiendoArchivo = false;
    }
  }

  async descargarArchivo(archivo: ArchivoApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || !this.archivosApi || this.descargandoArchivoId) return;
    this.descargandoArchivoId = archivo.id;
    this.errorArchivos = '';
    try {
      await this.archivosApi.guardarDescarga(id, archivo);
    } catch {
      if (this.proyectoDetalle?.id === id) this.errorArchivos = 'No se pudo descargar el archivo. Reintenta.';
    } finally {
      this.descargandoArchivoId = null;
    }
  }

  async eliminarArchivo(archivo: ArchivoApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || !this.archivosApi || this.eliminandoArchivoId || this.confirmarEliminarArchivoId !== archivo.id) return;
    this.eliminandoArchivoId = archivo.id;
    this.errorArchivos = '';
    try {
      await this.archivosApi.eliminar(id, archivo.id);
      if (this.proyectoDetalle?.id === id) {
        this.archivosDetalle = this.archivosDetalle.filter((item) => item.id !== archivo.id);
        this.archivosPorProyecto.set(id, this.archivosDetalle);
      }
    } catch {
      if (this.proyectoDetalle?.id === id) this.errorArchivos = 'No se pudo eliminar el archivo. Reintenta.';
    } finally {
      this.eliminandoArchivoId = null;
      this.confirmarEliminarArchivoId = null;
    }
  }

  // === GESTIÓN DE HITOS ===
  async crearHito(): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || this.guardandoHito) return;
    if (this.nuevoHito.titulo.trim().length < 2) {
      this.errorHitos = 'El título requiere al menos dos caracteres.';
      return;
    }
    const generacion = ++this.operacionHito;
    this.guardandoHito = true;
    this.errorHitos = '';
    try {
      const hito = await this.trabajo.crearHito(id, {
        titulo: this.nuevoHito.titulo.trim(),
        descripcion: this.nuevoHito.descripcion.trim() || null,
        fechaObjetivo: this.nuevoHito.fechaObjetivo || null,
        visibleEnPortal: this.nuevoHito.visibleEnPortal
      });
      if (generacion === this.operacionHito && this.proyectoDetalle?.id === id && this.modalDetalle) {
        this.hitosDetalle = [...this.hitosDetalle, hito];
        this.nuevoHito = { titulo: '', descripcion: '', fechaObjetivo: '', visibleEnPortal: false };
      }
    } catch {
      if (generacion === this.operacionHito) this.errorHitos = 'No se pudo crear el hito. Reintenta.';
    } finally {
      if (generacion === this.operacionHito) this.guardandoHito = false;
    }
  }

  editarHito(hito: HitoApi): void {
    this.editandoHitoId = hito.id;
    this.errorHitos = '';
    this.hitoBorrador = {
      titulo: hito.titulo,
      descripcion: hito.descripcion || '',
      estado: hito.estado,
      fechaObjetivo: hito.fechaObjetivo?.slice(0, 10) || '',
      visibleEnPortal: hito.visibleEnPortal
    };
  }

  async guardarHito(hito: HitoApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || this.guardandoHito) return;
    if (this.hitoBorrador.titulo.trim().length < 2) {
      this.errorHitos = 'El título requiere al menos dos caracteres.';
      return;
    }
    const generacion = ++this.operacionHito;
    this.guardandoHito = true;
    this.errorHitos = '';
    try {
      const actualizado = await this.trabajo.editarHito(id, hito.id, {
        titulo: this.hitoBorrador.titulo.trim(),
        descripcion: this.hitoBorrador.descripcion.trim() || null,
        estado: this.hitoBorrador.estado,
        fechaObjetivo: this.hitoBorrador.fechaObjetivo || null,
        visibleEnPortal: this.hitoBorrador.visibleEnPortal
      });
      if (generacion === this.operacionHito && this.proyectoDetalle?.id === id && this.modalDetalle) {
        this.hitosDetalle = this.hitosDetalle.map((item) => (item.id === hito.id ? actualizado : item));
        this.editandoHitoId = null;
      }
    } catch {
      if (generacion === this.operacionHito) this.errorHitos = 'No se pudo guardar el hito. Reintenta.';
    } finally {
      if (generacion === this.operacionHito) this.guardandoHito = false;
    }
  }

  async eliminarHito(hito: HitoApi): Promise<void> {
    const id = this.proyectoDetalle?.id;
    if (!id || this.guardandoHito) return;
    const generacion = ++this.operacionHito;
    this.guardandoHito = true;
    this.errorHitos = '';
    try {
      await this.trabajo.eliminarHito(id, hito.id);
      if (generacion === this.operacionHito && this.proyectoDetalle?.id === id && this.modalDetalle) {
        this.hitosDetalle = this.hitosDetalle.filter((item) => item.id !== hito.id);
      }
    } catch {
      if (generacion === this.operacionHito) this.errorHitos = 'No se pudo eliminar el hito. Reintenta.';
    } finally {
      if (generacion === this.operacionHito) this.guardandoHito = false;
    }
  }

  // === GESTIÓN DE COMENTARIOS ===
  async enviarComentario(): Promise<void> {
    const id = this.proyectoDetalle?.id;
    const contenido = this.comentarioNuevo.trim();
    if (!id || this.enviandoComentario) return;
    if (!contenido || contenido.length > 2000) {
      this.errorComentario = 'Escribe entre 1 y 2000 caracteres.';
      return;
    }
    const generacion = ++this.operacionComentario;
    this.enviandoComentario = true;
    this.errorComentario = '';
    try {
      const comentario = await this.trabajo.comentar(id, contenido);
      if (generacion === this.operacionComentario && this.proyectoDetalle?.id === id && this.modalDetalle) {
        this.comentariosDetalle = [...this.comentariosDetalle, comentario];
        this.comentarioNuevo = '';
      }
    } catch {
      if (generacion === this.operacionComentario) this.errorComentario = 'No se pudo enviar el comentario. Reintenta.';
    } finally {
      if (generacion === this.operacionComentario) this.enviandoComentario = false;
    }
  }

  // === EDICIÓN Y CREACIÓN DE PROYECTO ===
  async abrirEdicion(id: string): Promise<void> {
    if (this.cargando || !this.clientes.length) return;
    this.editandoId = id;
    this.detalleCargando = true;
    this.detalleError = '';
    this.errorGuardar = '';
    try {
      const proyecto = await this.api.consultarProyecto(id);
      if (!this.clientes.some((cliente) => cliente.id === proyecto.clienteId)) {
        this.error = 'No se pudo cargar el cliente asociado al proyecto. Reintenta la carga para editarlo.';
        this.modalFormulario = false;
        return;
      }
      this.formulario = {
        nombre: proyecto.nombre,
        clienteId: proyecto.clienteId,
        descripcion: proyecto.descripcion || '',
        estado: proyecto.estado,
        presupuesto: proyecto.presupuesto === null ? '' : String(proyecto.presupuesto),
        moneda: proyecto.moneda,
        fechaInicio: proyecto.fechaInicio?.slice(0, 10) || '',
        fechaEntrega: proyecto.fechaEntrega?.slice(0, 10) || ''
      };
      this.modalDetalle = false;
      this.modalFormulario = true;
      this.enviado = false;
    } catch {
      this.detalleError = 'No se pudo abrir el proyecto para editarlo.';
      this.modalDetalle = true;
    } finally {
      this.detalleCargando = false;
    }
  }

  async guardar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || !this.formulario.clienteId || this.guardando) return;
    this.guardando = true;
    this.errorGuardar = '';
    const datos = {
      nombre: this.formulario.nombre.trim(),
      clienteId: this.formulario.clienteId,
      descripcion: this.formulario.descripcion.trim() || null,
      estado: this.formulario.estado,
      presupuesto: this.formulario.presupuesto === '' ? null : Number(this.formulario.presupuesto),
      moneda: this.formulario.moneda.trim().toUpperCase(),
      fechaInicio: this.formulario.fechaInicio || null,
      fechaEntrega: this.formulario.fechaEntrega || null
    };
    try {
      if (this.editandoId) {
        await this.api.editarProyecto(this.editandoId, datos);
      } else {
        await this.api.crearProyecto(datos);
      }
      this.modalFormulario = false;
      void this.cargarTareasTodos();
    } catch (error: any) {
      this.errorGuardar =
        error?.status === 422
          ? 'El cliente seleccionado o los datos del proyecto no son válidos.'
          : error?.status === 404
          ? 'El proyecto ya no está disponible.'
          : 'No se pudo guardar el proyecto.';
    } finally {
      this.guardando = false;
    }
  }

  private formularioVacio() {
    return {
      nombre: '',
      clienteId: '',
      descripcion: '',
      estado: 'BORRADOR' as EstadoProyectoApi,
      presupuesto: '0',
      moneda: 'PAB',
      fechaInicio: '',
      fechaEntrega: ''
    };
  }
}
