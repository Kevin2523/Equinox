import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';

export type EstadoClienteApi = 'ACTIVO' | 'INACTIVO' | 'PROSPECTO' | 'ARCHIVADO';
export type EstadoProyectoApi = 'BORRADOR' | 'ACTIVO' | 'PAUSADO' | 'COMPLETADO' | 'CANCELADO';

export interface ClienteApi {
  id: string;
  organizacionId: string;
  nombre: string;
  empresa: string | null;
  correo: string | null;
  telefono: string | null;
  direccion?: string | null;
  sitioWeb?: string | null;
  notasInternas: string | null;
  estado: EstadoClienteApi;
  creadoEn: string;
  actualizadoEn: string;
  _count?: { proyectos: number };
  proyectos?: ProyectoApi[];
}

export interface ProyectoApi {
  id: string;
  organizacionId: string;
  clienteId: string;
  creadoPorId: string;
  nombre: string;
  descripcion: string | null;
  estado: EstadoProyectoApi;
  presupuesto: string | number | null;
  moneda: string;
  fechaInicio: string | null;
  fechaEntrega: string | null;
  creadoEn: string;
  actualizadoEn: string;
  cliente?: Pick<ClienteApi, 'id' | 'nombre' | 'empresa'>;
  _count?: { tareas: number; hitos: number };
}

export type CrearClienteApi = Pick<ClienteApi, 'nombre'> & Partial<Pick<ClienteApi, 'empresa' | 'correo' | 'telefono' | 'direccion' | 'sitioWeb' | 'estado'>> & { notasInternas?: string | null };
export type EditarClienteApi = Partial<CrearClienteApi>;
export type CrearProyectoApi = Pick<ProyectoApi, 'clienteId' | 'nombre'> & Partial<Pick<ProyectoApi, 'descripcion' | 'estado' | 'presupuesto' | 'moneda' | 'fechaInicio' | 'fechaEntrega'>>;
export type EditarProyectoApi = Partial<CrearProyectoApi>;

@Injectable({ providedIn: 'root' })
export class ClientesProyectosApiService {
  private readonly clientesSubject = new BehaviorSubject<ClienteApi[]>([]);
  private readonly proyectosSubject = new BehaviorSubject<ProyectoApi[]>([]);
  private readonly proyectoSeleccionadoSubject = new BehaviorSubject<ProyectoApi | null>(null);
  readonly clientes$ = this.clientesSubject.asObservable();
  readonly proyectos$ = this.proyectosSubject.asObservable();
  readonly proyectoSeleccionado$ = this.proyectoSeleccionadoSubject.asObservable();

  get clientes(): ClienteApi[] { return this.clientesSubject.value; }
  get proyectos(): ProyectoApi[] { return this.proyectosSubject.value; }
  get proyectoSeleccionado(): ProyectoApi | null { return this.proyectoSeleccionadoSubject.value; }

  constructor(private http: HttpClient) {}

  async listarClientes(buscar?: string, estado?: EstadoClienteApi): Promise<ClienteApi[]> {
    let params = new HttpParams();
    if (buscar?.trim()) params = params.set('buscar', buscar.trim());
    if (estado) params = params.set('estado', estado);
    const clientes = await firstValueFrom(this.http.get<ClienteApi[]>(`${obtenerBaseApi()}/clientes`, { params }));
    this.clientesSubject.next(clientes);
    return clientes;
  }

  async consultarCliente(id: string): Promise<ClienteApi> {
    return firstValueFrom(this.http.get<ClienteApi>(`${obtenerBaseApi()}/clientes/${encodeURIComponent(id)}`));
  }

  async crearCliente(datos: CrearClienteApi): Promise<ClienteApi> {
    const cliente = await firstValueFrom(this.http.post<ClienteApi>(`${obtenerBaseApi()}/clientes`, datos));
    await this.listarClientes();
    return cliente;
  }

  async editarCliente(id: string, datos: EditarClienteApi): Promise<ClienteApi> {
    const cliente = await firstValueFrom(this.http.patch<ClienteApi>(`${obtenerBaseApi()}/clientes/${encodeURIComponent(id)}`, datos));
    await this.listarClientes();
    return cliente;
  }

  async listarProyectos(estado?: EstadoProyectoApi, clienteId?: string): Promise<ProyectoApi[]> {
    let params = new HttpParams();
    if (estado) params = params.set('estado', estado);
    if (clienteId) params = params.set('clienteId', clienteId);
    const proyectos = await firstValueFrom(this.http.get<ProyectoApi[]>(`${obtenerBaseApi()}/proyectos`, { params }));
    this.proyectosSubject.next(proyectos);
    return proyectos;
  }

  async consultarProyecto(id: string): Promise<ProyectoApi> {
    return firstValueFrom(this.http.get<ProyectoApi>(`${obtenerBaseApi()}/proyectos/${encodeURIComponent(id)}`));
  }

  async seleccionarProyecto(id: string): Promise<ProyectoApi> {
    const proyecto = await this.consultarProyecto(id);
    this.proyectoSeleccionadoSubject.next(proyecto);
    return proyecto;
  }

  limpiarProyectoSeleccionado(): void { this.proyectoSeleccionadoSubject.next(null); }

  async crearProyecto(datos: CrearProyectoApi): Promise<ProyectoApi> {
    const proyecto = await firstValueFrom(this.http.post<ProyectoApi>(`${obtenerBaseApi()}/proyectos`, datos));
    await this.listarProyectos();
    return proyecto;
  }

  async editarProyecto(id: string, datos: EditarProyectoApi): Promise<ProyectoApi> {
    const proyecto = await firstValueFrom(this.http.patch<ProyectoApi>(`${obtenerBaseApi()}/proyectos/${encodeURIComponent(id)}`, datos));
    const proyectos = await this.listarProyectos();
    if (this.proyectoSeleccionado?.id === id) {
      const actualizado = proyectos.find((elemento) => elemento.id === id) || proyecto;
      const cliente = this.clientes.find((elemento) => elemento.id === actualizado.clienteId)
        || (this.proyectoSeleccionado.cliente?.id === actualizado.clienteId ? this.proyectoSeleccionado.cliente : undefined);
      this.proyectoSeleccionadoSubject.next({ ...actualizado, ...(cliente ? { cliente } : {}) });
    }
    return proyecto;
  }
}
