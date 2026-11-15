import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import { AuthService } from '../auth/auth.service';

export type EstadoTareaApi = 'PENDIENTE' | 'EN_PROGRESO' | 'BLOQUEADA' | 'COMPLETADA' | 'CANCELADA';
export type PrioridadTareaApi = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';
export type EstadoHitoApi = 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADO' | 'VENCIDO';

export interface TareaApi {
  id: string; proyectoId: string; hitoId: string | null; asignadoAId: string | null;
  titulo: string; descripcion: string | null; estado: EstadoTareaApi; prioridad: PrioridadTareaApi;
  orden: number; fechaVencimiento: string | null; completadaEn: string | null;
  creadoEn: string; actualizadoEn: string;
}
export interface HitoApi {
  id: string; proyectoId: string; titulo: string; descripcion: string | null;
  estado: EstadoHitoApi; orden: number; fechaObjetivo: string | null;
  completadoEn: string | null; visibleEnPortal: boolean; creadoEn: string; actualizadoEn: string;
}
export interface ComentarioApi {
  id: string; autor: 'FREELANCER' | 'CLIENTE'; contenido: string; creadoEn: string;
  usuario: { nombre: string; apellido: string | null } | null;
}

// Regla del CRM: tareas completadas / tareas no canceladas; sin tareas => progreso indefinido.
export function progresoTareas(tareas: TareaApi[]): number | null {
  const vigentes = tareas.filter((tarea) => tarea.estado !== 'CANCELADA');
  if (!vigentes.length) return null;
  return Math.round(vigentes.filter((tarea) => tarea.estado === 'COMPLETADA').length / vigentes.length * 100);
}

@Injectable({ providedIn: 'root' })
export class TrabajoApiService {
  private readonly cambiosSubject = new Subject<void>();
  readonly cambios$ = this.cambiosSubject.asObservable();
  tareasActuales: TareaApi[] = [];
  tareasCargadas = false;
  constructor(private http: HttpClient, private auth: AuthService) {
    this.auth.sesion$.subscribe(() => { this.tareasActuales = []; this.tareasCargadas = false; });
  }
  registrarTareas(tareas: TareaApi[]): void { this.tareasActuales = tareas; this.tareasCargadas = true; }

  private ruta(proyectoId: string, recurso: 'tareas' | 'hitos' | 'comentarios'): string {
    return `${obtenerBaseApi()}/proyectos/${encodeURIComponent(proyectoId)}/${recurso}`;
  }
  listarTareas(proyectoId: string): Promise<TareaApi[]> {
    return firstValueFrom(this.http.get<TareaApi[]>(this.ruta(proyectoId, 'tareas')));
  }
  async crearTarea(proyectoId: string, datos: { titulo: string; prioridad?: PrioridadTareaApi; fechaVencimiento?: string | null; descripcion?: string | null }): Promise<TareaApi> {
    const token = this.auth.token;
    const tarea = await firstValueFrom(this.http.post<TareaApi>(this.ruta(proyectoId, 'tareas'), datos));
    if (token === this.auth.token) {
      if (this.tareasCargadas) this.tareasActuales = [...this.tareasActuales, tarea];
      this.cambiosSubject.next();
    }
    return tarea;
  }
  async editarTarea(proyectoId: string, id: string, datos: Partial<Pick<TareaApi, 'titulo' | 'descripcion' | 'estado' | 'prioridad' | 'fechaVencimiento' | 'hitoId' | 'asignadoAId'>>): Promise<TareaApi> {
    const token = this.auth.token;
    const tarea = await firstValueFrom(this.http.patch<TareaApi>(`${this.ruta(proyectoId, 'tareas')}/${encodeURIComponent(id)}`, datos));
    if (token === this.auth.token) {
      if (this.tareasCargadas) this.tareasActuales = this.tareasActuales.map((item) => item.id === id ? tarea : item);
      this.cambiosSubject.next();
    }
    return tarea;
  }
  async eliminarTarea(proyectoId: string, id: string): Promise<void> {
    const token = this.auth.token;
    await firstValueFrom(this.http.delete<void>(`${this.ruta(proyectoId, 'tareas')}/${encodeURIComponent(id)}`));
    if (token === this.auth.token) {
      if (this.tareasCargadas) this.tareasActuales = this.tareasActuales.filter((item) => item.id !== id);
      this.cambiosSubject.next();
    }
  }
  listarHitos(proyectoId: string): Promise<HitoApi[]> {
    return firstValueFrom(this.http.get<HitoApi[]>(this.ruta(proyectoId, 'hitos')));
  }
  crearHito(proyectoId: string, datos: { titulo: string; descripcion?: string | null; fechaObjetivo?: string | null; visibleEnPortal?: boolean }): Promise<HitoApi> {
    return firstValueFrom(this.http.post<HitoApi>(this.ruta(proyectoId, 'hitos'), datos));
  }
  editarHito(proyectoId: string, id: string, datos: Partial<Pick<HitoApi, 'titulo' | 'descripcion' | 'estado' | 'orden' | 'fechaObjetivo' | 'visibleEnPortal'>>): Promise<HitoApi> {
    return firstValueFrom(this.http.patch<HitoApi>(`${this.ruta(proyectoId, 'hitos')}/${encodeURIComponent(id)}`, datos));
  }
  eliminarHito(proyectoId: string, id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.ruta(proyectoId, 'hitos')}/${encodeURIComponent(id)}`));
  }
  listarComentarios(proyectoId: string): Promise<ComentarioApi[]> {
    return firstValueFrom(this.http.get<ComentarioApi[]>(this.ruta(proyectoId, 'comentarios')));
  }
  comentar(proyectoId: string, contenido: string): Promise<ComentarioApi> {
    return firstValueFrom(this.http.post<ComentarioApi>(this.ruta(proyectoId, 'comentarios'), { contenido }));
  }
}
