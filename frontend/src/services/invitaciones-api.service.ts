import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Observable, timeout } from 'rxjs';
import { obtenerBaseApi } from '../auth/api.config';
import {
  ConsultaInvitacionPublica, DatosAceptarInvitacion, InvitacionCliente, RespuestaAceptarInvitacion,
  RespuestaInvitacionEmitida, RespuestaRevocacionInvitacion, RolInvitacion
} from '../models/invitacion.model';

export const TIEMPO_MAXIMO_INVITACION_MS = 15_000;

export function limitarEsperaInvitacion<T>(respuesta: Observable<T>, milisegundos = TIEMPO_MAXIMO_INVITACION_MS): Observable<T> {
  return respuesta.pipe(timeout({ first: milisegundos }));
}

@Injectable({ providedIn: 'root' })
export class InvitacionesApiService {
  private get base(): string { return obtenerBaseApi(); }

  constructor(private http: HttpClient) {}

  private resolver<T>(respuesta: Observable<T>): Promise<T> {
    return firstValueFrom(limitarEsperaInvitacion(respuesta));
  }

  listar(clienteId: string): Promise<InvitacionCliente[]> {
    return this.resolver(this.http.get<InvitacionCliente[]>(`${this.base}/clientes/${encodeURIComponent(clienteId)}/invitaciones`));
  }

  crear(clienteId: string, datos: { correo: string; rol: RolInvitacion }): Promise<RespuestaInvitacionEmitida> {
    return this.resolver(this.http.post<RespuestaInvitacionEmitida>(`${this.base}/clientes/${encodeURIComponent(clienteId)}/invitaciones`, datos));
  }

  reenviar(clienteId: string, invitacionId: string): Promise<RespuestaInvitacionEmitida> {
    return this.resolver(this.http.post<RespuestaInvitacionEmitida>(`${this.base}/clientes/${encodeURIComponent(clienteId)}/invitaciones/${encodeURIComponent(invitacionId)}/reenviar`, {}));
  }

  revocar(clienteId: string, invitacionId: string): Promise<RespuestaRevocacionInvitacion> {
    return this.resolver(this.http.post<RespuestaRevocacionInvitacion>(`${this.base}/clientes/${encodeURIComponent(clienteId)}/invitaciones/${encodeURIComponent(invitacionId)}/revocar`, {}));
  }

  consultarPublica(token: string): Promise<ConsultaInvitacionPublica> {
    return this.resolver(this.http.get<ConsultaInvitacionPublica>(`${this.base}/invitaciones/${encodeURIComponent(token)}`));
  }

  aceptar(token: string, datos: DatosAceptarInvitacion): Promise<RespuestaAceptarInvitacion> {
    return this.resolver(this.http.post<RespuestaAceptarInvitacion>(`${this.base}/invitaciones/${encodeURIComponent(token)}/aceptar`, datos));
  }
}
