import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { AuthService } from '../../auth/auth.service';
import { RespuestaInicioConfiguracionMfa } from '../../auth/auth.model';
import { API_ORIGIN } from '../../auth/api.config';
import { IdiomaSoportado } from '../../i18n/i18n.types';
import { TPipe } from '../../shared/t.pipe';
import { I18nService } from '../../state/i18n.service';

type PasoAccesoAdmin =
  | 'CREDENCIALES'
  | 'CONFIGURAR_MFA'
  | 'CODIGOS_RECUPERACION'
  | 'VERIFICAR_MFA'
  | 'RECUPERAR_MFA';

@Component({
  selector: 'app-admin-acceso',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TPipe],
  templateUrl: './admin-acceso.component.html',
  styleUrls: ['./admin-acceso.component.css']
})
export class AdminAccesoComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly apiDisponible = !!API_ORIGIN;
  paso: PasoAccesoAdmin = 'CREDENCIALES';

  correo = '';
  contrasena = '';
  mostrarContrasena = false;
  sesionVencida = false;

  cargando = false;
  error = '';
  mensajeExito = '';

  tokenDesafioMfa = '';
  configMfa: RespuestaInicioConfiguracionMfa | null = null;
  qrDataUrl = '';
  generandoQr = false;
  errorQr = '';
  mostrarClaveManual = false;
  codigoTotp = '';
  usarCodigoRecuperacion = false;
  codigoRecuperacion = '';
  codigosRecuperacion: string[] = [];

  // Recuperación MFA
  correoRecuperacion = '';
  tokenRecuperacion = '';
  nuevaContrasena = '';

  @ViewChild('mfaSetupCodeInput') mfaSetupCodeInput?: ElementRef<HTMLInputElement>;
  @ViewChild('mfaVerifyCodeInput') mfaVerifyCodeInput?: ElementRef<HTMLInputElement>;

  constructor(
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.sesionVencida = this.route.snapshot.queryParamMap.get('motivo') === 'sesion-vencida';
    const tokenUrl = this.route.snapshot.queryParamMap.get('token');
    if (tokenUrl) {
      this.tokenRecuperacion = tokenUrl;
      this.paso = 'RECUPERAR_MFA';
    }
  }

  ngOnDestroy(): void {
    this.limpiarDatosSensibles();
  }

  cambiarIdiomaLocal(idioma: IdiomaSoportado): void {
    this.i18n.establecerIdiomaLocal(idioma);
  }

  async enviarCredenciales(): Promise<void> {
    if (this.cargando || !this.correo.trim() || !this.contrasena) return;
    this.cargando = true;
    this.error = '';
    this.mensajeExito = '';
    try {
      const res = await this.auth.iniciarAdmin(this.correo.trim(), this.contrasena);
      this.contrasena = '';

      if (res.mfaRequerido && res.tokenDesafioMfa) {
        this.tokenDesafioMfa = res.tokenDesafioMfa;
        if (res.estadoMfa === 'CONFIGURAR') {
          this.mostrarClaveManual = false;
          this.codigoTotp = '';
          this.configMfa = await this.auth.iniciarConfiguracionMfa(this.tokenDesafioMfa);
          this.paso = 'CONFIGURAR_MFA';
          await this.generarQrLocal(this.configMfa.otpauthUrl);
          setTimeout(() => this.mfaSetupCodeInput?.nativeElement?.focus(), 0);
        } else {
          this.codigoTotp = '';
          this.paso = 'VERIFICAR_MFA';
          setTimeout(() => this.mfaVerifyCodeInput?.nativeElement?.focus(), 0);
        }
        return;
      }

      this.error = this.i18n.t('admin.acceso.errorSinDesafioMfa');
    } catch (err: any) {
      this.error = this.formatearError(err, this.i18n.t('admin.acceso.errorIniciarAdmin'));
    } finally {
      this.cargando = false;
    }
  }

  toggleClaveManual(): void {
    this.mostrarClaveManual = !this.mostrarClaveManual;
  }

  alCambiarCodigoTotp(valor: string): void {
    this.codigoTotp = valor.replace(/\D/g, '').slice(0, 6);
  }

  async confirmarConfiguracionMfa(): Promise<void> {
    if (this.cargando) return;
    const codigoLimpio = this.codigoTotp.replace(/\D/g, '').trim();
    if (!/^\d{6}$/.test(codigoLimpio)) {
      this.error = this.i18n.t('admin.acceso.errorTotpInvalido');
      setTimeout(() => this.mfaSetupCodeInput?.nativeElement?.focus(), 0);
      return;
    }

    this.cargando = true;
    this.error = '';
    this.mensajeExito = '';
    try {
      const res = await this.auth.confirmarConfiguracionMfa(this.tokenDesafioMfa, codigoLimpio);
      this.limpiarDatosConfiguracionMfa();
      this.codigosRecuperacion = res.codigosRecuperacion || [];
      if (this.codigosRecuperacion.length > 0) {
        this.paso = 'CODIGOS_RECUPERACION';
      } else {
        await this.router.navigateByUrl('/admin/resumen');
      }
    } catch (err: any) {
      this.error = this.formatearError(err, this.i18n.t('admin.acceso.errorConfirmarTotp'));
      setTimeout(() => this.mfaSetupCodeInput?.nativeElement?.focus(), 0);
    } finally {
      this.cargando = false;
    }
  }

  async verificarMfa(): Promise<void> {
    if (this.cargando) return;
    const codigoTotpLimpio = this.codigoTotp.replace(/\D/g, '').trim();
    const payload = this.usarCodigoRecuperacion
      ? { codigoRecuperacion: this.codigoRecuperacion.trim() }
      : { codigoTotp: codigoTotpLimpio };

    if (this.usarCodigoRecuperacion && !payload.codigoRecuperacion) {
      this.error = this.i18n.t('admin.acceso.errorCodigoRecRequerido');
      return;
    }
    if (!this.usarCodigoRecuperacion && !/^\d{6}$/.test(codigoTotpLimpio)) {
      this.error = this.i18n.t('admin.acceso.errorTotpInvalido');
      setTimeout(() => this.mfaVerifyCodeInput?.nativeElement?.focus(), 0);
      return;
    }

    this.cargando = true;
    this.error = '';
    try {
      await this.auth.verificarMfa(this.tokenDesafioMfa, payload);
      this.limpiarDatosSensibles();
      await this.router.navigateByUrl('/admin/resumen');
    } catch (err: any) {
      this.error = this.formatearError(err, this.i18n.t('admin.acceso.errorCodigoInvalido'));
    } finally {
      this.cargando = false;
    }
  }

  async solicitarRecuperacion(): Promise<void> {
    if (this.cargando || !this.correoRecuperacion.trim()) return;
    this.cargando = true;
    this.error = '';
    this.mensajeExito = '';
    try {
      const res = await this.auth.solicitarRecuperacionMfa(this.correoRecuperacion.trim());
      this.mensajeExito = res.mensaje || this.i18n.t('admin.acceso.exitoSolicitarRec');
    } catch (err: any) {
      this.error = this.formatearError(err, this.i18n.t('admin.acceso.errorSolicitarRec'));
    } finally {
      this.cargando = false;
    }
  }

  async restablecerMfa(): Promise<void> {
    if (this.cargando || !this.tokenRecuperacion.trim() || !this.nuevaContrasena) return;
    this.cargando = true;
    this.error = '';
    this.mensajeExito = '';
    try {
      const res = await this.auth.restablecerMfa(this.tokenRecuperacion.trim(), this.nuevaContrasena);
      this.nuevaContrasena = '';
      this.tokenRecuperacion = '';
      this.mensajeExito = res.mensaje || this.i18n.t('admin.acceso.exitoRestablecerMfa');
      this.paso = 'CREDENCIALES';
    } catch (err: any) {
      this.error = this.formatearError(err, this.i18n.t('admin.acceso.errorRestablecerMfa'));
    } finally {
      this.cargando = false;
    }
  }

  async entrarAlPanel(): Promise<void> {
    this.codigosRecuperacion = [];
    await this.router.navigateByUrl('/admin/resumen');
  }

  copiarTexto(texto: string, claveMensaje = 'admin.acceso.copiadoDefecto'): void {
    if (navigator?.clipboard && texto) {
      void navigator.clipboard.writeText(texto);
      this.mensajeExito = this.i18n.t(claveMensaje);
    }
  }

  volverACredenciales(): void {
    this.paso = 'CREDENCIALES';
    this.limpiarDatosSensibles();
    this.error = '';
    this.mensajeExito = '';
  }

  private async generarQrLocal(otpauthUrl: string): Promise<void> {
    this.generandoQr = true;
    this.errorQr = '';
    this.qrDataUrl = '';
    try {
      if (!otpauthUrl || !otpauthUrl.startsWith('otpauth://totp/')) {
        throw new Error('URI otpauth inválida');
      }
      this.qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#09142e',
          light: '#ffffff'
        }
      });
    } catch {
      this.errorQr = this.i18n.t('admin.acceso.errorGenerarQr');
    } finally {
      this.generandoQr = false;
    }
  }

  private limpiarDatosConfiguracionMfa(): void {
    this.tokenDesafioMfa = '';
    this.configMfa = null;
    this.qrDataUrl = '';
    this.generandoQr = false;
    this.errorQr = '';
    this.mostrarClaveManual = false;
    this.codigoTotp = '';
  }

  private limpiarDatosSensibles(): void {
    this.limpiarDatosConfiguracionMfa();
    this.contrasena = '';
    this.codigoRecuperacion = '';
    this.codigosRecuperacion = [];
    this.nuevaContrasena = '';
    this.tokenRecuperacion = '';
    this.usarCodigoRecuperacion = false;
  }

  private formatearError(err: any, respaldo: string): string {
    if (err?.status === 429) {
      const retry = err?.headers?.get?.('Retry-After');
      return retry
        ? this.i18n.t('admin.acceso.errorRateLimitSegundos', { segundos: retry })
        : this.i18n.t('admin.acceso.errorRateLimit');
    }
    if (err?.status === 401) {
      return err?.error?.error || this.i18n.t('admin.acceso.errorCredenciales401');
    }
    if (err?.status === 403) {
      return err?.error?.error || this.i18n.t('admin.acceso.errorPermisos403');
    }
    return err?.error?.error || respaldo;
  }
}
