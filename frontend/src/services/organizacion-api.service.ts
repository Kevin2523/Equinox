import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';

export interface OrganizacionApi {
  id: string;
  nombre: string;
  slug: string;
  descripcion?: string | null;
  moneda: string;
  ruc?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  correoContacto?: string | null;
  logoUrl?: string | null;
  colorPrimario: string;
  colorSecundario: string;
  tipografia: string;
  dominioPortal?: string | null;
  portalMostrarFinanzas: boolean;
  miembros?: Array<{
    usuario: { id: string; nombre: string; apellido?: string | null; correo: string };
  }>;
}

export interface ActualizarOrganizacionApi {
  nombre?: string;
  descripcion?: string | null;
  moneda?: string;
  ruc?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  correoContacto?: string | null;
  logoUrl?: string | null;
  colorPrimario?: string;
  colorSecundario?: string;
  tipografia?: string;
  dominioPortal?: string | null;
  portalMostrarFinanzas?: boolean;
}

export interface MetricasPanelApi {
  clientesActivos: number;
  proyectosEnCurso: number;
  tareasVencidas: number;
}

export interface PanelOrganizacionApi {
  metricas: MetricasPanelApi;
  proximasTareas: any[];
  actividadReciente: any[];
}

@Injectable({ providedIn: 'root' })
export class OrganizacionApiService {
  private get base(): string {
    return `${obtenerBaseApi()}/organizacion`;
  }

  constructor(private http: HttpClient) {}

  consultar(): Promise<OrganizacionApi> {
    return firstValueFrom(this.http.get<OrganizacionApi>(this.base));
  }

  actualizar(datos: ActualizarOrganizacionApi): Promise<OrganizacionApi> {
    return firstValueFrom(this.http.patch<OrganizacionApi>(this.base, datos));
  }

  consultarPanel(): Promise<PanelOrganizacionApi> {
    return firstValueFrom(this.http.get<PanelOrganizacionApi>(`${this.base}/panel`));
  }
}

