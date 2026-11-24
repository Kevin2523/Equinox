import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_ORIGIN, obtenerBaseApi } from '../auth/api.config';
import { I18nService } from '../state/i18n.service';
import { TPipe } from '../shared/t.pipe';

export type FaseRecuperacion = 'solicitud' | 'validando' | 'restablecer' | 'invalido' | 'exito';

@Component({
  selector: 'app-recuperacion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TPipe],
  templateUrl: './recuperacion.component.html',
  styleUrls: ['./recuperacion.component.css']
})
export class RecuperacionComponent implements OnInit {
  public readonly i18n = inject(I18nService);
  readonly apiDisponible = !!API_ORIGIN;

  fase: FaseRecuperacion = 'solicitud';
  token: string = '';

  // Formulario de solicitud
  correo: string = '';
  solicitudEnviada: boolean = false;
  private mensajeUniformeKey: string = '';
  private mensajeUniformeRaw: string = '';

  // Formulario de restablecimiento
  nuevaContrasena: string = '';
  confirmarContrasena: string = '';
  mostrarNueva: boolean = false;
  mostrarConfirmacion: boolean = false;
  restablecerEnviado: boolean = false;

  cargando: boolean = false;
  private errorKey: string = '';
  private errorRaw: string = '';
  private mensajeInvalidoKey: string = '';
  private mensajeInvalidoRaw: string = '';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  get error(): string {
    if (this.errorRaw) return this.errorRaw;
    return this.errorKey ? this.i18n.t(this.errorKey) : '';
  }

  get mensajeUniforme(): string {
    if (this.mensajeUniformeRaw) return this.mensajeUniformeRaw;
    return this.mensajeUniformeKey ? this.i18n.t(this.mensajeUniformeKey) : '';
  }

  get mensajeInvalido(): string {
    if (this.mensajeInvalidoRaw) return this.mensajeInvalidoRaw;
    return this.mensajeInvalidoKey ? this.i18n.t(this.mensajeInvalidoKey) : '';
  }

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
    this.errorKey = '';
    this.errorRaw = '';

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

      if (res.mensaje) {
        this.mensajeUniformeRaw = res.mensaje;
        this.mensajeUniformeKey = '';
      } else {
        this.mensajeUniformeRaw = '';
        this.mensajeUniformeKey = 'publico.recuperacion.mensajeUniformeSolicitud';
      }
      this.fase = 'exito';
    } catch (err: any) {
      if (err?.status === 503) {
        this.errorKey = 'publico.recuperacion.errorServicioCorreo';
      } else if (err?.status === 429) {
        if (err?.error?.error) {
          this.errorRaw = err.error.error;
        } else {
          this.errorKey = 'publico.recuperacion.errorDemasiadasSolicitudes';
        }
      } else if (err?.status === 400) {
        this.errorKey = 'publico.comun.correoInvalido';
      } else {
        this.errorKey = API_ORIGIN
          ? 'publico.recuperacion.errorSolicitud'
          : 'publico.comun.apiNoConfiguradaDetalle';
      }
    } finally {
      this.cargando = false;
    }
  }

  private async validarToken(token: string): Promise<void> {
    this.fase = 'validando';
    this.cargando = true;
    this.errorKey = '';
    this.errorRaw = '';

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
      this.mensajeInvalidoKey = '';
      this.mensajeInvalidoRaw = '';
      if (err?.status === 410) {
        if (err?.error?.error) {
          this.mensajeInvalidoRaw = err.error.error;
        } else {
          this.mensajeInvalidoKey = 'publico.recuperacion.errorEnlaceExpirado';
        }
      } else if (err?.status === 404) {
        this.mensajeInvalidoKey = 'publico.recuperacion.errorEnlaceInvalido';
      } else {
        this.mensajeInvalidoKey = 'publico.recuperacion.errorVerificarEnlace';
      }
    } finally {
      this.cargando = false;
    }
  }

  async restablecer(form: NgForm): Promise<void> {
    this.restablecerEnviado = true;
    this.errorKey = '';
    this.errorRaw = '';

    if (form.invalid || this.cargando) return;
    if (this.nuevaContrasena !== this.confirmarContrasena) {
      this.errorKey = 'publico.recuperacion.noCoinciden';
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
      this.mensajeUniformeRaw = '';
      this.mensajeUniformeKey = 'publico.recuperacion.mensajeUniformeRestablecida';
    } catch (err: any) {
      if (err?.status === 410 || err?.status === 404) {
        this.fase = 'invalido';
        if (err?.error?.error) {
          this.mensajeInvalidoRaw = err.error.error;
          this.mensajeInvalidoKey = '';
        } else {
          this.mensajeInvalidoRaw = '';
          this.mensajeInvalidoKey = 'publico.recuperacion.errorEnlaceYaNoValido';
        }
      } else if (err?.status === 429) {
        if (err?.error?.error) {
          this.errorRaw = err.error.error;
        } else {
          this.errorKey = 'publico.recuperacion.errorDemasiadosIntentos';
        }
      } else {
        if (err?.error?.error) {
          this.errorRaw = err.error.error;
        } else {
          this.errorKey = 'publico.recuperacion.errorRestablecer';
        }
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
    this.errorKey = '';
    this.errorRaw = '';
    this.mensajeInvalidoKey = '';
    this.mensajeInvalidoRaw = '';
    this.mensajeUniformeKey = '';
    this.mensajeUniformeRaw = '';
    this.router.navigate(['/recuperar-contrasena'], { queryParams: {} });
  }
}
