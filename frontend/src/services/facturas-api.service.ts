import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';

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
  numero: string;
  concepto: string;
  monto: number;
  moneda: string;
  estado: 'BORRADOR' | 'ENVIADA' | 'PAGADA' | 'VENCIDA' | 'CANCELADA';
  visibleEnPortal: boolean;
  fechaEmision: string;
  fechaVencimiento: string | null;
  pagadaEn: string | null;
  notas: string | null;
  clienteId: string;
  proyectoId: string | null;
  cliente?: { id: string; nombre: string; empresa: string | null };
  proyecto?: { id: string; nombre: string } | null;
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

export interface NuevaFacturaApi {
  clienteId: string;
  proyectoId?: string | null;
  numero?: string;
  concepto: string;
  monto: number;
  moneda?: string;
  estado?: 'BORRADOR' | 'ENVIADA' | 'PAGADA' | 'VENCIDA' | 'CANCELADA';
  visibleEnPortal?: boolean;
  fechaEmision?: string;
  fechaVencimiento?: string | null;
  notas?: string | null;
}

@Injectable({ providedIn: 'root' })
export class FacturasApiService {
  private get base(): string {
    return `${obtenerBaseApi()}/facturas`;
  }

  constructor(private http: HttpClient) {}

  listarFacturas(filtros?: {
    clienteId?: string;
    proyectoId?: string;
    estado?: string;
    busqueda?: string;
  }): Promise<FacturaApi[]> {
    let params = new HttpParams();
    if (filtros?.clienteId) params = params.set('clienteId', filtros.clienteId);
    if (filtros?.proyectoId) params = params.set('proyectoId', filtros.proyectoId);
    if (filtros?.estado && filtros.estado !== 'TODAS') params = params.set('estado', filtros.estado);
    if (filtros?.busqueda) params = params.set('busqueda', filtros.busqueda);

    return firstValueFrom(this.http.get<FacturaApi[]>(this.base, { params }));
  }

  consultarTotales(): Promise<TotalesFacturasApi> {
    return firstValueFrom(this.http.get<TotalesFacturasApi>(`${this.base}/totales`));
  }

  consultarPortalFinanzas(): Promise<{ portalMostrarFinanzas: boolean }> {
    return firstValueFrom(this.http.get<{ portalMostrarFinanzas: boolean }>(`${obtenerBaseApi()}/organizacion`));
  }

  configurarPortalFinanzas(habilitado: boolean): Promise<{ portalMostrarFinanzas: boolean }> {
    return firstValueFrom(this.http.patch<{ portalMostrarFinanzas: boolean }>(`${obtenerBaseApi()}/organizacion`, { portalMostrarFinanzas: habilitado }));
  }

  consultarFactura(id: string): Promise<FacturaApi> {
    return firstValueFrom(this.http.get<FacturaApi>(`${this.base}/${encodeURIComponent(id)}`));
  }

  crearFactura(datos: NuevaFacturaApi): Promise<FacturaApi> {
    return firstValueFrom(this.http.post<FacturaApi>(this.base, datos));
  }

  actualizarFactura(
    id: string,
    datos: Partial<NuevaFacturaApi> & { estado?: string; motivo?: string }
  ): Promise<FacturaApi> {
    return firstValueFrom(
      this.http.patch<FacturaApi>(`${this.base}/${encodeURIComponent(id)}`, datos)
    );
  }

  registrarPago(
    id: string,
    datos: { monto: number; moneda?: string; metodo?: string; referencia?: string | null; notas?: string | null }
  ): Promise<{ pago: PagoApi; factura: FacturaApi; saldoRestante: number }> {
    return firstValueFrom(
      this.http.post<{ pago: PagoApi; factura: FacturaApi; saldoRestante: number }>(
        `${this.base}/${encodeURIComponent(id)}/pagos`,
        datos
      )
    );
  }

  eliminarFactura(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${encodeURIComponent(id)}`));
  }
}
