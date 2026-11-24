import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { TipoFreelance } from '../auth/auth.model';
import { API_ORIGIN } from '../auth/api.config';
import { I18nService } from '../state/i18n.service';
import { TPipe } from '../shared/t.pipe';

const CLAVES_CAMPO: Record<string, string> = {
  correo: 'publico.registro.campoCorreo',
  contrasena: 'publico.registro.campoContrasena',
  nombre: 'publico.registro.campoNombre',
  apellido: 'publico.registro.campoApellido',
  nombreEstudio: 'publico.registro.campoEstudio',
  slug: 'publico.registro.campoSlug',
  tipoFreelance: 'publico.registro.campoEspecialidad'
};

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TPipe],
  templateUrl: './registro.component.html',
  styleUrls: ['./registro.component.css']
})
export class RegistroComponent {
  public readonly i18n = inject(I18nService);
  readonly apiDisponible = !!API_ORIGIN;
  datos = {
    correo: '',
    contrasena: '',
    nombre: '',
    apellido: '',
    nombreEstudio: '',
    slug: '',
    tipoFreelance: 'GENERAL' as TipoFreelance
  };

  mostrarContrasena = false;
  cargando = false;
  enviado = false;
  private errorState: { key?: string; params?: Record<string, string | number>; raw?: string } | null = null;
  slugManual = false;

  constructor(private auth: AuthService, private router: Router) {}

  get error(): string {
    if (!this.errorState) return '';
    if (this.errorState.raw) return this.errorState.raw;
    return this.errorState.key ? this.i18n.t(this.errorState.key, this.errorState.params) : '';
  }

  alternarMostrarContrasena(): void {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  onEstudioInput(): void {
    if (!this.slugManual) {
      this.datos.slug = this.sugerirSlug(this.datos.nombreEstudio);
    }
  }

  onSlugInput(): void {
    this.slugManual = true;
    if (this.datos.slug) {
      this.datos.slug = this.datos.slug
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '-');
    }
  }

  sugerirSlug(nombre: string): string {
    if (!nombre) return '';
    return nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private resolverEstadoError(error: any): { key?: string; params?: Record<string, string | number>; raw?: string } {
    if (!API_ORIGIN) {
      return { key: 'publico.comun.apiNoConfiguradaDetalle' };
    }

    const status = error?.status;
    const mensajeApi = typeof error?.error?.error === 'string' ? error.error.error.trim() : '';

    if (status === 409) {
      return mensajeApi ? { raw: mensajeApi } : { key: 'publico.registro.errorConflicto' };
    }

    if (status === 422) {
      const detalles = Array.isArray(error?.error?.detalles) ? error.error.detalles : [];
      const campos = Array.from(
        new Set(
          detalles
            .map((d: any) => (Array.isArray(d?.path) && d.path.length ? String(d.path[0]) : ''))
            .filter(Boolean)
            .map((campo: string) => (CLAVES_CAMPO[campo] ? this.i18n.t(CLAVES_CAMPO[campo]) : campo))
        )
      );
      if (campos.length > 0) {
        return { key: 'publico.registro.errorDatosInvalidosCampos', params: { campos: campos.join(', ') } };
      }
      if (mensajeApi && mensajeApi !== 'Datos inválidos') {
        return { raw: mensajeApi };
      }
      return { key: 'publico.registro.errorDatosInvalidos' };
    }

    if (typeof status === 'number' && status >= 500) {
      return { key: 'publico.registro.errorServidor' };
    }

    if (status === 0 || error?.name === 'HttpErrorResponse') {
      if (mensajeApi) return { raw: mensajeApi };
      return { key: 'publico.registro.errorConexion' };
    }

    return mensajeApi ? { raw: mensajeApi } : { key: 'publico.registro.errorGenerico' };
  }

  resolverMensajeError(error: any): string {
    const estado = this.resolverEstadoError(error);
    if (estado.raw) return estado.raw;
    return estado.key ? this.i18n.t(estado.key, estado.params) : '';
  }

  async registrar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || this.cargando) return;
    this.cargando = true;
    this.errorState = null;
    try {
      const payload = {
        correo: this.datos.correo.trim().toLowerCase(),
        contrasena: this.datos.contrasena,
        nombre: this.datos.nombre.trim(),
        apellido: this.datos.apellido ? this.datos.apellido.trim() : undefined,
        nombreEstudio: this.datos.nombreEstudio.trim(),
        slug: this.datos.slug.trim().toLowerCase(),
        tipoFreelance: this.datos.tipoFreelance,
        idioma: this.i18n.idiomaActual
      };
      await this.auth.registrar(payload);
      this.datos.contrasena = '';
      await this.router.navigateByUrl(this.auth.rutaInicial());
    } catch (error: any) {
      this.errorState = this.resolverEstadoError(error);
    } finally {
      this.cargando = false;
    }
  }
}
