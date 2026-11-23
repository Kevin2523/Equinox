import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from './api.config';
import { TipoFreelance } from './auth.model';

export interface OrganizacionData {
  id: string;
  nombre: string;
  slug: string;
  tipoFreelance: TipoFreelance;
  descripcion?: string | null;
  moneda?: string;
  ruc?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  correoContacto?: string | null;
  colorPrimario?: string | null;
  colorSecundario?: string | null;
  tipografia?: string;
  portalMensajeBienvenida?: string | null;
  dominioPortal?: string | null;
  portalMostrarFinanzas?: boolean;
  miembros?: Array<{
    id: string;
    rol: string;
    usuarioId: string;
    usuario?: {
      id: string;
      nombre: string;
      apellido?: string | null;
      correo: string;
      avatarUrl?: string | null;
    };
  }>;
}

export interface VistaPreviaOrganizacion {
  modalidad: TipoFreelance;
  clienteNombre?: string | null;
  sesion: {
    id: string;
    nombre: string;
    descripcion?: string | null;
    lugar?: string | null;
    estado: 'BORRADOR' | 'PUBLICADA';
    fecha: string | null;
    totalFotos: number;
  } | null;
  proyecto: {
    id: string;
    nombre: string;
    descripcion?: string | null;
    estado: string;
    fechaInicio?: string | null;
    fechaEntrega: string | null;
    totalHitos: number;
    hitosCompletados: number;
    totalArchivos?: number;
    totalComentarios?: number;
  } | null;
  facturas?: Array<{
    id: string;
    numero: string;
    concepto: string;
    monto: string | number;
    moneda: string;
    estado: 'ENVIADA' | 'PAGADA' | 'VENCIDA';
    fechaEmision: string;
    fechaVencimiento: string | null;
  }>;
}

@Injectable({ providedIn: 'root' })
export class OrganizacionService {
  private http = inject(HttpClient);
  private organizacionSubject = new BehaviorSubject<OrganizacionData | null>(null);
  readonly organizacion$ = this.organizacionSubject.asObservable();

  private tipoFreelanceSubject = new BehaviorSubject<TipoFreelance>('GENERAL');
  readonly tipoFreelance$ = this.tipoFreelanceSubject.asObservable();

  private cargaEnCurso?: Promise<OrganizacionData | null>;

  get organizacion(): OrganizacionData | null {
    return this.organizacionSubject.value;
  }

  get tipoFreelance(): TipoFreelance {
    return this.tipoFreelanceSubject.value;
  }

  get esFotografia(): boolean {
    return this.tipoFreelance === 'FOTOGRAFIA';
  }

  async asegurarCargado(): Promise<OrganizacionData | null> {
    if (this.organizacion) return this.organizacion;
    return this.cargarOrganizacion();
  }

  async cargarOrganizacion(): Promise<OrganizacionData | null> {
    if (this.cargaEnCurso) return this.cargaEnCurso;

    this.cargaEnCurso = (async () => {
      try {
        const org = await firstValueFrom(
          this.http.get<OrganizacionData>(`${obtenerBaseApi()}/organizacion`)
        );
        if (org) {
          const tipo = org.tipoFreelance || 'GENERAL';
          const orgCompleta = { ...org, tipoFreelance: tipo };
          this.organizacionSubject.next(orgCompleta);
          this.tipoFreelanceSubject.next(tipo);
          return orgCompleta;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.cargaEnCurso = undefined;
      }
    })();

    return this.cargaEnCurso;
  }

  async actualizarTipoFreelance(tipo: TipoFreelance): Promise<OrganizacionData> {
    const actualizada = await firstValueFrom(
      this.http.patch<OrganizacionData>(`${obtenerBaseApi()}/organizacion`, {
        tipoFreelance: tipo,
      })
    );
    const orgActual = this.organizacionSubject.value;
    const orgNueva: OrganizacionData = {
      ...(orgActual || ({} as OrganizacionData)),
      ...actualizada,
      tipoFreelance: tipo,
    };
    this.organizacionSubject.next(orgNueva);
    this.tipoFreelanceSubject.next(tipo);
    return orgNueva;
  }

  async actualizarPortalMostrarFinanzas(mostrar: boolean): Promise<OrganizacionData> {
    const actualizada = await firstValueFrom(
      this.http.patch<OrganizacionData>(`${obtenerBaseApi()}/organizacion`, {
        portalMostrarFinanzas: mostrar,
      })
    );
    const orgActual = this.organizacionSubject.value;
    const orgNueva: OrganizacionData = {
      ...(orgActual || ({} as OrganizacionData)),
      ...actualizada,
      portalMostrarFinanzas: mostrar,
    };
    this.organizacionSubject.next(orgNueva);
    return orgNueva;
  }

  async actualizarOrganizacion(
    datos: Partial<{
      nombre: string;
      moneda: string;
      ruc: string | null;
      direccion: string | null;
      telefono: string | null;
      correoContacto: string | null;
      colorPrimario: string;
      colorSecundario: string;
      portalMensajeBienvenida: string | null;
      portalMostrarFinanzas: boolean;
      tipoFreelance: TipoFreelance;
    }>
  ): Promise<OrganizacionData> {
    const actualizada = await firstValueFrom(
      this.http.patch<OrganizacionData>(`${obtenerBaseApi()}/organizacion`, datos)
    );
    const orgActual = this.organizacionSubject.value;
    const tipo = actualizada.tipoFreelance || orgActual?.tipoFreelance || 'GENERAL';
    const orgNueva: OrganizacionData = {
      ...(orgActual || ({} as OrganizacionData)),
      ...actualizada,
      tipoFreelance: tipo,
    };
    this.organizacionSubject.next(orgNueva);
    this.tipoFreelanceSubject.next(tipo);
    return orgNueva;
  }

  async cargarVistaPrevia(): Promise<VistaPreviaOrganizacion | null> {
    try {
      return await firstValueFrom(
        this.http.get<VistaPreviaOrganizacion>(`${obtenerBaseApi()}/organizacion/vista-previa`)
      );
    } catch {
      return null;
    }
  }

  limpiar(): void {
    this.organizacionSubject.next(null);
    this.tipoFreelanceSubject.next('GENERAL');
  }
}
