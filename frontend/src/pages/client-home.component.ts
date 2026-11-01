import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArchivoPortal, ComentarioPortal, FacturaPortal, HitoPortal, IdentidadPortal, ProyectoPortal } from '../models/portal.model';
import { PortalApiService } from '../services/portal-api.service';

@Component({
  selector: 'app-client-home', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './client-home.component.html', styleUrl: './client-home.component.css'
})
export class ClientHomeComponent implements OnInit {
  identidad: IdentidadPortal | null = null;
  proyectos: ProyectoPortal[] = [];
  proyecto: ProyectoPortal | null = null;
  hitos: HitoPortal[] = [];
  archivos: ArchivoPortal[] = [];
  comentarios: ComentarioPortal[] = [];
  facturas: FacturaPortal[] = [];
  proyectoId: string | null = null;
  cargandoIdentidad = false;
  cargandoProyectos = false;
  cargandoDetalle = false;
  cargandoFacturas = false;
  enviandoComentario = false;
  errorIdentidad = '';
  errorProyectos = '';
  errorDetalle = '';
  errorFacturas = '';
  errorComentario = '';
  comentario = '';
  logoFallido = false;
  private solicitudDetalle = 0;
  private solicitudProyectos = 0;
  private solicitudFacturas = 0;

  constructor(private api: PortalApiService) {}

  ngOnInit(): void {
    void this.cargarIdentidad();
    void this.cargarProyectos();
    void this.cargarFacturas();
  }

  async cargarIdentidad(): Promise<void> {
    this.cargandoIdentidad = true;
    this.errorIdentidad = '';
    try {
      this.identidad = await this.api.identidad();
      this.logoFallido = false;
    } catch {
      this.errorIdentidad = 'No se pudo cargar la identidad del portal.';
    } finally {
      this.cargandoIdentidad = false;
    }
  }

  async cargarProyectos(): Promise<void> {
    const solicitud = ++this.solicitudProyectos;
    this.cargandoProyectos = true;
    this.errorProyectos = '';
    try {
      const proyectos = await this.api.proyectos();
      if (solicitud !== this.solicitudProyectos) return;
      this.proyectos = proyectos;
      if (!this.proyectos.some((proyecto) => proyecto.id === this.proyectoId)) {
        ++this.solicitudDetalle;
        this.proyectoId = null;
        this.proyecto = null;
        this.cargandoDetalle = false;
        this.limpiarDetalle();
        if (this.proyectos.length) await this.seleccionarProyecto(this.proyectos[0].id);
      }
    } catch {
      if (solicitud === this.solicitudProyectos) this.errorProyectos = 'No se pudieron cargar tus proyectos.';
    } finally {
      if (solicitud === this.solicitudProyectos) this.cargandoProyectos = false;
    }
  }

  async seleccionarProyecto(id: string): Promise<void> {
    this.proyectoId = id;
    const solicitud = ++this.solicitudDetalle;
    this.proyecto = null;
    this.comentario = '';
    this.errorComentario = '';
    this.limpiarDetalle();
    this.cargandoDetalle = true;
    this.errorDetalle = '';
    try {
      const [proyecto, hitos, archivos, comentarios] = await Promise.all([
        this.api.proyecto(id), this.api.hitos(id), this.api.archivos(id), this.api.comentarios(id)
      ]);
      if (solicitud !== this.solicitudDetalle) return;
      this.proyecto = proyecto;
      this.hitos = hitos;
      this.archivos = archivos;
      this.comentarios = comentarios;
    } catch {
      if (solicitud === this.solicitudDetalle) this.errorDetalle = 'No se pudo cargar el detalle. Comprueba la conexión e inténtalo de nuevo.';
    } finally {
      if (solicitud === this.solicitudDetalle) this.cargandoDetalle = false;
    }
  }

  async reintentarDetalle(): Promise<void> {
    if (this.proyectoId) await this.seleccionarProyecto(this.proyectoId);
  }

  async cargarFacturas(): Promise<void> {
    const solicitud = ++this.solicitudFacturas;
    this.cargandoFacturas = true;
    this.errorFacturas = '';
    try {
      const facturas = await this.api.facturas();
      if (solicitud !== this.solicitudFacturas) return;
      this.facturas = facturas;
    } catch {
      if (solicitud === this.solicitudFacturas) this.errorFacturas = 'No se pudieron cargar las facturas autorizadas.';
    } finally {
      if (solicitud === this.solicitudFacturas) this.cargandoFacturas = false;
    }
  }

  async enviarComentario(): Promise<void> {
    const contenido = this.comentario.trim();
    this.errorComentario = '';
    if (!contenido || contenido.length > 2000) {
      this.errorComentario = 'Escribe un comentario de entre 1 y 2000 caracteres.';
      return;
    }
    if (!this.proyectoId || this.enviandoComentario) return;
    const proyectoId = this.proyectoId;
    this.enviandoComentario = true;
    try {
      const nuevo = await this.api.enviarComentario(proyectoId, contenido);
      if (this.proyectoId === proyectoId) {
        this.comentarios = [...this.comentarios, nuevo];
        this.comentario = '';
      }
    } catch (error: any) {
      this.errorComentario = error?.status === 422
        ? 'El comentario no cumple el formato permitido.'
        : 'No se pudo enviar el comentario. Puedes reintentarlo.';
    } finally {
      this.enviandoComentario = false;
    }
  }

  get avanceHitos(): number | null {
    if (!this.hitos.length) return null;
    return Math.round(this.hitos.filter((hito) => hito.estado === 'COMPLETADO').length / this.hitos.length * 100);
  }

  estadoHito(estado: HitoPortal['estado']): string {
    return { PENDIENTE: 'Pendiente', EN_PROGRESO: 'En progreso', COMPLETADO: 'Completado', VENCIDO: 'Vencido' }[estado];
  }

  autorComentario(comentario: ComentarioPortal): string {
    if (comentario.autor === 'CLIENTE') return 'Tú';
    const nombre = [comentario.usuario?.nombre, comentario.usuario?.apellido].filter(Boolean).join(' ');
    return nombre || this.identidad?.estudio.nombre || 'Equipo';
  }

  tamanoArchivo(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private limpiarDetalle(): void {
    this.hitos = [];
    this.archivos = [];
    this.comentarios = [];
    this.errorDetalle = '';
  }
}
