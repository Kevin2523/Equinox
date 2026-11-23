import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { AuthService } from '../../auth/auth.service';
import { RespuestaInicioConfiguracionMfa } from '../../auth/auth.model';
import { API_ORIGIN } from '../../auth/api.config';

type PasoAccesoAdmin =
  | 'CREDENCIALES'
  | 'CONFIGURAR_MFA'
  | 'CODIGOS_RECUPERACION'
  | 'VERIFICAR_MFA'
  | 'RECUPERAR_MFA';

@Component({
  selector: 'app-admin-acceso',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-acceso.component.html',
  styleUrls: ['./admin-acceso.component.css']
})
export class AdminAccesoComponent implements OnInit, OnDestroy {
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

      this.error = 'La respuesta del servidor no incluyó el desafío MFA requerido.';
    } catch (err: any) {
      this.error = this.formatearError(err, 'No se pudo iniciar el acceso de administrador.');
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
      this.error = 'Ingresa un código TOTP válido de 6 dígitos.';
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
      this.error = this.formatearError(err, 'No se pudo confirmar el código TOTP.');
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
      this.error = 'Ingresa el código de recuperación para continuar.';
      return;
    }
    if (!this.usarCodigoRecuperacion && !/^\d{6}$/.test(codigoTotpLimpio)) {
      this.error = 'Ingresa un código TOTP válido de 6 dígitos.';
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
      this.error = this.formatearError(err, 'Código de verificación inválido.');
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
      this.mensajeExito = res.mensaje || 'Si la cuenta es elegible, recibirás instrucciones para restablecer tu MFA.';
    } catch (err: any) {
      this.error = this.formatearError(err, 'No se pudo solicitar la recuperación MFA.');
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
      this.mensajeExito = res.mensaje || 'MFA restablecido. Inicia sesión para configurar tu nuevo autenticador.';
      this.paso = 'CREDENCIALES';
    } catch (err: any) {
      this.error = this.formatearError(err, 'No se pudo restablecer el MFA.');
    } finally {
      this.cargando = false;
    }
  }

  async entrarAlPanel(): Promise<void> {
    this.codigosRecuperacion = [];
    await this.router.navigateByUrl('/admin/resumen');
  }

  copiarTexto(texto: string, mensaje = 'Copiado al portapapeles.'): void {
    if (navigator?.clipboard && texto) {
      void navigator.clipboard.writeText(texto);
      this.mensajeExito = mensaje;
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
      this.errorQr = 'No se pudo generar el código QR en este navegador. Usa la clave manual como alternativa.';
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
        ? `Demasiados intentos. Intenta nuevamente en ${retry} segundos.`
        : 'Demasiados intentos. Espera un momento antes de reintentar.';
    }
    if (err?.status === 401) {
      return err?.error?.error || 'Credenciales o código de verificación inválidos.';
    }
    if (err?.status === 403) {
      return err?.error?.error || 'Esta cuenta no tiene permisos de ADMIN_GLOBAL.';
    }
    return err?.error?.error || respaldo;
  }
}
