import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';

export type TipoFreelance = 'GENERAL' | 'DESARROLLO_SOFTWARE' | 'FOTOGRAFIA' | 'DISENO_GRAFICO';

export type EstadoSesion = 'BORRADOR' | 'PUBLICADA';

export interface SesionFotograficaApi {
  id: string;
  organizacionId?: string;
  clienteId: string;
  nombre: string;
  descripcion?: string | null;
  fecha?: string | null;
  estado: EstadoSesion;
  portadaFotoId?: string | null;
  creadoEn: string;
  actualizadoEn?: string;
  cantidadFotos?: number;
  _count?: {
    fotos?: number;
  };
}

export interface FotoSesionApi {
  id: string;
  sesionId: string;
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  orden: number;
  creadoEn: string;
  esPortada?: boolean;
}

export interface PaginaFotosApi {
  items: FotoSesionApi[];
  total: number;
  pagina: number;
  limite: number;
}

export interface CrearSesionDto {
  nombre: string;
  descripcion?: string | null;
  fecha?: string | null;
}

export interface ActualizarSesionDto {
  nombre?: string;
  descripcion?: string | null;
  fecha?: string | null;
  estado?: EstadoSesion;
  portadaFotoId?: string | null;
}

export interface ActualizarFotoDto {
  orden?: number;
  portada?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class FotografiaApiService implements OnDestroy {
  private readonly miniaturasCache = new Map<string, string>();
  private readonly promesasMiniaturas = new Map<string, Promise<string>>();

  private readonly tipoFreelanceSubject = new BehaviorSubject<TipoFreelance>('GENERAL');
  readonly tipoFreelance$ = this.tipoFreelanceSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  ngOnDestroy(): void {
    this.revocarTodasMiniaturas();
  }

  get tipoFreelanceActual(): TipoFreelance {
    return this.tipoFreelanceSubject.value;
  }

  async obtenerTipoFreelance(): Promise<TipoFreelance> {
    try {
      const org = await firstValueFrom(
        this.http.get<{ tipoFreelance?: TipoFreelance }>(`${obtenerBaseApi()}/organizacion`)
      );
      const tipo: TipoFreelance = org?.tipoFreelance || 'GENERAL';
      this.tipoFreelanceSubject.next(tipo);
      return tipo;
    } catch {
      return this.tipoFreelanceSubject.value;
    }
  }

  actualizarTipoFreelanceLocal(tipo: TipoFreelance): void {
    this.tipoFreelanceSubject.next(tipo);
  }

  async listarSesiones(clienteId: string): Promise<SesionFotograficaApi[]> {
    const base = obtenerBaseApi();
    return this.ejecutarConFallback(
      () => this.http.get<SesionFotograficaApi[]>(`${base}/clientes/${clienteId}/sesiones-fotograficas`),
      () => this.http.get<SesionFotograficaApi[]>(`${base}/sesiones-fotograficas?clienteId=${clienteId}`)
    );
  }

  async crearSesion(clienteId: string, dto: CrearSesionDto): Promise<SesionFotograficaApi> {
    const base = obtenerBaseApi();
    return this.ejecutarConFallback(
      () => this.http.post<SesionFotograficaApi>(`${base}/clientes/${clienteId}/sesiones-fotograficas`, dto),
      () => this.http.post<SesionFotograficaApi>(`${base}/sesiones-fotograficas`, { ...dto, clienteId })
    );
  }

  async consultarSesion(clienteId: string, sesionId: string): Promise<SesionFotograficaApi> {
    const base = obtenerBaseApi();
    return this.ejecutarConFallback(
      () => this.http.get<SesionFotograficaApi>(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}`),
      () => this.http.get<SesionFotograficaApi>(`${base}/sesiones-fotograficas/${sesionId}`)
    );
  }

  async actualizarSesion(clienteId: string, sesionId: string, dto: ActualizarSesionDto): Promise<SesionFotograficaApi> {
    const base = obtenerBaseApi();
    return this.ejecutarConFallback(
      () => this.http.patch<SesionFotograficaApi>(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}`, dto),
      () => this.http.patch<SesionFotograficaApi>(`${base}/sesiones-fotograficas/${sesionId}`, dto)
    );
  }

  async eliminarSesion(clienteId: string, sesionId: string): Promise<void> {
    const base = obtenerBaseApi();
    await this.ejecutarConFallback(
      () => this.http.delete<void>(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}`),
      () => this.http.delete<void>(`${base}/sesiones-fotograficas/${sesionId}`)
    );
  }

  async listarFotos(clienteId: string, sesionId: string, pagina = 1, limite = 50): Promise<PaginaFotosApi> {
    const base = obtenerBaseApi();
    const query = `?pagina=${pagina}&limite=${limite}`;
    return this.ejecutarConFallback(
      () => this.http.get<PaginaFotosApi>(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}/fotos${query}`),
      () => this.http.get<PaginaFotosApi>(`${base}/sesiones-fotograficas/${sesionId}/fotos${query}`)
    );
  }

  async subirFoto(clienteId: string, sesionId: string, archivo: File): Promise<FotoSesionApi> {
    const base = obtenerBaseApi();
    const formData = new FormData();
    formData.append('foto', archivo, archivo.name);
    formData.append('archivo', archivo, archivo.name);

    return this.ejecutarConFallback(
      () => this.http.post<FotoSesionApi>(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}/fotos`, formData),
      () => this.http.post<FotoSesionApi>(`${base}/sesiones-fotograficas/${sesionId}/fotos`, formData)
    );
  }

  async eliminarFoto(clienteId: string, sesionId: string, fotoId: string): Promise<void> {
    this.revocarMiniatura(fotoId);
    const base = obtenerBaseApi();
    await this.ejecutarConFallback(
      () => this.http.delete<void>(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}/fotos/${fotoId}`),
      () => this.http.delete<void>(`${base}/sesiones-fotograficas/${sesionId}/fotos/${fotoId}`)
    );
  }

  async actualizarFoto(
    clienteId: string,
    sesionId: string,
    fotoId: string,
    dto: ActualizarFotoDto
  ): Promise<FotoSesionApi> {
    const base = obtenerBaseApi();
    return this.ejecutarConFallback(
      () => this.http.patch<FotoSesionApi>(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}/fotos/${fotoId}`, dto),
      () => this.http.patch<FotoSesionApi>(`${base}/sesiones-fotograficas/${sesionId}/fotos/${fotoId}`, dto)
    );
  }

  async obtenerContenidoBlob(
    clienteId: string,
    sesionId: string,
    fotoId: string,
    variante: 'miniatura' | 'original' = 'miniatura'
  ): Promise<Blob> {
    const base = obtenerBaseApi();
    const query = `?variante=${variante}`;
    return this.ejecutarConFallback(
      () =>
        this.http.get(`${base}/clientes/${clienteId}/sesiones-fotograficas/${sesionId}/fotos/${fotoId}/contenido${query}`, {
          responseType: 'blob'
        }),
      () =>
        this.http.get(`${base}/sesiones-fotograficas/${sesionId}/fotos/${fotoId}/contenido${query}`, {
          responseType: 'blob'
        })
    );
  }

  async obtenerUrlMiniatura(clienteId: string, sesionId: string, fotoId: string): Promise<string> {
    const cached = this.miniaturasCache.get(fotoId);
    if (cached) return cached;

    const enProgreso = this.promesasMiniaturas.get(fotoId);
    if (enProgreso) return enProgreso;

    const promesa = (async () => {
      try {
        const blob = await this.obtenerContenidoBlob(clienteId, sesionId, fotoId, 'miniatura');
        const objectUrl = URL.createObjectURL(blob);
        this.miniaturasCache.set(fotoId, objectUrl);
        return objectUrl;
      } finally {
        this.promesasMiniaturas.delete(fotoId);
      }
    })();

    this.promesasMiniaturas.set(fotoId, promesa);
    return promesa;
  }

  obtenerUrlMiniaturaSincrona(fotoId: string): string | null {
    return this.miniaturasCache.get(fotoId) || null;
  }

  revocarMiniatura(fotoId: string): void {
    const url = this.miniaturasCache.get(fotoId);
    if (url) {
      URL.revokeObjectURL(url);
      this.miniaturasCache.delete(fotoId);
    }
    this.promesasMiniaturas.delete(fotoId);
  }

  revocarTodasMiniaturas(): void {
    for (const url of this.miniaturasCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignorar si ya fue revocada
      }
    }
    this.miniaturasCache.clear();
    this.promesasMiniaturas.clear();
  }

  private async ejecutarConFallback<T>(
    peticionPrincipal: () => Observable<T>,
    peticionSecundaria: () => Observable<T>
  ): Promise<T> {
    try {
      return await firstValueFrom(peticionPrincipal());
    } catch (error) {
      if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 405)) {
        return await firstValueFrom(peticionSecundaria());
      }
      throw error;
    }
  }
}
