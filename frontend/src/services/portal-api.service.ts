import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import { ArchivoPortal, ComentarioPortal, FacturaPortal, HitoPortal, IdentidadPortal, ProyectoPortal } from '../models/portal.model';

@Injectable({ providedIn: 'root' })
export class PortalApiService {
  private get base(): string { return `${obtenerBaseApi()}/portal`; }

  constructor(private http: HttpClient) {}

  identidad(): Promise<IdentidadPortal> {
    return firstValueFrom(this.http.get<IdentidadPortal>(this.base));
  }

  proyectos(): Promise<ProyectoPortal[]> {
    return firstValueFrom(this.http.get<ProyectoPortal[]>(`${this.base}/proyectos`));
  }

  proyecto(id: string): Promise<ProyectoPortal> {
    return firstValueFrom(this.http.get<ProyectoPortal>(`${this.base}/proyectos/${encodeURIComponent(id)}`));
  }

  hitos(id: string): Promise<HitoPortal[]> {
    return firstValueFrom(this.http.get<HitoPortal[]>(`${this.base}/proyectos/${encodeURIComponent(id)}/hitos`));
  }

  archivos(id: string): Promise<ArchivoPortal[]> {
    return firstValueFrom(this.http.get<ArchivoPortal[]>(`${this.base}/proyectos/${encodeURIComponent(id)}/archivos`));
  }

  comentarios(id: string): Promise<ComentarioPortal[]> {
    return firstValueFrom(this.http.get<ComentarioPortal[]>(`${this.base}/proyectos/${encodeURIComponent(id)}/comentarios`));
  }

  enviarComentario(id: string, contenido: string): Promise<ComentarioPortal> {
    return firstValueFrom(this.http.post<ComentarioPortal>(`${this.base}/proyectos/${encodeURIComponent(id)}/comentarios`, { contenido }));
  }

  facturas(): Promise<FacturaPortal[]> {
    return firstValueFrom(this.http.get<FacturaPortal[]>(`${this.base}/facturas`));
  }
}
