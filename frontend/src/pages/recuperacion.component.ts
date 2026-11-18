import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_ORIGIN, obtenerBaseApi } from '../auth/api.config';

export type FaseRecuperacion = 'solicitud' | 'validando' | 'restablecer' | 'invalido' | 'exito';

@Component({
  selector: 'app-recuperacion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recuperacion.component.html',
  styleUrls: ['./recuperacion.component.css']
})
export class RecuperacionComponent implements OnInit {
  readonly apiDisponible = !!API_ORIGIN;

  fase: FaseRecuperacion = 'solicitud';
  token: string = '';

  // Formulario de solicitud
  correo: string = '';
  solicitudEnviada: boolean = false;
  mensajeUniforme: string = '';

  // Formulario de restablecimiento
  nuevaContrasena: string = '';
  confirmarContrasena: string = '';
  mostrarNueva: boolean = false;
  mostrarConfirmacion: boolean = false;
  restablecerEnviado: boolean = false;

  cargando: boolean = false;
  error: string = '';
  mensajeInvalido: string = '';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Detectar token por query param (?token=...) o param de ruta (:token)
    const tokenQuery = this.route.snapshot.queryParamMap.get('token');
    const tokenParam = this.route.snapshot.paramMap.get('token');
    const tokenDetectado = (tokenQuery || tokenParam || '').trim();

    if (tokenDetectado) {
      this.token = tokenDetectado;
      this.validarToken(tokenDetectado);
    } else {
      this.fase = 'solicitud';
    }
  }

  alternarMostrarNueva(): void {
    this.mostrarNueva = !this.mostrarNueva;
  }

  alternarMostrarConfirmacion(): void {
    this.mostrarConfirmacion = !this.mostrarConfirmacion;
  }

  async solicitarEnlace(form: NgForm): Promise<void> {
    this.solicitudEnviada = true;
    this.error = '';

    if (form.invalid || this.cargando) return;

    this.cargando = true;
    try {
      const baseApi = obtenerBaseApi();
      const res = await firstValueFrom(
        this.http.post<{ mensaje: string }>(
          `${baseApi}/autenticacion/solicitar-recuperacion`,
          { correo: this.correo.trim().toLowerCase() }
        )
      );

      this.mensajeUniforme = res.mensaje ||
        'Si el correo está registrado en Equinox, recibirás las instrucciones para restablecer tu contraseña en los próximos minutos.';
      this.fase = 'exito';
    } catch (err: any) {
      if (err?.status === 503) {
        this.error =
          'El servicio de recuperación por correo no está configurado o no se encuentra disponible. Contacta al administrador.';
      } else if (err?.status === 429) {
        this.error =
          err?.error?.error || 'Demasiadas solicitudes. Por favor espera unos minutos antes de volver a intentar.';
      } else if (err?.status === 400) {
        this.error = 'Introduce un correo electrónico válido.';
      } else {
        this.error = API_ORIGIN
          ? 'No se pudo procesar la solicitud. Comprueba tu conexión e inténtalo de nuevo.'
          : 'La API de este entorno no está configurada. Contacta al administrador de Equinox.';
      }
    } finally {
      this.cargando = false;
    }
  }

  private async validarToken(token: string): Promise<void> {
    this.fase = 'validando';
    this.cargando = true;
    this.error = '';

    try {
      const baseApi = obtenerBaseApi();
      await firstValueFrom(
        this.http.get<{ valido: boolean }>(
          `${baseApi}/autenticacion/validar-token-recuperacion`,
          { params: { token } }
        )
      );
      this.fase = 'restablecer';
    } catch (err: any) {
      this.fase = 'invalido';
      if (err?.status === 410) {
        this.mensajeInvalido = err?.error?.error || 'Este enlace de recuperación ha expirado o ya fue utilizado.';
      } else if (err?.status === 404) {
        this.mensajeInvalido = 'El enlace de recuperación no es válido o no existe.';
      } else {
        this.mensajeInvalido = 'No se pudo verificar el enlace de recuperación. Inténtalo de nuevo más tarde.';
      }
    } finally {
      this.cargando = false;
    }
  }

  async restablecer(form: NgForm): Promise<void> {
    this.restablecerEnviado = true;
    this.error = '';

    if (form.invalid || this.cargando) return;
    if (this.nuevaContrasena !== this.confirmarContrasena) {
      this.error = 'Las contraseñas no coinciden.';
      return;
    }

    this.cargando = true;
    try {
      const baseApi = obtenerBaseApi();
      await firstValueFrom(
        this.http.post<{ mensaje: string }>(
          `${baseApi}/autenticacion/restablecer-contrasena`,
          {
            token: this.token,
            contrasena: this.nuevaContrasena,
          }
        )
      );

      this.fase = 'exito';
      this.mensajeUniforme =
        '¡Tu contraseña ha sido restablecida con éxito! Todas tus sesiones previas han sido cerradas por seguridad.';
    } catch (err: any) {
      if (err?.status === 410 || err?.status === 404) {
        this.fase = 'invalido';
        this.mensajeInvalido = err?.error?.error || 'Este enlace de recuperación ya no es válido o ha expirado.';
      } else if (err?.status === 429) {
        this.error = err?.error?.error || 'Demasiados intentos. Por favor espera unos minutos.';
      } else {
        this.error = err?.error?.error || 'Ocurrió un error al restablecer tu contraseña. Inténtalo de nuevo.';
      }
    } finally {
      this.cargando = false;
    }
  }

  reiniciarFlujo(): void {
    this.fase = 'solicitud';
    this.token = '';
    this.correo = '';
    this.nuevaContrasena = '';
    this.confirmarContrasena = '';
    this.solicitudEnviada = false;
    this.restablecerEnviado = false;
    this.error = '';
    this.mensajeInvalido = '';
    this.router.navigate(['/recuperar-contrasena'], { queryParams: {} });
  }
}
