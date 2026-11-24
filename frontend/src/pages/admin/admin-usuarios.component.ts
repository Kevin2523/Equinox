import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApiService, extraerErrorAdmin } from '../../services/admin-api.service';
import {
  AccesoClienteAdmin,
  PaginacionAdmin,
  UsuarioAdminDetalle,
  UsuarioAdminItem
} from '../../models/admin.model';
import { RolPlataforma } from '../../auth/auth.model';
import { TPipe } from '../../shared/t.pipe';
import { I18nService } from '../../state/i18n.service';
import { CLAVES_ROL_PLATAFORMA, formatearFechaAdmin, formatearNumeroAdmin } from './admin-formatters';

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
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './admin-usuarios.component.html',
  styleUrls: ['./admin.shared.css']
})
export class AdminUsuariosComponent implements OnInit {
  readonly i18n = inject(I18nService);

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

  readonly clavesRol = CLAVES_ROL_PLATAFORMA;

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
      this.error = extraerErrorAdmin(err, this.i18n.t('admin.usuarios.errorCargar'));
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
      this.error = extraerErrorAdmin(err, this.i18n.t('admin.usuarios.errorDetalle'));
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
      titulo: this.i18n.t('admin.usuarios.confirmRevocarTodasTitulo'),
      descripcion: this.i18n.t('admin.usuarios.confirmRevocarTodasDesc', { nombre: u.nombre, correo: u.correo }),
      usuarioId: u.id,
      motivo: ''
    };
  }

  pedirRevocarSesion(usuarioId: string, sesionId: string): void {
    this.errorAccion = '';
    this.confirmacion = {
      tipo: 'REVOCAR_SESION',
      titulo: this.i18n.t('admin.usuarios.confirmRevocarSesionTitulo'),
      descripcion: this.i18n.t('admin.usuarios.confirmRevocarSesionDesc', { sesionId }),
      usuarioId,
      sesionId,
      motivo: ''
    };
  }

  pedirToggleAcceso(usuarioId: string, acceso: AccesoClienteAdmin): void {
    this.errorAccion = '';
    const cliente = acceso.clienteNombre || acceso.clienteId;
    this.confirmacion = {
      tipo: 'TOGGLE_ACCESO',
      titulo: this.i18n.t(acceso.activo ? 'admin.usuarios.confirmDesactivarAccesoTitulo' : 'admin.usuarios.confirmReactivarAccesoTitulo'),
      descripcion: this.i18n.t(acceso.activo ? 'admin.usuarios.confirmDesactivarAccesoDesc' : 'admin.usuarios.confirmReactivarAccesoDesc', { cliente }),
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
        this.mostrarToast(this.i18n.t('admin.usuarios.toastSesionesRevocadas', { count: this.formatearNumero(res.sesionesRevocadas) }));
      } else if (c.tipo === 'REVOCAR_SESION' && c.sesionId) {
        await this.adminApi.revocarSesionesUsuario(c.usuarioId, { sesionId: c.sesionId, motivo });
        this.mostrarToast(this.i18n.t('admin.usuarios.toastSesionRevocada'));
      } else if (c.tipo === 'TOGGLE_ACCESO' && c.acceso) {
        await this.adminApi.actualizarAccesoCliente(c.usuarioId, c.acceso.id, {
          activo: !c.acceso.activo,
          motivo
        });
        this.mostrarToast(this.i18n.t(c.acceso.activo ? 'admin.usuarios.toastAccesoDesactivado' : 'admin.usuarios.toastAccesoReactivado'));
      }
      this.confirmacion = null;
      if (this.detalle && this.detalle.id === c.usuarioId) {
        this.detalle = await this.adminApi.obtenerUsuario(c.usuarioId);
      }
      await this.cargar(this.paginacion.pagina);
    } catch (err: any) {
      this.errorAccion = extraerErrorAdmin(err, this.i18n.t('admin.comun.errorAccion'));
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
