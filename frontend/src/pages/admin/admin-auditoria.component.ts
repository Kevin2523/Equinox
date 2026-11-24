import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import { EventoAuditoriaAdmin, PaginacionAdmin } from '../../models/admin.model';
import { TPipe } from '../../shared/t.pipe';
import { I18nService } from '../../state/i18n.service';
import { formatearFechaAdmin, formatearNumeroAdmin } from './admin-formatters';

@Component({
  selector: 'app-admin-auditoria',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './admin-auditoria.component.html',
  styleUrls: ['./admin.shared.css']
})
export class AdminAuditoriaComponent implements OnInit {
  readonly i18n = inject(I18nService);

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

  constructor(private adminApi: AdminApiService) {}

  formatearFecha(valor?: string | null, incluirHora = true): string {
    return formatearFechaAdmin(valor, incluirHora, this.i18n.bcp47());
  }

  formatearNumero(valor: number): string {
    return formatearNumeroAdmin(valor, this.i18n.bcp47());
  }

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
      this.error = extraerErrorAdmin(err, this.i18n.t('admin.auditoria.errorCargar'));
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
    if (!metadatos) return this.i18n.t('admin.auditoria.sinMetadatos');
    try {
      return JSON.stringify(metadatos, null, 2);
    } catch {
      return String(metadatos);
    }
  }
}
