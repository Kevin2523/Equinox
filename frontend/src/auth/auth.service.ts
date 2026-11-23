import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { obtenerBaseApi } from './api.config';
import {
  RespuestaInicio,
  RespuestaInicioConfiguracionMfa,
  RespuestaRegistro,
  RespuestaVerificacionMfa,
  SeleccionContexto,
  SesionContexto,
  TipoFreelance,
  UsuarioSesion
} from './auth.model';
import { OrganizacionService } from './organizacion.service';

interface SesionActual { usuario: UsuarioSesion; contexto: SesionContexto }
const TOKEN_KEY = 'equinox_sesion_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sesionSubject = new BehaviorSubject<SesionActual | null>(null);
  readonly sesion$ = this.sesionSubject.asObservable();
  private restauracion?: Promise<boolean>;
  private orgService = inject(OrganizacionService);

  constructor(private http: HttpClient, private router: Router) {}

  get sesion(): SesionActual | null { return this.sesionSubject.value; }
  get token(): string | null { return sessionStorage.getItem(TOKEN_KEY); }
  get esAdminGlobal(): boolean {
    const sesion = this.sesionSubject.value;
    return sesion?.contexto.tipoAcceso === 'ADMIN_GLOBAL'
      && sesion.contexto.rolPlataforma === 'ADMIN_GLOBAL'
      && sesion.contexto.mfaVerificado !== false;
  }

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
      if (respuesta.sesion.tipoAcceso === 'ORGANIZACION') {
        try {
          await this.orgService.cargarOrganizacion();
        } catch {
          // Si falla cargar organización, se mantiene el contexto base
        }
      }
      return true;
    } catch (error: any) {
      if (error?.status === 401) this.limpiar();
      throw error;
    }
  }

  async iniciar(correo: string, contrasena: string, seleccion?: SeleccionContexto): Promise<void> {
    const respuesta = await firstValueFrom(this.http.post<RespuestaInicio>(`${obtenerBaseApi()}/autenticacion/inicio-sesion`, { correo, contrasena, ...(seleccion ? { seleccion } : {}) }));
    if (respuesta.mfaRequerido || !respuesta.token) {
      throw { status: 403, error: { error: 'El acceso de administrador global debe completarse mediante verificación MFA en /admin/acceso.' } };
    }
    await this.aceptarToken(respuesta.token);
    if (this.sesion?.contexto.tipoAcceso === 'ORGANIZACION') {
      await this.orgService.cargarOrganizacion();
    }
  }

  async iniciarAdmin(correo: string, contrasena: string): Promise<RespuestaInicio> {
    return await firstValueFrom(
      this.http.post<RespuestaInicio>(`${obtenerBaseApi()}/autenticacion/inicio-sesion`, {
        correo,
        contrasena,
        seleccion: { tipoAcceso: 'ADMIN_GLOBAL' }
      })
    );
  }

  async iniciarConfiguracionMfa(tokenDesafioMfa: string): Promise<RespuestaInicioConfiguracionMfa> {
    return await firstValueFrom(
      this.http.post<RespuestaInicioConfiguracionMfa>(
        `${obtenerBaseApi()}/autenticacion/admin/mfa/iniciar-configuracion`,
        { tokenDesafioMfa }
      )
    );
  }

  async confirmarConfiguracionMfa(tokenDesafioMfa: string, codigoTotp: string): Promise<RespuestaVerificacionMfa> {
    const respuesta = await firstValueFrom(
      this.http.post<RespuestaVerificacionMfa>(
        `${obtenerBaseApi()}/autenticacion/admin/mfa/confirmar-configuracion`,
        { tokenDesafioMfa, codigoTotp }
      )
    );
    await this.aceptarToken(respuesta.token);
    return respuesta;
  }

  async verificarMfa(
    tokenDesafioMfa: string,
    payload: { codigoTotp?: string; codigoRecuperacion?: string }
  ): Promise<RespuestaVerificacionMfa> {
    const respuesta = await firstValueFrom(
      this.http.post<RespuestaVerificacionMfa>(
        `${obtenerBaseApi()}/autenticacion/admin/mfa/verificar`,
        { tokenDesafioMfa, ...payload }
      )
    );
    await this.aceptarToken(respuesta.token);
    return respuesta;
  }

  async solicitarRecuperacionMfa(correo: string): Promise<{ mensaje?: string }> {
    return await firstValueFrom(
      this.http.post<{ mensaje?: string }>(
        `${obtenerBaseApi()}/autenticacion/admin/mfa/solicitar-recuperacion`,
        { correo }
      )
    );
  }

  async restablecerMfa(token: string, contrasena: string): Promise<{ mensaje?: string }> {
    return await firstValueFrom(
      this.http.post<{ mensaje?: string }>(
        `${obtenerBaseApi()}/autenticacion/admin/mfa/restablecer`,
        { token, contrasena }
      )
    );
  }

  async registrar(datos: { correo: string; contrasena: string; nombre: string; apellido?: string; nombreEstudio: string; slug: string; tipoFreelance?: TipoFreelance }): Promise<void> {
    const respuesta = await firstValueFrom(this.http.post<RespuestaRegistro>(`${obtenerBaseApi()}/autenticacion/registro`, datos));
    await this.aceptarToken(respuesta.token);
    if (this.sesion?.contexto.tipoAcceso === 'ORGANIZACION') {
      await this.orgService.cargarOrganizacion();
    }
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
    if (contexto?.tipoAcceso === 'ADMIN_GLOBAL') {
      return contexto.rolPlataforma === 'ADMIN_GLOBAL' && contexto.mfaVerificado !== false;
    }
    return contexto?.tipoAcceso === 'ORGANIZACION'
      ? ['PROPIETARIO', 'COLABORADOR'].includes(contexto.rolOrganizacion)
      : contexto?.tipoAcceso === 'CLIENTE' && ['TITULAR', 'COLABORADOR'].includes(contexto.rolCliente);
  }

  rutaInicial(): string {
    if (this.sesion?.contexto.tipoAcceso === 'ADMIN_GLOBAL') return '/admin';
    if (this.sesion?.contexto.tipoAcceso === 'CLIENTE') return '/portal';
    if (this.orgService.tipoFreelance === 'FOTOGRAFIA') return '/clientes';
    return '/dashboard';
  }

  async cerrar(rutaDestino = '/inicio-sesion'): Promise<void> {
    if (this.token) await firstValueFrom(this.http.post(`${obtenerBaseApi()}/autenticacion/cerrar-sesion`, {}));
    await this.cerrarSoloLocal(rutaDestino);
  }

  async cerrarSoloLocal(rutaDestino = '/inicio-sesion'): Promise<void> {
    this.limpiar();
    await this.router.navigateByUrl(rutaDestino);
  }

  limpiarPor401(tokenEnviado: string): void {
    if (this.token !== tokenEnviado) return;
    const estabaEnAdmin = this.router.url.startsWith('/admin');
    this.limpiar();
    if (estabaEnAdmin) {
      if (!this.router.url.startsWith('/admin/acceso')) {
        void this.router.navigate(['/admin/acceso'], { queryParams: { motivo: 'sesion-vencida' } });
      }
      return;
    }
    if (!['/inicio-sesion', '/registro', '/recuperar-contrasena'].some((ruta) => this.router.url.startsWith(ruta))) {
      void this.router.navigateByUrl('/inicio-sesion');
    }
  }

  private limpiar(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    this.sesionSubject.next(null);
    this.orgService.limpiar();
  }
}
