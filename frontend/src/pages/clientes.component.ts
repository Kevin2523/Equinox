import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ClienteApi, ClientesProyectosApiService, EstadoClienteApi } from '../services/clientes-proyectos-api.service';

@Component({
  selector: 'app-clientes', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './clientes.component.html'
})
export class ClientesComponent implements OnInit {
  clientes: ClienteApi[] = [];
  filtroEstado: 'TODOS' | EstadoClienteApi = 'TODOS';
  busqueda = '';
  cargando = false;
  guardando = false;
  error = '';
  errorGuardar = '';
  modalFormulario = false;
  modalDetalle = false;
  detalleCargando = false;
  detalleError = '';
  enviado = false;
  editandoId: string | null = null;
  clienteDetalle: ClienteApi | null = null;
  formulario = this.formularioVacio();

  constructor(public api: ClientesProyectosApiService) {}
  ngOnInit(): void { void this.cargar(); }

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
    this.cargando = true; this.error = '';
    try { [this.clientes] = await Promise.all([this.api.listarClientes(), this.api.listarProyectos()]); }
    catch { this.error = 'No se pudieron cargar los clientes. Comprueba la conexión e inténtalo de nuevo.'; }
    finally { this.cargando = false; }
  }

  nuevo(): void { this.editandoId = null; this.formulario = this.formularioVacio(); this.enviado = false; this.errorGuardar = ''; this.modalFormulario = true; }

  editar(cliente: ClienteApi): void {
    this.editandoId = cliente.id;
    this.formulario = { nombre: cliente.nombre, empresa: cliente.empresa || '', correo: cliente.correo || '', telefono: cliente.telefono || '', direccion: cliente.direccion || '', sitioWeb: cliente.sitioWeb || '', notasInternas: cliente.notasInternas || '', estado: cliente.estado };
    this.enviado = false; this.errorGuardar = ''; this.modalDetalle = false; this.modalFormulario = true;
  }

  async verDetalle(cliente: ClienteApi): Promise<void> {
    this.modalDetalle = true; this.detalleCargando = true; this.detalleError = ''; this.clienteDetalle = null;
    try { this.clienteDetalle = await this.api.consultarCliente(cliente.id); }
    catch { this.detalleError = 'No se pudieron consultar los datos de este cliente.'; }
    finally { this.detalleCargando = false; }
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
      this.clientes = await this.api.listarClientes();
      this.modalFormulario = false;
    } catch (error: any) {
      this.errorGuardar = error?.status === 422 ? 'Revisa los datos del formulario.' : error?.status === 404 ? 'El cliente ya no está disponible.' : 'No se pudo guardar el cliente.';
    } finally { this.guardando = false; }
  }

  private formularioVacio() {
    return { nombre: '', empresa: '', correo: '', telefono: '', direccion: '', sitioWeb: '', notasInternas: '', estado: 'ACTIVO' as EstadoClienteApi };
  }
}
