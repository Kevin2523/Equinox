import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ClienteApi, ClientesProyectosApiService, EstadoClienteApi, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { InvitacionCliente, RespuestaInvitacionEmitida, RolInvitacion } from '../models/invitacion.model';
import { InvitacionesApiService } from '../services/invitaciones-api.service';
import { UiStateService } from '../state/ui-state.service';
import { SesionesFotograficasComponent } from './sesiones-fotograficas.component';
import { FotografiaApiService, TipoFreelance } from '../services/fotografia-api.service';

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule, SesionesFotograficasComponent],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.css'
})
export class ClientesComponent implements OnInit, OnDestroy {
  @ViewChild(SesionesFotograficasComponent) sesionesComponent?: SesionesFotograficasComponent;

  tipoFreelance: TipoFreelance = 'GENERAL';
  cargandoTipoFreelance = true;

  get esFotografia(): boolean {
    return this.tipoFreelance === 'FOTOGRAFIA';
  }

  clientes: ClienteApi[] = [];
  clienteSeleccionado: ClienteApi | null = null;
  clienteSeleccionadoDetalle: ClienteApi | null = null;
  cargandoDetalleSeleccionado = false;

  filtroEstado: 'TODOS' | EstadoClienteApi = 'TODOS';
  busqueda = '';
  paginaActual = 1;
  readonly porPagina = 5;

  cargando = false;
  guardando = false;
  error = '';
  cargandoProyectosActivos = false;
  errorProyectosActivos = '';
  errorGuardar = '';

  modalFormulario = false;
  modalDetalle = false;
  detalleCargando = false;
  detalleError = '';
  enviado = false;
  editandoId: string | null = null;
  clienteDetalle: ClienteApi | null = null;
  formulario = this.formularioVacio();

  clienteInvitaciones: ClienteApi | null = null;
  invitaciones: InvitacionCliente[] = [];
  formularioInvitacion = { correo: '', rol: 'TITULAR' as RolInvitacion };
  cargandoInvitaciones = false;
  enviandoInvitacion = false;
  operacionInvitacion: string | null = null;
  errorInvitaciones = '';
  errorCrearInvitacion = '';
  exitoInvitacion = '';
  enlaceInvitacion: string | null = null;
  confirmarRevocacionId: string | null = null;
  invitacionEnviada = false;

  private solicitudInvitaciones = 0;
  private contextoInvitaciones = 0;
  private solicitudClientes = 0;
  private solicitudProyectos = 0;
  private solicitudDetalle = 0;
  private solicitudDetalleSeleccionado = 0;
  private suscripcionSesion?: Subscription;
  private suscripcionTipo?: Subscription;

  constructor(
    public api: ClientesProyectosApiService,
    private invitacionesApi: InvitacionesApiService,
    public auth: AuthService,
    public uiState: UiStateService,
    public fotografiaApi: FotografiaApiService,
    private changeDetector?: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.suscripcionTipo = this.fotografiaApi.tipoFreelance$.subscribe((tipo) => {
      this.tipoFreelance = tipo;
      this.changeDetector?.markForCheck();
    });
    void this.fotografiaApi.obtenerTipoFreelance().then((tipo) => {
      this.tipoFreelance = tipo;
      this.cargandoTipoFreelance = false;
      this.changeDetector?.markForCheck();
    });

    this.suscripcionSesion = this.auth.sesion$.subscribe((sesion) => {
      this.cerrarInvitaciones();
      if (sesion?.contexto.tipoAcceso === 'ORGANIZACION') {
        void this.cargar();
        void this.fotografiaApi.obtenerTipoFreelance();
        return;
      }
      ++this.solicitudClientes;
      ++this.solicitudProyectos;
      this.clientes = [];
      this.clienteSeleccionado = null;
      this.clienteSeleccionadoDetalle = null;
      this.cargando = false;
      this.error = '';
      this.cargandoProyectosActivos = false;
      this.errorProyectosActivos = '';
      this.changeDetector?.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.suscripcionSesion?.unsubscribe();
    this.suscripcionTipo?.unsubscribe();
    this.cerrarInvitaciones();
    ++this.solicitudClientes;
    ++this.solicitudProyectos;
    ++this.solicitudDetalleSeleccionado;
  }

  get nombreEstudio(): string {
    return this.uiState.configuracion?.nombreEstudio || 'Estudio';
  }

  get conteoTodos(): number {
    return this.clientes.length;
  }

  get conteoActivos(): number {
    return this.clientes.filter((c) => c.estado === 'ACTIVO').length;
  }

  get conteoProspectos(): number {
    return this.clientes.filter((c) => c.estado === 'PROSPECTO').length;
  }

  get conteoInactivos(): number {
    return this.clientes.filter((c) => c.estado === 'INACTIVO' || c.estado === 'ARCHIVADO').length;
  }

  get clientesFiltrados(): ClienteApi[] {
    const q = this.busqueda.trim().toLocaleLowerCase();
    return this.clientes.filter((c) => {
      let coincideEstado = true;
      if (this.filtroEstado === 'ACTIVO') coincideEstado = c.estado === 'ACTIVO';
      else if (this.filtroEstado === 'PROSPECTO') coincideEstado = c.estado === 'PROSPECTO';
      else if (this.filtroEstado === 'INACTIVO') coincideEstado = c.estado === 'INACTIVO' || c.estado === 'ARCHIVADO';

      if (!coincideEstado) return false;

      if (!q) return true;
      const haystack = `${c.nombre} ${c.empresa || ''} ${c.correo || ''} ${c.telefono || ''} ${c.direccion || ''} ${c.notasInternas || ''}`.toLocaleLowerCase();
      return haystack.includes(q);
    });
  }

  get totalFiltrados(): number {
    return this.clientesFiltrados.length;
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.totalFiltrados / this.porPagina));
  }

  get arrayPaginas(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, i) => i + 1);
  }

  get clientesPaginados(): ClienteApi[] {
    const inicio = (this.paginaActual - 1) * this.porPagina;
    return this.clientesFiltrados.slice(inicio, inicio + this.porPagina);
  }

  get indiceInicio(): number {
    if (this.totalFiltrados === 0) return 0;
    return (this.paginaActual - 1) * this.porPagina + 1;
  }

  get indiceFin(): number {
    return Math.min(this.paginaActual * this.porPagina, this.totalFiltrados);
  }

  setFiltroEstado(estado: 'TODOS' | EstadoClienteApi): void {
    this.filtroEstado = estado;
    this.paginaActual = 1;
    this.asegurarSeleccionValida();
  }

  onBusquedaChange(): void {
    this.paginaActual = 1;
    this.asegurarSeleccionValida();
  }

  cambiarPagina(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginas || pagina === this.paginaActual) return;
    this.paginaActual = pagina;
    this.asegurarSeleccionValida();
  }

  private asegurarSeleccionValida(): void {
    const visibles = this.clientesPaginados;
    if (visibles.length === 0) {
      if (this.clientesFiltrados.length > 0) {
        this.seleccionarCliente(this.clientesFiltrados[0]);
      } else {
        this.clienteSeleccionado = null;
        this.clienteSeleccionadoDetalle = null;
      }
      return;
    }
    const existeEnVisibles = visibles.some((c) => c.id === this.clienteSeleccionado?.id);
    if (!existeEnVisibles) {
      this.seleccionarCliente(visibles[0]);
    }
  }

  async cargar(): Promise<void> {
    const solicitud = ++this.solicitudClientes;
    this.cargando = true;
    this.error = '';
    this.changeDetector?.markForCheck();
    void this.cargarProyectosActivos();
    try {
      const clientes = await this.api.listarClientes();
      if (solicitud === this.solicitudClientes) {
        this.clientes = clientes;
        if (this.clientes.length > 0) {
          const actualId = this.clienteSeleccionado?.id;
          const matching = actualId ? this.clientes.find((c) => c.id === actualId) : null;
          this.seleccionarCliente(matching || this.clientes[0]);
        } else {
          this.clienteSeleccionado = null;
          this.clienteSeleccionadoDetalle = null;
        }
      }
    } catch {
      if (solicitud === this.solicitudClientes) {
        this.error = 'No se pudieron cargar los clientes. Comprueba la conexión e inténtalo de nuevo.';
      }
    } finally {
      if (solicitud === this.solicitudClientes) {
        this.cargando = false;
        this.changeDetector?.markForCheck();
      }
    }
  }

  async cargarProyectosActivos(): Promise<void> {
    const solicitud = ++this.solicitudProyectos;
    this.cargandoProyectosActivos = true;
    this.errorProyectosActivos = '';
    try {
      await this.api.listarProyectos();
    } catch {
      if (solicitud === this.solicitudProyectos) {
        this.errorProyectosActivos = 'No se pudo cargar el contador de proyectos.';
      }
    } finally {
      if (solicitud === this.solicitudProyectos) {
        this.cargandoProyectosActivos = false;
      }
    }
  }

  seleccionarCliente(cliente: ClienteApi): void {
    this.clienteSeleccionado = cliente;
    this.clienteSeleccionadoDetalle = null;
    void this.cargarDetalleClienteSeleccionado(cliente.id);
  }

  async cargarDetalleClienteSeleccionado(clienteId: string): Promise<void> {
    const solicitud = ++this.solicitudDetalleSeleccionado;
    this.cargandoDetalleSeleccionado = true;
    try {
      const detalle = await this.api.consultarCliente(clienteId);
      if (solicitud === this.solicitudDetalleSeleccionado) {
        this.clienteSeleccionadoDetalle = detalle;
        if (this.clienteSeleccionado?.id === clienteId) {
          this.clienteSeleccionado = { ...this.clienteSeleccionado, ...detalle };
        }
      }
    } catch {
      // Si falla, los datos básicos de la fila siguen visibles
    } finally {
      if (solicitud === this.solicitudDetalleSeleccionado) {
        this.cargandoDetalleSeleccionado = false;
        this.changeDetector?.markForCheck();
      }
    }
  }

  obtenerProyectoEnCurso(cliente: ClienteApi | null): (ProyectoApi & { tareas?: Array<{ id: string; estado: string }> }) | null {
    if (!cliente) return null;
    const origen = this.clienteSeleccionadoDetalle?.proyectos || cliente.proyectos || [];
    if (origen.length > 0) {
      const activo = origen.find((p) => p.estado === 'ACTIVO');
      return activo || origen[0];
    }
    const global = this.api.proyectos.find((p) => p.clienteId === cliente.id && p.estado === 'ACTIVO');
    return global || null;
  }

  calcularProgreso(proyecto: (ProyectoApi & { tareas?: Array<{ id: string; estado: string }> }) | null): number {
    if (!proyecto) return 0;
    const tareas = proyecto.tareas;
    if (tareas && tareas.length > 0) {
      const completadas = tareas.filter((t) => t.estado === 'COMPLETADA').length;
      return Math.round((completadas / tareas.length) * 100);
    }
    if (proyecto.estado === 'COMPLETADO') return 100;
    if (proyecto.estado === 'ACTIVO') return 60;
    return 0;
  }

  obtenerEstadoPortal(cliente: ClienteApi | null): 'ACTIVO' | 'PENDIENTE' | 'SIN_INVITAR' {
    if (!cliente) return 'SIN_INVITAR';
    const accesos = this.clienteSeleccionadoDetalle?.accesosCliente || cliente.accesosCliente || [];
    if (accesos.some((a) => a.activo)) return 'ACTIVO';
    const invitaciones = this.clienteSeleccionadoDetalle?.invitacionesCliente || cliente.invitacionesCliente || [];
    if (invitaciones.some((i) => i.estado === 'PENDIENTE')) return 'PENDIENTE';
    return 'SIN_INVITAR';
  }

  bannerUrl(cliente: ClienteApi | null): string | null {
    if (!cliente) return null;
    const texto = `${cliente.nombre} ${cliente.empresa || ''}`.toLowerCase();
    if (texto.includes('café unido') || texto.includes('cafe unido')) {
      return '/assets/cafe-unido.png';
    }
    return null;
  }

  obtenerMonograma(cliente: ClienteApi): string {
    const palabras = `${cliente.nombre} ${cliente.empresa || ''}`.split(/\s+/).filter(Boolean);
    const sigla = palabras.find((p) => p.length >= 2 && p.length <= 3 && p === p.toUpperCase() && /^[A-ZÑÁÉÍÓÚ]+$/.test(p));
    if (sigla) return sigla.substring(0, 2);
    const partes = cliente.nombre.trim().split(/\s+/).filter(Boolean);
    if (partes.length >= 2) {
      return (partes[0][0] + partes[1][0]).toUpperCase();
    }
    return cliente.nombre.substring(0, 2).toUpperCase();
  }

  formatearUltimaActividad(fechaIso?: string | null): string {
    if (!fechaIso) return 'Reciente';
    const fecha = new Date(fechaIso);
    if (isNaN(fecha.getTime())) return 'Reciente';
    const ahora = new Date();
    const esMismoDia = fecha.getDate() === ahora.getDate() && fecha.getMonth() === ahora.getMonth() && fecha.getFullYear() === ahora.getFullYear();
    if (esMismoDia) {
      const horas = fecha.getHours().toString().padStart(2, '0');
      const minutos = fecha.getMinutes().toString().padStart(2, '0');
      return `Hoy ${horas}:${minutos}`;
    }
    const ayer = new Date(ahora);
    ayer.setDate(ayer.getDate() - 1);
    const esAyer = fecha.getDate() === ayer.getDate() && fecha.getMonth() === ayer.getMonth() && fecha.getFullYear() === ayer.getFullYear();
    if (esAyer) return 'Ayer';

    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dia = fecha.getDate();
    const mes = meses[fecha.getMonth()];
    if (fecha.getFullYear() === ahora.getFullYear()) {
      return `${dia} ${mes}`;
    }
    return `${dia} ${mes} ${fecha.getFullYear()}`;
  }

  formatearFechaDesde(fechaIso?: string | null): string {
    if (!fechaIso) return '';
    const fecha = new Date(fechaIso);
    if (isNaN(fecha.getTime())) return '';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${meses[fecha.getMonth()]} ${fecha.getFullYear()}`;
  }

  formatearFechaEntrega(fechaIso?: string | null): string {
    if (!fechaIso) return 'Sin fecha de entrega';
    const fecha = new Date(fechaIso);
    if (isNaN(fecha.getTime())) return 'Sin fecha de entrega';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `Entrega ${fecha.getDate()} ${meses[fecha.getMonth()]}`;
  }

  nuevo(): void {
    this.editandoId = null;
    this.formulario = this.formularioVacio();
    this.enviado = false;
    this.errorGuardar = '';
    this.modalFormulario = true;
  }

  editar(cliente: ClienteApi): void {
    this.editandoId = cliente.id;
    this.formulario = {
      nombre: cliente.nombre,
      empresa: cliente.empresa || '',
      correo: cliente.correo || '',
      telefono: cliente.telefono || '',
      direccion: cliente.direccion || '',
      sitioWeb: cliente.sitioWeb || '',
      notasInternas: cliente.notasInternas || '',
      estado: cliente.estado
    };
    this.enviado = false;
    this.errorGuardar = '';
    this.cerrarDetalle();
    this.modalFormulario = true;
  }

  async verFicha(cliente: ClienteApi): Promise<void> {
    const solicitud = ++this.solicitudDetalle;
    this.modalDetalle = true;
    this.detalleCargando = true;
    this.detalleError = '';
    this.clienteDetalle = null;
    try {
      const detalle = await this.api.consultarCliente(cliente.id);
      if (solicitud === this.solicitudDetalle) this.clienteDetalle = detalle;
    } catch {
      if (solicitud === this.solicitudDetalle) {
        this.detalleError = 'No se pudieron consultar los datos de este cliente.';
      }
    } finally {
      if (solicitud === this.solicitudDetalle) this.detalleCargando = false;
    }
  }

  cerrarDetalle(): void {
    ++this.solicitudDetalle;
    this.modalDetalle = false;
    this.detalleCargando = false;
  }

  abrirInvitaciones(cliente: ClienteApi): void {
    this.cerrarDetalle();
    this.cerrarInvitaciones();
    this.clienteInvitaciones = cliente;
    this.invitaciones = [];
    this.formularioInvitacion = { correo: cliente.correo || '', rol: 'TITULAR' };
    this.errorInvitaciones = '';
    this.errorCrearInvitacion = '';
    this.exitoInvitacion = '';
    this.enlaceInvitacion = null;
    this.confirmarRevocacionId = null;
    this.invitacionEnviada = false;
    void this.cargarInvitaciones();
  }

  cerrarInvitaciones(): void {
    ++this.solicitudInvitaciones;
    ++this.contextoInvitaciones;
    this.cargandoInvitaciones = false;
    this.enviandoInvitacion = false;
    this.operacionInvitacion = null;
    this.clienteInvitaciones = null;
    this.invitaciones = [];
    this.enlaceInvitacion = null;
    this.errorInvitaciones = '';
    this.errorCrearInvitacion = '';
    this.exitoInvitacion = '';
    this.confirmarRevocacionId = null;
  }

  async cargarInvitaciones(): Promise<void> {
    const cliente = this.clienteInvitaciones;
    if (!cliente) return;
    const solicitud = ++this.solicitudInvitaciones;
    this.cargandoInvitaciones = true;
    this.errorInvitaciones = '';
    try {
      const lista = await this.invitacionesApi.listar(cliente.id);
      if (solicitud !== this.solicitudInvitaciones) return;
      this.invitaciones = lista;
    } catch {
      if (solicitud === this.solicitudInvitaciones) {
        this.errorInvitaciones = 'No se pudieron consultar las invitaciones. Inténtalo de nuevo.';
      }
    } finally {
      if (solicitud === this.solicitudInvitaciones) this.cargandoInvitaciones = false;
    }
  }

  async crearInvitacion(form: NgForm): Promise<void> {
    this.invitacionEnviada = true;
    const cliente = this.clienteInvitaciones;
    if (!cliente || form.invalid || this.enviandoInvitacion || this.operacionInvitacion) return;
    const contexto = this.contextoInvitaciones;
    this.enviandoInvitacion = true;
    this.errorCrearInvitacion = '';
    this.exitoInvitacion = '';
    this.enlaceInvitacion = null;
    const correoNormalizado = this.formularioInvitacion.correo.trim().toLowerCase();
    try {
      if (!cliente.correo || cliente.correo.trim().toLowerCase() !== correoNormalizado) {
        await this.api.editarCliente(cliente.id, { correo: correoNormalizado });
        cliente.correo = correoNormalizado;
        if (this.clienteInvitaciones && this.clienteInvitaciones.id === cliente.id) {
          this.clienteInvitaciones.correo = correoNormalizado;
        }
        if (this.clienteSeleccionado && this.clienteSeleccionado.id === cliente.id) {
          this.clienteSeleccionado = { ...this.clienteSeleccionado, correo: correoNormalizado };
        }
        if (this.clienteSeleccionadoDetalle && this.clienteSeleccionadoDetalle.id === cliente.id) {
          this.clienteSeleccionadoDetalle = { ...this.clienteSeleccionadoDetalle, correo: correoNormalizado };
        }
        const index = this.clientes.findIndex((c) => c.id === cliente.id);
        if (index !== -1) {
          this.clientes[index] = { ...this.clientes[index], correo: correoNormalizado };
        }
      }

      const respuesta = await this.invitacionesApi.crear(cliente.id, {
        correo: correoNormalizado,
        rol: this.formularioInvitacion.rol
      });
      if (contexto !== this.contextoInvitaciones) return;
      this.recibirEnlace(respuesta);
      this.exitoInvitacion = 'La invitación se creó y el correo quedó asociado al cliente. No hay un proveedor de correo configurado; comparte el enlace por un canal autorizado.';
      void this.cargarInvitaciones();
      if (this.clienteSeleccionado?.id === cliente.id) {
        void this.cargarDetalleClienteSeleccionado(cliente.id);
      }
    } catch (error: any) {
      if (contexto === this.contextoInvitaciones) {
        this.errorCrearInvitacion = this.mensajeErrorInvitacion(error, 'No se pudo crear la invitación. Comprueba tu conexión e inténtalo de nuevo.');
      }
    } finally {
      if (contexto === this.contextoInvitaciones) this.enviandoInvitacion = false;
      this.changeDetector?.markForCheck();
    }
  }

  async reenviarInvitacion(invitacion: InvitacionCliente): Promise<void> {
    const cliente = this.clienteInvitaciones;
    if (!cliente || !['PENDIENTE', 'EXPIRADA'].includes(invitacion.estado) || this.operacionInvitacion || this.enviandoInvitacion) return;
    const contexto = this.contextoInvitaciones;
    this.operacionInvitacion = invitacion.id;
    this.errorCrearInvitacion = '';
    this.exitoInvitacion = '';
    this.enlaceInvitacion = null;
    try {
      const respuesta = await this.invitacionesApi.reenviar(cliente.id, invitacion.id);
      if (contexto !== this.contextoInvitaciones) return;
      this.recibirEnlace(respuesta);
      this.exitoInvitacion = 'La invitación se reenvió. No hay un proveedor de correo configurado; comparte el enlace por un canal autorizado.';
      void this.cargarInvitaciones();
    } catch (error: any) {
      if (contexto === this.contextoInvitaciones) {
        this.errorCrearInvitacion = this.mensajeErrorInvitacion(error, 'No se pudo reenviar la invitación. Inténtalo de nuevo.');
      }
    } finally {
      if (contexto === this.contextoInvitaciones) this.operacionInvitacion = null;
    }
  }

  async revocarInvitacion(invitacion: InvitacionCliente): Promise<void> {
    const cliente = this.clienteInvitaciones;
    if (!cliente || invitacion.estado !== 'PENDIENTE' || this.operacionInvitacion || this.enviandoInvitacion) return;
    if (this.confirmarRevocacionId !== invitacion.id) {
      this.confirmarRevocacionId = invitacion.id;
      return;
    }
    const contexto = this.contextoInvitaciones;
    this.operacionInvitacion = invitacion.id;
    this.errorCrearInvitacion = '';
    this.exitoInvitacion = '';
    this.enlaceInvitacion = null;
    try {
      await this.invitacionesApi.revocar(cliente.id, invitacion.id);
      if (contexto !== this.contextoInvitaciones) return;
      this.confirmarRevocacionId = null;
      this.exitoInvitacion = 'La invitación se revocó.';
      void this.cargarInvitaciones();
      if (this.clienteSeleccionado?.id === cliente.id) {
        void this.cargarDetalleClienteSeleccionado(cliente.id);
      }
    } catch (error: any) {
      if (contexto === this.contextoInvitaciones) {
        this.errorCrearInvitacion = this.mensajeErrorInvitacion(error, 'No se pudo revocar la invitación. Inténtalo de nuevo.');
      }
    } finally {
      if (contexto === this.contextoInvitaciones) this.operacionInvitacion = null;
    }
  }

  cancelarRevocacion(): void {
    this.confirmarRevocacionId = null;
  }

  async copiarEnlace(): Promise<void> {
    if (!this.enlaceInvitacion) return;
    try {
      await navigator.clipboard.writeText(this.enlaceInvitacion);
      this.exitoInvitacion = 'Enlace copiado. Compártelo por un canal autorizado.';
    } catch {
      this.exitoInvitacion = 'No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente.';
    }
  }

  private recibirEnlace(respuesta: RespuestaInvitacionEmitida): void {
    this.enlaceInvitacion = respuesta.enlaceInvitacion || null;
  }

  private mensajeErrorInvitacion(error: any, fallback: string): string {
    if (error?.name === 'TimeoutError') return 'La solicitud tardó demasiado y su resultado no se pudo confirmar. Actualiza la lista antes de volver a intentar.';
    if (error?.status === 401) return 'Tu sesión ya no está disponible. Inicia sesión e inténtalo de nuevo.';
    if (error?.status === 403) return 'No tienes permiso para administrar invitaciones de este cliente.';
    if (error?.status === 404) return 'El cliente o la invitación ya no están disponibles.';
    if (error?.status === 409) return 'La invitación cambió de estado. Actualiza la lista e inténtalo de nuevo.';
    if (error?.status === 422) return 'Revisa el correo y el rol seleccionados.';
    if (error?.status === 429) return 'Se alcanzó el límite temporal de solicitudes. Espera un momento e inténtalo de nuevo.';
    return fallback;
  }

  async guardar(form: NgForm, crearSesion = false): Promise<void> {
    this.enviado = true;
    if (form.invalid || this.guardando) return;
    this.guardando = true;
    this.errorGuardar = '';
    const esAltaFotografia = this.esFotografia && !this.editandoId;
    const datos = {
      nombre: this.formulario.nombre.trim(),
      empresa: esAltaFotografia ? null : (this.formulario.empresa.trim() || null),
      correo: this.formulario.correo.trim() || null,
      telefono: this.formulario.telefono.trim() || null,
      direccion: esAltaFotografia ? null : (this.formulario.direccion.trim() || null),
      sitioWeb: esAltaFotografia ? null : (this.formulario.sitioWeb.trim() || null),
      notasInternas: esAltaFotografia ? null : (this.formulario.notasInternas.trim() || null),
      estado: esAltaFotografia ? 'ACTIVO' : this.formulario.estado
    };
    try {
      let guardado: ClienteApi;
      if (this.editandoId) {
        guardado = await this.api.editarCliente(this.editandoId, datos);
      } else {
        guardado = await this.api.crearCliente(datos);
      }
      this.clientes = this.api.clientes;
      this.seleccionarCliente(guardado);
      this.modalFormulario = false;

      if (esAltaFotografia && crearSesion) {
        this.changeDetector?.detectChanges();
        setTimeout(() => {
          if (this.sesionesComponent) {
            this.sesionesComponent.cliente = guardado;
            this.sesionesComponent.abrirCrearSesion();
            this.changeDetector?.markForCheck();
          }
        }, 120);
      }
    } catch (error: any) {
      this.errorGuardar =
        error?.status === 422
          ? 'Revisa los datos del formulario.'
          : error?.status === 404
          ? 'El cliente ya no está disponible.'
          : 'No se pudo guardar el cliente.';
    } finally {
      this.guardando = false;
      this.changeDetector?.markForCheck();
    }
  }

  private formularioVacio() {
    return {
      nombre: '',
      empresa: '',
      correo: '',
      telefono: '',
      direccion: '',
      sitioWeb: '',
      notasInternas: '',
      estado: 'ACTIVO' as EstadoClienteApi
    };
  }
}
