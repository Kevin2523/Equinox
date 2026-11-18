import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import { AuthService } from '../auth/auth.service';

export type EstadoFacturaApi = 'BORRADOR' | 'ENVIADA' | 'PAGADA' | 'VENCIDA' | 'CANCELADA';

export interface FacturaApi {
  id: string;
  organizacionId: string;
  clienteId: string;
  proyectoId?: string | null;
  numero: string;
  concepto: string;
  monto: number | string;
  moneda: string;
  estado: EstadoFacturaApi;
  fechaEmision: string;
  fechaVencimiento?: string | null;
  pagadaEn?: string | null;
  notas?: string | null;
  creadoEn: string;
  actualizadoEn: string;
  cliente?: {
    id: string;
    nombre: string;
    empresa: string | null;
    correo?: string | null;
  };
  proyecto?: {
    id: string;
    nombre: string;
  } | null;
}

export interface CrearFacturaInput {
  clienteId: string;
  proyectoId?: string | null;
  numero: string;
  concepto: string;
  monto: number;
  moneda?: string;
  estado?: EstadoFacturaApi;
  fechaEmision?: string;
  fechaVencimiento?: string | null;
  notas?: string | null;
}

export type ActualizarFacturaInput = Partial<CrearFacturaInput> & {
  pagadaEn?: string | null;
};

export interface OrganizacionFinanzasApi {
  id: string;
  nombre: string;
  moneda: string;
}

@Injectable({ providedIn: 'root' })
export class FacturasApiService {
  private generacionSesion = 0;
  private readonly facturasSubject = new BehaviorSubject<FacturaApi[]>([]);
  private readonly cargandoSubject = new BehaviorSubject<boolean>(false);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);

  readonly facturas$ = this.facturasSubject.asObservable();
  readonly cargando$ = this.cargandoSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();

  get facturas(): FacturaApi[] {
    return this.facturasSubject.value;
  }

  get cargando(): boolean {
    return this.cargandoSubject.value;
  }

  constructor(private http: HttpClient, private auth?: AuthService) {
    this.auth?.sesion$.subscribe(() => {
      this.generacionSesion++;
      this.facturasSubject.next([]);
      this.errorSubject.next(null);
    });
  }

  async listarFacturas(): Promise<FacturaApi[]> {
    const generacion = this.generacionSesion;
    const token = this.auth?.token;
    this.cargandoSubject.next(true);
    this.errorSubject.next(null);
    try {
      const facturas = await firstValueFrom(
        this.http.get<FacturaApi[]>(`${obtenerBaseApi()}/facturas`, {
          headers: { 'Cache-Control': 'no-cache' }
        })
      );
      if (generacion === this.generacionSesion && token === this.auth?.token) {
        this.facturasSubject.next(facturas);
      }
      return facturas;
    } catch (err: any) {
      if (generacion === this.generacionSesion) {
        const mensaje = err?.error?.error || 'No se pudieron cargar las facturas';
        this.errorSubject.next(mensaje);
      }
      throw err;
    } finally {
      if (generacion === this.generacionSesion) {
        this.cargandoSubject.next(false);
      }
    }
  }

  async consultarFactura(id: string): Promise<FacturaApi> {
    return firstValueFrom(
      this.http.get<FacturaApi>(`${obtenerBaseApi()}/facturas/${encodeURIComponent(id)}`)
    );
  }

  async crearFactura(datos: CrearFacturaInput): Promise<FacturaApi> {
    const factura = await firstValueFrom(
      this.http.post<FacturaApi>(`${obtenerBaseApi()}/facturas`, datos)
    );
    await this.listarFacturas();
    return factura;
  }

  async actualizarFactura(id: string, datos: ActualizarFacturaInput): Promise<FacturaApi> {
    const factura = await firstValueFrom(
      this.http.patch<FacturaApi>(`${obtenerBaseApi()}/facturas/${encodeURIComponent(id)}`, datos)
    );
    await this.listarFacturas();
    return factura;
  }

  async eliminarFactura(id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${obtenerBaseApi()}/facturas/${encodeURIComponent(id)}`)
    );
    await this.listarFacturas();
  }

  async obtenerOrganizacion(): Promise<OrganizacionFinanzasApi> {
    return firstValueFrom(
      this.http.get<OrganizacionFinanzasApi>(`${obtenerBaseApi()}/organizacion`)
    );
  }
}
