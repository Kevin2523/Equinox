import { Injectable } from '@angular/core';
import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';

export interface ArchivoApi {
  id: string; proyectoId: string; nombre: string; nombreOriginal: string; tipoMime: string;
  tamanoBytes: number; tipo: 'ARCHIVO' | 'ENTREGABLE' | 'IMAGEN' | 'DOCUMENTO';
  visibilidad: 'INTERNA' | 'CLIENTE'; descripcion: string | null; publicadoEn: string | null; creadoEn: string;
}

@Injectable({ providedIn: 'root' })
export class ArchivosApiService {
  constructor(private http: HttpClient) {}
  private ruta(proyectoId: string): string { return `${obtenerBaseApi()}/proyectos/${encodeURIComponent(proyectoId)}/archivos`; }
  listar(proyectoId: string): Promise<ArchivoApi[]> { return firstValueFrom(this.http.get<ArchivoApi[]>(this.ruta(proyectoId))); }
  subir(proyectoId: string, archivo: File, visibilidad: ArchivoApi['visibilidad'], progreso: (valor: number) => void): Promise<ArchivoApi> {
    const cuerpo = new FormData();
    cuerpo.append('archivo', archivo);
    cuerpo.append('visibilidad', visibilidad);
    return new Promise((resolve, reject) => {
      this.http.post<ArchivoApi>(this.ruta(proyectoId), cuerpo, { observe: 'events', reportProgress: true }).subscribe({
        next: (evento) => {
          if (evento.type === HttpEventType.UploadProgress && evento.total) progreso(Math.round(evento.loaded / evento.total * 100));
          if (evento instanceof HttpResponse && evento.body) resolve(evento.body);
        },
        error: reject,
      });
    });
  }
  eliminar(proyectoId: string, archivoId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.ruta(proyectoId)}/${encodeURIComponent(archivoId)}`));
  }
  descargar(proyectoId: string, archivoId: string, cliente = false): Promise<Blob> {
    const base = cliente ? `${obtenerBaseApi()}/portal/proyectos/${encodeURIComponent(proyectoId)}/archivos` : this.ruta(proyectoId);
    return firstValueFrom(this.http.get(`${base}/${encodeURIComponent(archivoId)}/descargar`, { responseType: 'blob' }));
  }
  async guardarDescarga(proyectoId: string, archivo: Pick<ArchivoApi, 'id' | 'nombreOriginal'>, cliente = false): Promise<void> {
    const blob = await this.descargar(proyectoId, archivo.id, cliente);
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = archivo.nombreOriginal;
    enlace.click();
    URL.revokeObjectURL(url);
  }
}
