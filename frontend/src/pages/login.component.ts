import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ConflictoContextos, OpcionContexto, SeleccionContexto } from '../auth/auth.model';
import { API_ORIGIN } from '../auth/api.config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  readonly apiDisponible = !!API_ORIGIN;
  correo = '';
  contrasena = '';
  mostrarContrasena = false;
  enviado = false;
  cargando = false;
  error = '';
  opciones: OpcionContexto[] = [];

  constructor(private auth: AuthService, private router: Router) {}

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
    this.error = '';
    this.enviado = false;
  }

  private async iniciar(seleccion?: SeleccionContexto): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      await this.auth.iniciar(this.correo, this.contrasena, seleccion);
      this.contrasena = '';
      await this.router.navigateByUrl(this.auth.rutaInicial());
    } catch (error: any) {
      const conflicto = error?.error as ConflictoContextos | undefined;
      if (error?.status === 409 && conflicto?.contextos && Array.isArray(conflicto.contextos.organizaciones) && Array.isArray(conflicto.contextos.clientes)) {
        this.opciones = [...conflicto.contextos.organizaciones, ...conflicto.contextos.clientes];
      } else if (error?.status === 401) {
        this.error = 'Correo o contraseña incorrectos.';
      } else if (error?.status === 403) {
        this.error = 'No tienes acceso al contexto seleccionado.';
      } else {
        this.error = API_ORIGIN
          ? 'No se pudo iniciar sesión. Comprueba tu conexión e inténtalo de nuevo.'
          : 'La API de este entorno no está configurada. Contacta al administrador de Equinox.';
      }
    } finally {
      this.cargando = false;
    }
  }
}
