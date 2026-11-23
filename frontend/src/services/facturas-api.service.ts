import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import { AuthService } from '../auth/auth.service';

export type EstadoFacturaApi = 'BORRADOR' | 'ENVIADA' | 'PAGADA' | 'VENCIDA' | 'CANCELADA';

export interface PagoApi {
  id: string;
  facturaId: string;
  monto: number;
  moneda: string;
  metodo?: string | null;
  referencia?: string | null;
  notas?: string | null;
  creadoEn: string;
}

export interface HistorialFacturaApi {
  id: string;
  estadoAnterior: string | null;
  estadoNuevo: string;
  motivo?: string | null;
  creadoEn: string;
  usuario?: { id: string; nombre: string; apellido?: string | null } | null;
}

export interface FacturaApi {
  id: string;
  organizacionId?: string;
  clienteId: string;
  proyectoId?: string | null;
  numero: string;
  concepto: string;
  monto: number | string;
  moneda: string;
  estado: EstadoFacturaApi;
  visibleEnPortal?: boolean;
  fechaEmision: string;
  fechaVencimiento?: string | null;
  pagadaEn?: string | null;
  notas?: string | null;
  creadoEn?: string;
  actualizadoEn?: string;
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
  pagos?: PagoApi[];
  historial?: HistorialFacturaApi[];
  totalPagado?: number;
  montoPendiente?: number;
}

export interface TotalMonedaApi {
  moneda: string;
  totalPorCobrar: number;
  totalCobrado: number;
  facturasEmitidas: number;
  facturasPendientes: number;
  facturasPagadas: number;
}

export interface TotalesFacturasApi {
  totalesPorMoneda: TotalMonedaApi[];
}

export interface CrearFacturaInput {
  clienteId: string;
  proyectoId?: string | null;
  numero?: string;
  concepto: string;
  monto: number;
  moneda?: string;
  estado?: EstadoFacturaApi;
  visibleEnPortal?: boolean;
  fechaEmision?: string;
  fechaVencimiento?: string | null;
  notas?: string | null;
}

export type NuevaFacturaApi = CrearFacturaInput;

export type ActualizarFacturaInput = Partial<CrearFacturaInput> & {
  pagadaEn?: string | null;
  motivo?: string;
};

export interface OrganizacionFinanzasApi {
  id: string;
  nombre: string;
  moneda: string;
  portalMostrarFinanzas?: boolean;
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

  private get base(): string {
    return `${obtenerBaseApi()}/facturas`;
  }

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

  async listarFacturas(filtros?: {
    clienteId?: string;
    proyectoId?: string;
    estado?: string;
    busqueda?: string;
  }): Promise<FacturaApi[]> {
    const generacion = this.generacionSesion;
    const token = this.auth?.token;
    this.cargandoSubject.next(true);
    this.errorSubject.next(null);

    let params = new HttpParams();
    if (filtros?.clienteId) params = params.set('clienteId', filtros.clienteId);
    if (filtros?.proyectoId) params = params.set('proyectoId', filtros.proyectoId);
    if (filtros?.estado && filtros.estado !== 'TODAS') params = params.set('estado', filtros.estado);
    if (filtros?.busqueda) params = params.set('busqueda', filtros.busqueda);

    try {
      const facturas = await firstValueFrom(
        this.http.get<FacturaApi[]>(this.base, {
          params,
          headers: { 'Cache-Control': 'no-cache' }
        })
      );
      if (generacion === this.generacionSesion && token === this.auth?.token && !filtros) {
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

  consultarTotales(): Promise<TotalesFacturasApi> {
    return firstValueFrom(this.http.get<TotalesFacturasApi>(`${this.base}/totales`));
  }

  consultarPortalFinanzas(): Promise<{ portalMostrarFinanzas: boolean }> {
    return firstValueFrom(this.http.get<{ portalMostrarFinanzas: boolean }>(`${obtenerBaseApi()}/organizacion`));
  }

  configurarPortalFinanzas(habilitado: boolean): Promise<{ portalMostrarFinanzas: boolean }> {
    return firstValueFrom(
      this.http.patch<{ portalMostrarFinanzas: boolean }>(`${obtenerBaseApi()}/organizacion`, {
        portalMostrarFinanzas: habilitado
      })
    );
  }

  consultarFactura(id: string): Promise<FacturaApi> {
    return firstValueFrom(this.http.get<FacturaApi>(`${this.base}/${encodeURIComponent(id)}`));
  }

  async crearFactura(datos: CrearFacturaInput): Promise<FacturaApi> {
    const factura = await firstValueFrom(this.http.post<FacturaApi>(this.base, datos));
    await this.listarFacturas().catch(() => null);
    return factura;
  }

  async actualizarFactura(id: string, datos: ActualizarFacturaInput): Promise<FacturaApi> {
    const factura = await firstValueFrom(
      this.http.patch<FacturaApi>(`${this.base}/${encodeURIComponent(id)}`, datos)
    );
    await this.listarFacturas().catch(() => null);
    return factura;
  }

  async registrarPago(
    id: string,
    datos: { monto: number; moneda?: string; metodo?: string; referencia?: string | null; notas?: string | null }
  ): Promise<{ pago: PagoApi; factura: FacturaApi; saldoRestante: number }> {
    const resultado = await firstValueFrom(
      this.http.post<{ pago: PagoApi; factura: FacturaApi; saldoRestante: number }>(
        `${this.base}/${encodeURIComponent(id)}/pagos`,
        datos
      )
    );
    await this.listarFacturas().catch(() => null);
    return resultado;
  }

  async eliminarFactura(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.base}/${encodeURIComponent(id)}`));
    await this.listarFacturas().catch(() => null);
  }

  obtenerOrganizacion(): Promise<OrganizacionFinanzasApi> {
    return firstValueFrom(this.http.get<OrganizacionFinanzasApi>(`${obtenerBaseApi()}/organizacion`));
  }
}
