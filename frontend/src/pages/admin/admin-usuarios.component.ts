import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import {
  AccesoClienteAdmin,
  PaginacionAdmin,
  UsuarioAdminDetalle,
  UsuarioAdminItem
} from '../../models/admin.model';
import { RolPlataforma } from '../../auth/auth.model';
import { ETIQUETAS_ROL_PLATAFORMA, formatearFechaAdmin } from './admin-formatters';

interface ConfirmacionUsuario {
  tipo: 'REVOCAR_TODAS' | 'REVOCAR_SESION' | 'TOGGLE_ACCESO';
  titulo: string;
  descripcion: string;
  usuarioId: string;
  sesionId?: string;
  acceso?: AccesoClienteAdmin;
  motivo: string;
}

@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-usuarios.component.html',
  styleUrls: ['./admin.shared.css']
})
export class AdminUsuariosComponent implements OnInit {
  usuarios: UsuarioAdminItem[] = [];
  paginacion: PaginacionAdmin = { pagina: 1, limite: 20, total: 0, totalPaginas: 0 };

  busqueda = '';
  filtroRol: RolPlataforma | '' = '';
  filtroTipoAcceso: 'ORGANIZACION' | 'CLIENTE' | 'ADMIN_GLOBAL' | '' = '';

  cargando = false;
  error = '';
  toast = '';

  detalle: UsuarioAdminDetalle | null = null;
  cargandoDetalle = false;

  confirmacion: ConfirmacionUsuario | null = null;
  ejecutandoAccion = false;
  errorAccion = '';

  readonly etiquetasRol = ETIQUETAS_ROL_PLATAFORMA;
  readonly formatearFecha = formatearFechaAdmin;

  constructor(private adminApi: AdminApiService) {}

  ngOnInit(): void {
    void this.cargar(1);
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape(): void {
    if (this.confirmacion && !this.ejecutandoAccion) {
      this.confirmacion = null;
      return;
    }
    if (this.detalle) {
      this.cerrarDetalle();
    }
  }

  async cargar(pagina = this.paginacion.pagina): Promise<void> {
    this.cargando = true;
    this.error = '';
    try {
      const res = await this.adminApi.listarUsuarios({
        pagina,
        limite: this.paginacion.limite,
        busqueda: this.busqueda,
        rolPlataforma: this.filtroRol,
        tipoAcceso: this.filtroTipoAcceso
      });
      this.usuarios = res.datos;
      this.paginacion = res.paginacion;
    } catch (err: any) {
      this.error = extraerErrorAdmin(err, 'No se pudieron cargar los usuarios.');
    } finally {
      this.cargando = false;
    }
  }

  buscar(): void {
    void this.cargar(1);
  }

  limpiarFiltros(): void {
    this.busqueda = '';
    this.filtroRol = '';
    this.filtroTipoAcceso = '';
    void this.cargar(1);
  }

  async verDetalle(usuarioId: string): Promise<void> {
    this.cargandoDetalle = true;
    this.error = '';
    try {
      this.detalle = await this.adminApi.obtenerUsuario(usuarioId);
    } catch (err: any) {
      this.error = extraerErrorAdmin(err, 'No se pudo cargar el detalle del usuario.');
    } finally {
      this.cargandoDetalle = false;
    }
  }

  cerrarDetalle(): void {
    this.detalle = null;
  }

  pedirRevocarTodas(u: UsuarioAdminItem | UsuarioAdminDetalle): void {
    this.errorAccion = '';
    this.confirmacion = {
      tipo: 'REVOCAR_TODAS',
      titulo: 'Revocar todas las sesiones activas',
      descripcion: `Se cerrarán todas las sesiones activas de ${u.nombre} (${u.correo}), excepto tu propia sesión actual si corresponde.`,
      usuarioId: u.id,
      motivo: ''
    };
  }

  pedirRevocarSesion(usuarioId: string, sesionId: string): void {
    this.errorAccion = '';
    this.confirmacion = {
      tipo: 'REVOCAR_SESION',
      titulo: 'Revocar sesión específica',
      descripcion: `Esta acción invalidará inmediatamente el token de la sesión ${sesionId}.`,
      usuarioId,
      sesionId,
      motivo: ''
    };
  }

  pedirToggleAcceso(usuarioId: string, acceso: AccesoClienteAdmin): void {
    this.errorAccion = '';
    const accion = acceso.activo ? 'Desactivar' : 'Reactivar';
    this.confirmacion = {
      tipo: 'TOGGLE_ACCESO',
      titulo: `${accion} acceso de cliente`,
      descripcion: `¿Confirmas ${accion.toLowerCase()} el acceso de cliente en ${acceso.clienteNombre || acceso.clienteId}?`,
      usuarioId,
      acceso,
      motivo: ''
    };
  }

  async ejecutarConfirmacion(): Promise<void> {
    if (!this.confirmacion || this.ejecutandoAccion) return;
    this.ejecutandoAccion = true;
    this.errorAccion = '';
    const c = this.confirmacion;
    const motivo = c.motivo.trim() || undefined;
    try {
      if (c.tipo === 'REVOCAR_TODAS') {
        const res = await this.adminApi.revocarSesionesUsuario(c.usuarioId, { motivo });
        this.mostrarToast(`Sesiones revocadas: ${res.sesionesRevocadas}.`);
      } else if (c.tipo === 'REVOCAR_SESION' && c.sesionId) {
        await this.adminApi.revocarSesionesUsuario(c.usuarioId, { sesionId: c.sesionId, motivo });
        this.mostrarToast('Sesión revocada correctamente.');
      } else if (c.tipo === 'TOGGLE_ACCESO' && c.acceso) {
        await this.adminApi.actualizarAccesoCliente(c.usuarioId, c.acceso.id, {
          activo: !c.acceso.activo,
          motivo
        });
        this.mostrarToast(c.acceso.activo ? 'Acceso de cliente desactivado.' : 'Acceso de cliente reactivado.');
      }
      this.confirmacion = null;
      if (this.detalle && this.detalle.id === c.usuarioId) {
        this.detalle = await this.adminApi.obtenerUsuario(c.usuarioId);
      }
      await this.cargar(this.paginacion.pagina);
    } catch (err: any) {
      this.errorAccion = extraerErrorAdmin(err, 'No se pudo completar la acción.');
    } finally {
      this.ejecutandoAccion = false;
    }
  }

  private mostrarToast(msg: string): void {
    this.toast = msg;
    setTimeout(() => {
      if (this.toast === msg) this.toast = '';
    }, 3200);
  }
}
