import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  Cliente,
  Proyecto,
  Tarea,
  Factura,
  ConfiguracionEstudio,
  Notificacion
} from '../models/equinox.model';

@Injectable({
  providedIn: 'root'
})
export class EquinoxService {
  private clientesSubject = new BehaviorSubject<Cliente[]>([]);
  private proyectosSubject = new BehaviorSubject<Proyecto[]>([]);
  private configuracionSubject = new BehaviorSubject<ConfiguracionEstudio>(this.configuracionVacia());
  private configuracionVacia(): ConfiguracionEstudio { return {
    nombreEstudio: '',
    nombreFreelancer: '',
    correo: '',
    telefono: '',
    ruc: '',
    moneda: 'PAB',
    colorPrimario: '#2563eb',
    colorSecundario: '#0f172a',
    tipografia: 'Inter',
    mensajeBienvenida: ''
  }; }
  private notificacionesSubject = new BehaviorSubject<Notificacion[]>([]);
  private proyectoSeleccionadoSubject = new BehaviorSubject<Proyecto | null>(null);
  private toastSubject = new BehaviorSubject<string>('');

  clientes$ = this.clientesSubject.asObservable();
  proyectos$ = this.proyectosSubject.asObservable();
  configuracion$ = this.configuracionSubject.asObservable();
  notificaciones$ = this.notificacionesSubject.asObservable();
  proyectoSeleccionado$ = this.proyectoSeleccionadoSubject.asObservable();
  toast$ = this.toastSubject.asObservable();

  get clientes(): Cliente[] {
    return this.clientesSubject.getValue();
  }

  get proyectos(): Proyecto[] {
    return this.proyectosSubject.getValue();
  }

  get configuracion(): ConfiguracionEstudio {
    return this.configuracionSubject.getValue();
  }

  get notificaciones(): Notificacion[] {
    return this.notificacionesSubject.getValue();
  }

  get proyectoSeleccionado(): Proyecto | null {
    return this.proyectoSeleccionadoSubject.getValue();
  }

  seleccionarProyecto(p: Proyecto | null) {
    this.proyectoSeleccionadoSubject.next(p);
  }

  seleccionarProyectoPorId(id: string) {
    const p = this.proyectos.find((item) => item.id === id || item.key === id);
    this.seleccionarProyecto(p || null);
  }

  actualizarConfiguracion(datos: Partial<ConfiguracionEstudio>) {
    const actualizada = { ...this.configuracion, ...datos };
    this.configuracionSubject.next(actualizada);
  }

  limpiarConfiguracionSesion(): void {
    this.configuracionSubject.next(this.configuracionVacia());
  }

  marcarNotificacionesLeidas() {
    const notifs = this.notificaciones.map((n) => ({ ...n, leida: true }));
    this.notificacionesSubject.next(notifs);
  }

  mostrarToast(mensaje: string) {
    this.toastSubject.next(mensaje);
    setTimeout(() => {
      if (this.toastSubject.getValue() === mensaje) {
        this.toastSubject.next('');
      }
    }, 3000);
  }

  todasLasFacturas(): Factura[] {
    return [];
  }

  todasLasTareas(): Tarea[] {
    return [];
  }
}
