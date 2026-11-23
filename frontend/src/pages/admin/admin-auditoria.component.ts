import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import { EventoAuditoriaAdmin, PaginacionAdmin } from '../../models/admin.model';
import { formatearFechaAdmin } from './admin-formatters';

@Component({
  selector: 'app-admin-auditoria',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-auditoria.component.html',
  styleUrls: ['./admin.shared.css']
})
export class AdminAuditoriaComponent implements OnInit {
  eventos: EventoAuditoriaAdmin[] = [];
  paginacion: PaginacionAdmin = { pagina: 1, limite: 20, total: 0, totalPaginas: 0 };

  busqueda = '';
  filtroAccion = '';
  filtroEntidad = '';
  filtroDesde = '';
  filtroHasta = '';

  cargando = false;
  error = '';
  seleccionado: EventoAuditoriaAdmin | null = null;

  readonly formatearFecha = formatearFechaAdmin;

  constructor(private adminApi: AdminApiService) {}

  ngOnInit(): void {
    void this.cargar(1);
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape(): void {
    if (this.seleccionado) {
      this.seleccionado = null;
    }
  }

  async cargar(pagina = this.paginacion.pagina): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      const desde = this.filtroDesde ? new Date(`${this.filtroDesde}T00:00:00.000Z`).toISOString() : '';
      const hasta = this.filtroHasta ? new Date(`${this.filtroHasta}T23:59:59.999Z`).toISOString() : '';
      const res = await this.adminApi.listarAuditoria({
        pagina,
        limite: this.paginacion.limite,
        busqueda: this.busqueda,
        accion: this.filtroAccion,
        entidad: this.filtroEntidad,
        desde,
        hasta
      });
      this.eventos = res.datos;
      this.paginacion = res.paginacion;
    } catch (err: any) {
      this.error = extraerErrorAdmin(err, 'No se pudo cargar la bitácora de auditoría.');
    } finally {
      this.cargando = false;
    }
  }

  limpiarFiltros(): void {
    this.busqueda = '';
    this.filtroAccion = '';
    this.filtroEntidad = '';
    this.filtroDesde = '';
    this.filtroHasta = '';
    void this.cargar(1);
  }

  formatearMetadatos(metadatos?: Record<string, unknown> | null): string {
    if (!metadatos) return 'Sin metadatos adicionales.';
    try {
      return JSON.stringify(metadatos, null, 2);
    } catch {
      return String(metadatos);
    }
  }
}
