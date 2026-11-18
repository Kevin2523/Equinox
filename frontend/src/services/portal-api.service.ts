import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import {
  ArchivoPortal,
  ComentarioPortal,
  FacturaPortal,
  FotoPortal,
  HitoPortal,
  IdentidadPortal,
  PaginaFotosPortal,
  ProyectoPortal,
  SesionFotograficaPortal
} from '../models/portal.model';

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

  finanzasDesactivadas = false;

  async facturas(): Promise<FacturaPortal[]> {
    const res: any = await firstValueFrom(
      this.http.get<any>(`${this.base}/facturas`, { observe: 'response' })
    );
    if (res && res.headers && typeof res.headers.get === 'function') {
      const estado = res.headers.get('x-portal-finanzas');
      this.finanzasDesactivadas = estado === 'deshabilitado';
      return res.body || [];
    }
    return Array.isArray(res) ? res : (res?.body || []);
  }

  sesionesFotograficas(): Promise<SesionFotograficaPortal[]> {
    return firstValueFrom(this.http.get<SesionFotograficaPortal[]>(`${this.base}/sesiones-fotograficas`));
  }

  sesionFotografica(id: string): Promise<SesionFotograficaPortal> {
    return firstValueFrom(this.http.get<SesionFotograficaPortal>(`${this.base}/sesiones-fotograficas/${encodeURIComponent(id)}`));
  }

  fotosSesion(sesionId: string, pagina: number = 1, limite: number = 24): Promise<PaginaFotosPortal> {
    const query = `pagina=${encodeURIComponent(pagina)}&limite=${encodeURIComponent(limite)}`;
    return firstValueFrom(this.http.get<PaginaFotosPortal>(
      `${this.base}/sesiones-fotograficas/${encodeURIComponent(sesionId)}/fotos?${query}`
    ));
  }

  obtenerContenidoFoto(sesionId: string, fotoId: string, variante: 'miniatura' | 'original' = 'miniatura'): Promise<Blob> {
    return firstValueFrom(this.http.get(
      `${this.base}/sesiones-fotograficas/${encodeURIComponent(sesionId)}/fotos/${encodeURIComponent(fotoId)}/contenido?variante=${encodeURIComponent(variante)}`,
      { responseType: 'blob' }
    ));
  }
}
