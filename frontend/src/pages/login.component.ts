import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ConflictoContextos, OpcionContexto, SeleccionContexto } from '../auth/auth.model';
import { API_ORIGIN } from '../auth/api.config';
import { I18nService } from '../state/i18n.service';
import { TPipe } from '../shared/t.pipe';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TPipe],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  public readonly i18n = inject(I18nService);
  readonly apiDisponible = !!API_ORIGIN;
  correo = '';
  contrasena = '';
  mostrarContrasena = false;
  enviado = false;
  cargando = false;
  private errorKey = '';
  opciones: OpcionContexto[] = [];

  constructor(private auth: AuthService, private router: Router) {}

  get error(): string {
    return this.errorKey ? this.i18n.t(this.errorKey) : '';
  }

  alternarMostrarContrasena(): void {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  async entrar(form: NgForm): Promise<void> {
    this.enviado = true;
    if (form.invalid || this.cargando) return;
    await this.iniciar();
  }

  async seleccionar(opcion: OpcionContexto): Promise<void> {
    if (this.cargando) return;
    const seleccion: SeleccionContexto = opcion.tipoAcceso === 'ORGANIZACION'
      ? { tipoAcceso: 'ORGANIZACION', organizacionId: opcion.organizacionId }
      : { tipoAcceso: 'CLIENTE', organizacionId: opcion.organizacionId, clienteId: opcion.clienteId! };
    await this.iniciar(seleccion);
  }

  volver(): void {
    this.opciones = [];
    this.contrasena = '';
    this.errorKey = '';
    this.enviado = false;
  }

  private async iniciar(seleccion?: SeleccionContexto): Promise<void> {
    this.cargando = true;
    this.errorKey = '';
    try {
      await this.auth.iniciar(this.correo, this.contrasena, seleccion);
      this.contrasena = '';
      await this.router.navigateByUrl(this.auth.rutaInicial());
    } catch (error: any) {
      const conflicto = error?.error as ConflictoContextos | undefined;
      if (error?.status === 409 && conflicto?.contextos && Array.isArray(conflicto.contextos.organizaciones) && Array.isArray(conflicto.contextos.clientes)) {
        this.opciones = [...conflicto.contextos.organizaciones, ...conflicto.contextos.clientes];
      } else if (error?.status === 401) {
        this.errorKey = 'publico.login.errorCredenciales';
      } else if (error?.status === 403) {
        this.errorKey = 'publico.login.errorContexto';
      } else {
        this.errorKey = API_ORIGIN
          ? 'publico.login.errorGenerico'
          : 'publico.comun.apiNoConfiguradaDetalle';
      }
    } finally {
      this.cargando = false;
    }
  }
}
