import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConsultaInvitacionPublica, DatosAceptarInvitacion } from '../models/invitacion.model';
import { InvitacionesApiService } from '../services/invitaciones-api.service';
import { I18nService } from '../state/i18n.service';
import { TPipe } from '../shared/t.pipe';

@Component({
  selector: 'app-invitacion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TPipe],
  templateUrl: './invitacion.component.html',
  styleUrl: './invitacion.component.css'
})
export class InvitacionComponent implements OnInit {
  public readonly i18n = inject(I18nService);
  token = '';
  invitacion: ConsultaInvitacionPublica | null = null;
  cargando = false;
  enviando = false;
  enviada = false;
  aceptada = false;
  puedeReintentarConsulta = false;
  esInvitacionYaAceptada = false;
  mostrarContrasena = false;
  private errorKey = '';
  mensajeExito = '';
  datos = { nombre: '', apellido: '', contrasena: '' };

  constructor(private route: ActivatedRoute, private api: InvitacionesApiService) {}

  get error(): string {
    return this.errorKey ? this.i18n.t(this.errorKey) : '';
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    void this.cargar();
  }

  toggleMostrarContrasena(): void {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  get esFotografia(): boolean {
    return this.invitacion?.organizacion?.tipoFreelance?.toUpperCase() === 'FOTOGRAFIA';
  }

  get rolLegible(): string {
    return this.i18n.t(
      this.invitacion?.rol === 'TITULAR' ? 'publico.invitacion.rolTitular' : 'publico.invitacion.rolColaborador'
    );
  }

  async cargar(): Promise<void> {
    if (!this.token || this.cargando) return;
    this.cargando = true;
    this.errorKey = '';
    this.esInvitacionYaAceptada = false;
    this.invitacion = null;
    this.puedeReintentarConsulta = false;
    try {
      this.invitacion = await this.api.consultarPublica(this.token);
    } catch (error: any) {
      this.esInvitacionYaAceptada = error?.status === 409;
      this.errorKey = this.claveErrorConsulta(error);
      this.puedeReintentarConsulta =
        error?.name === 'TimeoutError' || error?.status === 0 || error?.status === 429 || error?.status >= 500;
    } finally {
      this.cargando = false;
    }
  }

  async aceptar(form: NgForm): Promise<void> {
    this.enviada = true;
    if (!this.invitacion || form.invalid || this.enviando || this.aceptada) return;
    const datos: DatosAceptarInvitacion = this.invitacion.esUsuarioExistente
      ? { contrasena: this.datos.contrasena }
      : {
          nombre: this.datos.nombre.trim(),
          ...(this.datos.apellido.trim() ? { apellido: this.datos.apellido.trim() } : {}),
          contrasena: this.datos.contrasena
        };
    this.enviando = true;
    this.errorKey = '';
    try {
      const respuesta = await this.api.aceptar(this.token, datos);
      this.aceptada = true;
      this.mensajeExito = respuesta.mensaje;
      this.datos.contrasena = '';
      this.token = '';
    } catch (error: any) {
      this.errorKey = this.claveErrorAceptar(error);
    } finally {
      this.enviando = false;
    }
  }

  private claveErrorConsulta(error: any): string {
    if (error?.status === 404) return 'publico.invitacion.errConsulta404';
    if (error?.status === 410) {
      const descripcion = String(error?.error?.error || '').toLocaleLowerCase();
      return descripcion.includes('revoc') ? 'publico.invitacion.errConsultaRevocada' : 'publico.invitacion.errConsultaVencida';
    }
    if (error?.status === 409) return 'publico.invitacion.errConsulta409';
    if (error?.status === 429) return 'publico.invitacion.errConsulta429';
    return 'publico.invitacion.errConsultaGenerico';
  }

  private claveErrorAceptar(error: any): string {
    if (error?.status === 401) return 'publico.invitacion.errAceptar401';
    if (error?.status === 404) return 'publico.invitacion.errAceptar404';
    if (error?.status === 410) {
      const descripcion = String(error?.error?.error || '').toLocaleLowerCase();
      return descripcion.includes('revoc')
        ? 'publico.invitacion.errAceptarRevocada'
        : 'publico.invitacion.errAceptarVencida';
    }
    if (error?.status === 409) return 'publico.invitacion.errAceptar409';
    if (error?.status === 422) return 'publico.invitacion.errAceptar422';
    if (error?.status === 429) return 'publico.invitacion.errAceptar429';
    return 'publico.invitacion.errAceptarGenerico';
  }
}
