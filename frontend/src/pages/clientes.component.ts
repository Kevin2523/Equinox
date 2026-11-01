import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ClienteApi, ClientesProyectosApiService, EstadoClienteApi } from '../services/clientes-proyectos-api.service';
import { InvitacionCliente, RespuestaInvitacionEmitida, RolInvitacion } from '../models/invitacion.model';
import { InvitacionesApiService } from '../services/invitaciones-api.service';

@Component({
  selector: 'app-clientes', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './clientes.component.html', styleUrl: './clientes.component.css'
})
export class ClientesComponent implements OnInit, OnDestroy {
  clientes: ClienteApi[] = [];
  filtroEstado: 'TODOS' | EstadoClienteApi = 'TODOS';
  busqueda = '';
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
  private suscripcionSesion?: Subscription;

  constructor(
    public api: ClientesProyectosApiService,
    private invitacionesApi: InvitacionesApiService,
    private auth: AuthService,
    private changeDetector?: ChangeDetectorRef
  ) {}
  ngOnInit(): void {
    this.suscripcionSesion = this.auth.sesion$.subscribe((sesion) => {
      this.cerrarInvitaciones();
      if (sesion?.contexto.tipoAcceso === 'ORGANIZACION') {
        void this.cargar();
        return;
      }
      ++this.solicitudClientes;
      ++this.solicitudProyectos;
      this.clientes = [];
      this.cargando = false;
      this.error = '';
      this.cargandoProyectosActivos = false;
      this.errorProyectosActivos = '';
      this.changeDetector?.markForCheck();
    });
  }
  ngOnDestroy(): void {
    this.suscripcionSesion?.unsubscribe();
    this.cerrarInvitaciones();
    ++this.solicitudClientes;
    ++this.solicitudProyectos;
  }

  get totalActivos(): number { return this.clientes.filter((cliente) => cliente.estado === 'ACTIVO').length; }
  get proyectosActivos(): number { return this.api.proyectos.filter((proyecto) => proyecto.estado === 'ACTIVO').length; }

  get clientesVisibles(): ClienteApi[] {
    const query = this.busqueda.trim().toLocaleLowerCase();
    return this.clientes.filter((cliente) =>
      (this.filtroEstado === 'TODOS' || cliente.estado === this.filtroEstado) &&
      (!query || `${cliente.nombre} ${cliente.empresa || ''} ${cliente.correo || ''} ${cliente.telefono || ''} ${cliente.notasInternas || ''}`.toLocaleLowerCase().includes(query))
    );
  }

  async cargar(): Promise<void> {
    const solicitud = ++this.solicitudClientes;
    this.cargando = true; this.error = '';
    this.changeDetector?.markForCheck();
    void this.cargarProyectosActivos();
    try {
      const clientes = await this.api.listarClientes();
      if (solicitud === this.solicitudClientes) this.clientes = clientes;
    } catch {
      if (solicitud === this.solicitudClientes) this.error = 'No se pudieron cargar los clientes. Comprueba la conexión e inténtalo de nuevo.';
    } finally {
      if (solicitud === this.solicitudClientes) {
        this.cargando = false;
        this.changeDetector?.markForCheck();
      }
    }
  }

  async cargarProyectosActivos(): Promise<void> {
    const solicitud = ++this.solicitudProyectos;
    this.cargandoProyectosActivos = true; this.errorProyectosActivos = '';
    try { await this.api.listarProyectos(); }
    catch { if (solicitud === this.solicitudProyectos) this.errorProyectosActivos = 'No se pudo cargar el contador de proyectos.'; }
    finally { if (solicitud === this.solicitudProyectos) this.cargandoProyectosActivos = false; }
  }

  nuevo(): void { this.editandoId = null; this.formulario = this.formularioVacio(); this.enviado = false; this.errorGuardar = ''; this.modalFormulario = true; }

  editar(cliente: ClienteApi): void {
    this.editandoId = cliente.id;
    this.formulario = { nombre: cliente.nombre, empresa: cliente.empresa || '', correo: cliente.correo || '', telefono: cliente.telefono || '', direccion: cliente.direccion || '', sitioWeb: cliente.sitioWeb || '', notasInternas: cliente.notasInternas || '', estado: cliente.estado };
    this.enviado = false; this.errorGuardar = ''; this.cerrarDetalle(); this.modalFormulario = true;
  }

  async verDetalle(cliente: ClienteApi): Promise<void> {
    const solicitud = ++this.solicitudDetalle;
    this.modalDetalle = true; this.detalleCargando = true; this.detalleError = ''; this.clienteDetalle = null;
    try {
      const detalle = await this.api.consultarCliente(cliente.id);
      if (solicitud === this.solicitudDetalle) this.clienteDetalle = detalle;
    } catch {
      if (solicitud === this.solicitudDetalle) this.detalleError = 'No se pudieron consultar los datos de este cliente.';
    } finally { if (solicitud === this.solicitudDetalle) this.detalleCargando = false; }
  }

  cerrarDetalle(): void { ++this.solicitudDetalle; this.modalDetalle = false; this.detalleCargando = false; }

  abrirInvitaciones(cliente: ClienteApi): void {
    this.cerrarDetalle();
    this.cerrarInvitaciones();
    this.clienteInvitaciones = cliente;
    this.invitaciones = [];
    this.formularioInvitacion = { correo: cliente.correo || '', rol: 'TITULAR' };
    this.errorInvitaciones = ''; this.errorCrearInvitacion = ''; this.exitoInvitacion = '';
    this.enlaceInvitacion = null; this.confirmarRevocacionId = null; this.invitacionEnviada = false;
    void this.cargarInvitaciones();
  }

  cerrarInvitaciones(): void {
    ++this.solicitudInvitaciones;
    ++this.contextoInvitaciones;
    this.cargandoInvitaciones = false; this.enviandoInvitacion = false; this.operacionInvitacion = null;
    this.clienteInvitaciones = null; this.invitaciones = []; this.enlaceInvitacion = null;
    this.errorInvitaciones = ''; this.errorCrearInvitacion = ''; this.exitoInvitacion = '';
    this.confirmarRevocacionId = null;
  }

  async cargarInvitaciones(): Promise<void> {
    const cliente = this.clienteInvitaciones;
    if (!cliente) return;
    const solicitud = ++this.solicitudInvitaciones;
    this.cargandoInvitaciones = true; this.errorInvitaciones = '';
    try {
      const lista = await this.invitacionesApi.listar(cliente.id);
      if (solicitud !== this.solicitudInvitaciones) return;
      this.invitaciones = lista;
    } catch {
      if (solicitud === this.solicitudInvitaciones) this.errorInvitaciones = 'No se pudieron consultar las invitaciones. Inténtalo de nuevo.';
    } finally {
      if (solicitud === this.solicitudInvitaciones) this.cargandoInvitaciones = false;
    }
  }

  async crearInvitacion(form: NgForm): Promise<void> {
    this.invitacionEnviada = true;
    const cliente = this.clienteInvitaciones;
    if (!cliente || form.invalid || this.enviandoInvitacion || this.operacionInvitacion) return;
    const contexto = this.contextoInvitaciones;
    this.enviandoInvitacion = true; this.errorCrearInvitacion = ''; this.exitoInvitacion = ''; this.enlaceInvitacion = null;
    try {
      const respuesta = await this.invitacionesApi.crear(cliente.id, { correo: this.formularioInvitacion.correo.trim(), rol: this.formularioInvitacion.rol });
      if (contexto !== this.contextoInvitaciones) return;
      this.recibirEnlace(respuesta);
      this.exitoInvitacion = 'La invitación se creó. No hay un proveedor de correo configurado; comparte el enlace por un canal autorizado.';
      void this.cargarInvitaciones();
    } catch (error: any) {
      if (contexto === this.contextoInvitaciones) this.errorCrearInvitacion = this.mensajeErrorInvitacion(error, 'No se pudo crear la invitación. Comprueba tu conexión e inténtalo de nuevo.');
    } finally { if (contexto === this.contextoInvitaciones) this.enviandoInvitacion = false; }
  }

  async reenviarInvitacion(invitacion: InvitacionCliente): Promise<void> {
    const cliente = this.clienteInvitaciones;
    if (!cliente || !['PENDIENTE', 'EXPIRADA'].includes(invitacion.estado) || this.operacionInvitacion || this.enviandoInvitacion) return;
    const contexto = this.contextoInvitaciones;
    this.operacionInvitacion = invitacion.id; this.errorCrearInvitacion = ''; this.exitoInvitacion = ''; this.enlaceInvitacion = null;
    try {
      const respuesta = await this.invitacionesApi.reenviar(cliente.id, invitacion.id);
      if (contexto !== this.contextoInvitaciones) return;
      this.recibirEnlace(respuesta);
      this.exitoInvitacion = 'La invitación se reenvió. No hay un proveedor de correo configurado; comparte el enlace por un canal autorizado.';
      void this.cargarInvitaciones();
    } catch (error: any) { if (contexto === this.contextoInvitaciones) this.errorCrearInvitacion = this.mensajeErrorInvitacion(error, 'No se pudo reenviar la invitación. Inténtalo de nuevo.'); }
    finally { if (contexto === this.contextoInvitaciones) this.operacionInvitacion = null; }
  }

  async revocarInvitacion(invitacion: InvitacionCliente): Promise<void> {
    const cliente = this.clienteInvitaciones;
    if (!cliente || invitacion.estado !== 'PENDIENTE' || this.operacionInvitacion || this.enviandoInvitacion) return;
    if (this.confirmarRevocacionId !== invitacion.id) { this.confirmarRevocacionId = invitacion.id; return; }
    const contexto = this.contextoInvitaciones;
    this.operacionInvitacion = invitacion.id; this.errorCrearInvitacion = ''; this.exitoInvitacion = ''; this.enlaceInvitacion = null;
    try {
      await this.invitacionesApi.revocar(cliente.id, invitacion.id);
      if (contexto !== this.contextoInvitaciones) return;
      this.confirmarRevocacionId = null; this.exitoInvitacion = 'La invitación se revocó.';
      void this.cargarInvitaciones();
    } catch (error: any) { if (contexto === this.contextoInvitaciones) this.errorCrearInvitacion = this.mensajeErrorInvitacion(error, 'No se pudo revocar la invitación. Inténtalo de nuevo.'); }
    finally { if (contexto === this.contextoInvitaciones) this.operacionInvitacion = null; }
  }

  cancelarRevocacion(): void { this.confirmarRevocacionId = null; }

  async copiarEnlace(): Promise<void> {
    if (!this.enlaceInvitacion) return;
    try { await navigator.clipboard.writeText(this.enlaceInvitacion); this.exitoInvitacion = 'Enlace copiado. Compártelo por un canal autorizado.'; }
    catch { this.exitoInvitacion = 'No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente.'; }
  }

  private recibirEnlace(respuesta: RespuestaInvitacionEmitida): void { this.enlaceInvitacion = respuesta.enlaceInvitacion || null; }

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

  async guardar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || this.guardando) return;
    this.guardando = true; this.errorGuardar = '';
    const datos = {
      nombre: this.formulario.nombre.trim(),
      empresa: this.formulario.empresa.trim() || null,
      correo: this.formulario.correo.trim() || null,
      telefono: this.formulario.telefono.trim() || null,
      direccion: this.formulario.direccion.trim() || null,
      sitioWeb: this.formulario.sitioWeb.trim() || null,
      notasInternas: this.formulario.notasInternas.trim() || null,
      estado: this.formulario.estado
    };
    try {
      if (this.editandoId) await this.api.editarCliente(this.editandoId, datos);
      else await this.api.crearCliente(datos);
      // crearCliente/editarCliente ya sincronizan el listado del servicio tras el POST/PATCH.
      this.clientes = this.api.clientes;
      this.modalFormulario = false;
    } catch (error: any) {
      this.errorGuardar = error?.status === 422 ? 'Revisa los datos del formulario.' : error?.status === 404 ? 'El cliente ya no está disponible.' : 'No se pudo guardar el cliente.';
    } finally { this.guardando = false; }
  }

  private formularioVacio() {
    return { nombre: '', empresa: '', correo: '', telefono: '', direccion: '', sitioWeb: '', notasInternas: '', estado: 'ACTIVO' as EstadoClienteApi };
  }
}
