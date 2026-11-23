import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { TipoFreelance } from '../auth/auth.model';
import { API_ORIGIN } from '../auth/api.config';

const ETIQUETAS_CAMPO: Record<string, string> = {
  correo: 'correo electrónico',
  contrasena: 'contraseña (mínimo 8 caracteres)',
  nombre: 'nombre',
  apellido: 'apellido',
  nombreEstudio: 'nombre del estudio',
  slug: 'identificador del estudio (minúsculas, números y guiones)',
  tipoFreelance: 'especialidad'
};

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './registro.component.html',
  styleUrls: ['./registro.component.css']
})
export class RegistroComponent {
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
  error = '';
  slugManual = false;

  constructor(private auth: AuthService, private router: Router) {}

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

  resolverMensajeError(error: any): string {
    if (!API_ORIGIN) {
      return 'La API de este entorno no está configurada. Contacta al administrador de Equinox.';
    }

    const status = error?.status;
    const mensajeApi = typeof error?.error?.error === 'string' ? error.error.error.trim() : '';

    if (status === 409) {
      return mensajeApi || 'El correo o identificador del estudio ya está en uso.';
    }

    if (status === 422) {
      const detalles = Array.isArray(error?.error?.detalles) ? error.error.detalles : [];
      const campos = Array.from(
        new Set(
          detalles
            .map((d: any) => (Array.isArray(d?.path) && d.path.length ? String(d.path[0]) : ''))
            .filter(Boolean)
            .map((campo: string) => ETIQUETAS_CAMPO[campo] || campo)
        )
      );
      if (campos.length > 0) {
        return `Datos inválidos: revisa ${campos.join(', ')}.`;
      }
      if (mensajeApi && mensajeApi !== 'Datos inválidos') {
        return mensajeApi;
      }
      return 'Datos inválidos: revisa los campos obligatorios y su formato.';
    }

    if (typeof status === 'number' && status >= 500) {
      return 'Error interno del servidor al procesar el registro. Inténtalo de nuevo en unos momentos.';
    }

    if (status === 0 || error?.name === 'HttpErrorResponse') {
      if (mensajeApi) return mensajeApi;
      return 'No se pudo conectar con el servidor de Equinox. Verifica que el servicio API esté activo e inténtalo de nuevo.';
    }

    return mensajeApi || 'No se pudo completar el registro. Inténtalo de nuevo.';
  }

  async registrar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || this.cargando) return;
    this.cargando = true;
    this.error = '';
    try {
      const payload = {
        correo: this.datos.correo.trim().toLowerCase(),
        contrasena: this.datos.contrasena,
        nombre: this.datos.nombre.trim(),
        apellido: this.datos.apellido ? this.datos.apellido.trim() : undefined,
        nombreEstudio: this.datos.nombreEstudio.trim(),
        slug: this.datos.slug.trim().toLowerCase(),
        tipoFreelance: this.datos.tipoFreelance
      };
      await this.auth.registrar(payload);
      this.datos.contrasena = '';
      await this.router.navigateByUrl(this.auth.rutaInicial());
    } catch (error: any) {
      this.error = this.resolverMensajeError(error);
    } finally {
      this.cargando = false;
    }
  }
}
