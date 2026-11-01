import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConsultaInvitacionPublica, DatosAceptarInvitacion } from '../models/invitacion.model';
import { InvitacionesApiService } from '../services/invitaciones-api.service';

@Component({
  selector: 'app-invitacion', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './invitacion.component.html', styleUrl: './invitacion.component.css'
})
export class InvitacionComponent implements OnInit {
  token = '';
  invitacion: ConsultaInvitacionPublica | null = null;
  cargando = false;
  enviando = false;
  enviada = false;
  aceptada = false;
  puedeReintentarConsulta = false;
  error = '';
  mensajeExito = '';
  datos = { nombre: '', apellido: '', contrasena: '' };

  constructor(private route: ActivatedRoute, private api: InvitacionesApiService) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    void this.cargar();
  }

  async cargar(): Promise<void> {
    if (!this.token || this.cargando) return;
    this.cargando = true; this.error = ''; this.invitacion = null; this.puedeReintentarConsulta = false;
    try { this.invitacion = await this.api.consultarPublica(this.token); }
    catch (error: any) {
      this.error = this.mensajeErrorConsulta(error);
      this.puedeReintentarConsulta = error?.name === 'TimeoutError' || error?.status === 0 || error?.status === 429 || error?.status >= 500;
    }
    finally { this.cargando = false; }
  }

  async aceptar(form: NgForm): Promise<void> {
    this.enviada = true;
    if (!this.invitacion || form.invalid || this.enviando || this.aceptada) return;
    const datos: DatosAceptarInvitacion = this.invitacion.esUsuarioExistente
      ? { contrasena: this.datos.contrasena }
      : { nombre: this.datos.nombre.trim(), ...(this.datos.apellido.trim() ? { apellido: this.datos.apellido.trim() } : {}), contrasena: this.datos.contrasena };
    this.enviando = true; this.error = '';
    try {
      const respuesta = await this.api.aceptar(this.token, datos);
      this.aceptada = true; this.mensajeExito = respuesta.mensaje;
      this.datos.contrasena = '';
      this.token = '';
    } catch (error: any) { this.error = this.mensajeErrorAceptar(error); }
    finally { this.enviando = false; }
  }

  private mensajeErrorConsulta(error: any): string {
    if (error?.status === 404) return 'Este enlace de invitación no es válido.';
    if (error?.status === 410) {
      const descripcion = String(error?.error?.error || '').toLocaleLowerCase();
      return descripcion.includes('revoc') ? 'Esta invitación fue revocada.' : 'Esta invitación venció.';
    }
    if (error?.status === 409) return 'Esta invitación ya fue aceptada. Puedes iniciar sesión.';
    if (error?.status === 429) return 'Se alcanzó el límite temporal de consultas. Espera e inténtalo de nuevo.';
    return 'No se pudo consultar la invitación. Comprueba tu conexión e inténtalo de nuevo.';
  }

  private mensajeErrorAceptar(error: any): string {
    if (error?.status === 401) return 'La contraseña actual no es correcta.';
    if (error?.status === 404) return 'Este enlace de invitación no es válido.';
    if (error?.status === 410) {
      const descripcion = String(error?.error?.error || '').toLocaleLowerCase();
      return descripcion.includes('revoc') ? 'Esta invitación fue revocada y ya no se puede aceptar.' : 'Esta invitación venció y ya no se puede aceptar.';
    }
    if (error?.status === 409) return 'La invitación ya se usó o cambió de estado. Vuelve a consultar el enlace.';
    if (error?.status === 422) return 'Revisa los campos: el nombre debe tener al menos 2 caracteres y la contraseña al menos 8.';
    if (error?.status === 429) return 'Se alcanzó el límite temporal de intentos. Espera un momento e inténtalo de nuevo.';
    return 'No se pudo aceptar la invitación. Comprueba tu conexión e inténtalo de nuevo.';
  }
}
