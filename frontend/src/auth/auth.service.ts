import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from './api.config';
import { RespuestaInicio, RespuestaRegistro, SeleccionContexto, SesionContexto, UsuarioSesion } from './auth.model';

interface SesionActual { usuario: UsuarioSesion; contexto: SesionContexto }
const TOKEN_KEY = 'equinox_sesion_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sesionSubject = new BehaviorSubject<SesionActual | null>(null);
  readonly sesion$ = this.sesionSubject.asObservable();
  private restauracion?: Promise<boolean>;

  constructor(private http: HttpClient, private router: Router) {}

  get sesion(): SesionActual | null { return this.sesionSubject.value; }
  get token(): string | null { return sessionStorage.getItem(TOKEN_KEY); }

  async restaurar(): Promise<boolean> {
    if (this.sesion) return true;
    if (!this.token) return false;
    if (!this.restauracion) {
      this.restauracion = this.validarSesion().finally(() => { this.restauracion = undefined; });
    }
    return this.restauracion;
  }

  private async validarSesion(): Promise<boolean> {
    try {
      const respuesta = await firstValueFrom(this.http.get<{ usuario: UsuarioSesion | null; sesion: SesionContexto }>(`${obtenerBaseApi()}/autenticacion/yo`));
      if (!respuesta.usuario || !this.contextoValido(respuesta.sesion)) {
        this.limpiar();
        return false;
      }
      this.sesionSubject.next({ usuario: respuesta.usuario, contexto: respuesta.sesion });
      return true;
    } catch (error: any) {
      if (error?.status === 401) this.limpiar();
      throw error;
    }
  }

  async iniciar(correo: string, contrasena: string, seleccion?: SeleccionContexto): Promise<void> {
    const respuesta = await firstValueFrom(this.http.post<RespuestaInicio>(`${obtenerBaseApi()}/autenticacion/inicio-sesion`, { correo, contrasena, ...(seleccion ? { seleccion } : {}) }));
    await this.aceptarToken(respuesta.token);
  }

  async registrar(datos: { correo: string; contrasena: string; nombre: string; apellido?: string; nombreEstudio: string; slug: string }): Promise<void> {
    const respuesta = await firstValueFrom(this.http.post<RespuestaRegistro>(`${obtenerBaseApi()}/autenticacion/registro`, datos));
    await this.aceptarToken(respuesta.token);
  }

  private async aceptarToken(token: string): Promise<void> {
    sessionStorage.setItem(TOKEN_KEY, token);
    try {
      if (!await this.restaurar()) throw new Error('La sesión no pudo validarse');
    } catch (error) {
      this.limpiar();
      throw error;
    }
  }

  private contextoValido(contexto: SesionContexto): boolean {
    return contexto?.tipoAcceso === 'ORGANIZACION'
      ? ['PROPIETARIO', 'COLABORADOR'].includes(contexto.rolOrganizacion)
      : contexto?.tipoAcceso === 'CLIENTE' && ['TITULAR', 'COLABORADOR'].includes(contexto.rolCliente);
  }

  rutaInicial(): string {
    return this.sesion?.contexto.tipoAcceso === 'CLIENTE' ? '/portal' : '/dashboard';
  }

  async cerrar(): Promise<void> {
    if (this.token) await firstValueFrom(this.http.post(`${obtenerBaseApi()}/autenticacion/cerrar-sesion`, {}));
    await this.cerrarSoloLocal();
  }

  async cerrarSoloLocal(): Promise<void> {
    this.limpiar();
    await this.router.navigateByUrl('/inicio-sesion');
  }

  limpiarPor401(tokenEnviado: string): void {
    if (this.token !== tokenEnviado) return;
    this.limpiar();
    if (!['/inicio-sesion', '/registro', '/recuperar-contrasena'].some((ruta) => this.router.url.startsWith(ruta))) {
      void this.router.navigateByUrl('/inicio-sesion');
    }
  }

  private limpiar(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    this.sesionSubject.next(null);
  }
}
