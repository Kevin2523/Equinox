import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { UiStateService } from '../state/ui-state.service';
import { ClientesProyectosApiService, ProyectoApi } from '../services/clientes-proyectos-api.service';
import { TrabajoApiService, HitoApi, ComentarioApi } from '../services/trabajo-api.service';
import { ArchivosApiService, ArchivoApi } from '../services/archivos-api.service';
import { FacturasApiService } from '../services/facturas-api.service';
import { Factura } from '../models/equinox.model';

@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portal.component.html',
  styleUrl: './portal.component.css'
})
export class PortalComponent implements OnInit, OnDestroy {
  cargando = false;
  cargandoDetalle = false;
  errorDetalle = '';
  descargandoArchivoId: string | null = null;
  errorDescarga = '';
  hitos: HitoApi[] = [];
  archivos: ArchivoApi[] = [];
  comentarios: ComentarioApi[] = [];

  private solicitudDetalle = 0;
  private destruido = false;
  private readonly subs = new Subscription();

  constructor(
    public state: UiStateService,
    public api: ClientesProyectosApiService,
    public trabajo: TrabajoApiService,
    public archivosApi: ArchivosApiService,
    private cdr: ChangeDetectorRef,
    public facturasApi?: FacturasApiService
  ) {}

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      (window as any).__portalComponent = this;
    }
    if (!this.state.haCargadoFacturas && !this.state.cargandoFacturas) {
      void this.state.cargarFacturas();
    }
    if (this.state.portalMostrarFinanzas === null && !this.state.cargandoPortalFinanzas) {
      void this.state.cargarConfiguracionPortalFinanzas();
    }

    this.subs.add(
      this.state.facturasReales$.subscribe(() => {
        if (!this.destruido) {
          this.cdr.markForCheck();
        }
      })
    );

    if (!this.api.proyectos.length) {
      this.cargando = true;
      void Promise.all([this.api.listarProyectos(), this.api.listarClientes()]).finally(() => {
        if (this.destruido) return;
        this.cargando = false;
        if (!this.api.proyectoSeleccionado && this.api.proyectos.length) {
          void this.api.seleccionarProyecto(this.api.proyectos[0].id);
        }
      });
    } else if (!this.api.proyectoSeleccionado && this.api.proyectos.length) {
      void this.api.seleccionarProyecto(this.api.proyectos[0].id);
    }

    this.subs.add(
      this.api.proyectoSeleccionado$.subscribe((proyecto) => {
        if (this.destruido) return;
        if (proyecto) {
          void this.cargarDetalleProyecto(proyecto.id);
        } else {
          this.limpiarDetalle();
        }
      })
    );
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined' && (window as any).__portalComponent === this) {
      delete (window as any).__portalComponent;
    }
    this.destruido = true;
    this.solicitudDetalle++;
    this.subs.unsubscribe();
    this.limpiarDetalle();
  }

  async seleccionarProyecto(id: string): Promise<void> {
    await this.api.seleccionarProyecto(id);
  }

  get proyectoActual(): ProyectoApi | null {
    return this.api.proyectoSeleccionado || this.api.proyectos[0] || null;
  }

  get facturas(): Factura[] {
    const pId = this.proyectoActual?.id;
    if (!pId) return [];
    return (this.state.facturasReales || []).filter(
      (f) => f.proyectoId === pId && f.visibleEnPortal
    );
  }

  get avanceProgreso(): number {
    if (!this.hitos?.length) return 0;
    const completados = this.hitos.filter((h) => h.estado === 'COMPLETADO').length;
    return Math.round((completados / this.hitos.length) * 100);
  }

  async cargarDetalleProyecto(proyectoId: string): Promise<void> {
    const solicitud = ++this.solicitudDetalle;
    this.cargandoDetalle = true;
    this.errorDetalle = '';
    this.limpiarDetalle();

    try {
      const [todosHitos, todosArchivos, comentarios] = await Promise.all([
        this.trabajo.listarHitos(proyectoId),
        this.archivosApi.listar(proyectoId),
        this.trabajo.listarComentarios(proyectoId)
      ]);

      if (this.destruido || solicitud !== this.solicitudDetalle || this.proyectoActual?.id !== proyectoId) {
        return;
      }

      this.hitos = todosHitos.filter((h) => h.visibleEnPortal);
      this.archivos = todosArchivos.filter((a) => a.visibilidad === 'CLIENTE');
      this.comentarios = comentarios;
    } catch {
      if (this.destruido || solicitud !== this.solicitudDetalle || this.proyectoActual?.id !== proyectoId) {
        return;
      }
      this.errorDetalle = 'No se pudieron cargar todos los elementos del proyecto.';
    } finally {
      if (!this.destruido && solicitud === this.solicitudDetalle) {
        this.cargandoDetalle = false;
      }
    }
  }

  async descargarArchivo(archivo: ArchivoApi): Promise<void> {
    if (!this.proyectoActual || this.descargandoArchivoId) return;
    this.descargandoArchivoId = archivo.id;
    this.errorDescarga = '';
    try {
      await this.archivosApi.guardarDescarga(this.proyectoActual.id, archivo, false);
    } catch {
      this.errorDescarga = 'No se pudo descargar el archivo.';
    } finally {
      this.descargandoArchivoId = null;
    }
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
