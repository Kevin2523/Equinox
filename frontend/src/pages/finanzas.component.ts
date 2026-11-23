import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  FacturasApiService,
  FacturaApi,
  EstadoFacturaApi,
  CrearFacturaInput
} from '../services/facturas-api.service';
import {
  ClientesProyectosApiService,
  ClienteApi,
  ProyectoApi
} from '../services/clientes-proyectos-api.service';
import { AuthService } from '../auth/auth.service';
import { DialogFocusDirective } from '../shared/dialog-focus.directive';

interface PeriodoOpcion {
  clave: string; // 'TODOS' o 'YYYY-MM'
  etiqueta: string; // 'Abril 2026', 'Todo el historial'
  anio?: number;
  mes?: number;
}

interface ResumenMonetario {
  moneda: string;
  simbolo: string;
  pendiente: number;
  cobrado: number;
  conteoPendientes: number;
  conteoPagadas: number;
}

@Component({
  selector: 'app-finanzas',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogFocusDirective],
  templateUrl: './finanzas.component.html',
  styleUrl: './finanzas.component.css'
})
export class FinanzasComponent implements OnInit, OnDestroy {
  cargando = false;
  error: string | null = null;
  facturas: FacturaApi[] = [];
  monedaOrg = 'PAB';
  nombreOrg = '';

  // Configuración de visibilidad en portal del cliente
  portalMostrarFinanzas: boolean | null = null;
  cargandoPortalFinanzas = false;
  errorPortalFinanzas: string | null = null;
  errorVisibilidadFactura: string | null = null;
  visibilidadFacturaEnCursoId: string | null = null;

  // Filtros y búsqueda
  busqueda = '';
  filtroEstado: 'TODAS' | 'PENDIENTES' | 'PAGADAS' = 'TODAS';
  periodoSeleccionado = 'TODOS';
  menuPeriodoAbierto = false;

  // Clientes y proyectos para formularios
  clientes: ClienteApi[] = [];
  proyectosCliente: ProyectoApi[] = [];

  // Modal Nueva Factura
  modalNuevaFacturaAbierto = false;
  guardandoFactura = false;
  errorModalFactura: string | null = null;
  formFactura: {
    numero: string;
    clienteId: string;
    proyectoId: string;
    concepto: string;
    monto: number | null;
    moneda: string;
    fechaEmision: string;
    fechaVencimiento: string;
    estado: EstadoFacturaApi;
    visibleEnPortal: boolean;
    notas: string;
  } = this.obtenerFormFacturaVacio();

  // Modal Registrar Pago (soporta pagos parciales, moneda y método explícitos)
  modalPagoAbierto = false;
  guardandoPago = false;
  errorModalPago: string | null = null;
  facturaSeleccionadaPago: FacturaApi | null = null;
  formPago: {
    monto: number | null;
    moneda: string;
    metodo: string;
    referencia: string;
    notas: string;
  } = {
    monto: null,
    moneda: 'PAB',
    metodo: 'TRANSFERENCIA',
    referencia: '',
    notas: ''
  };

  // Modal Detalle
  modalDetalleAbierto = false;
  cargandoDetalle = false;
  facturaDetalle: FacturaApi | null = null;

  // Toast
  toastMensaje: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Subscription();
  private sesionTokenAnterior: string | null | undefined = undefined;

  constructor(
    public facturasApi: FacturasApiService,
    public clientesApi: ClientesProyectosApiService,
    public auth: AuthService
  ) {}

  @HostListener('document:keydown.escape')
  cerrarModalConEscape(): void {
    if (this.modalPagoAbierto && !this.guardandoPago) {
      this.cerrarModalRegistrarPago();
      return;
    }
    if (this.modalNuevaFacturaAbierto && !this.guardandoFactura) {
      this.cerrarModalNuevaFactura();
      return;
    }
    if (this.modalDetalleAbierto) {
      this.cerrarDetalleFactura();
      return;
    }
    if (this.menuPeriodoAbierto) {
      this.menuPeriodoAbierto = false;
    }
  }

  get puedeGestionarFacturas(): boolean {
    return (
      this.auth.sesion?.contexto?.tipoAcceso === 'ORGANIZACION' &&
      this.auth.sesion?.contexto?.rolOrganizacion === 'PROPIETARIO'
    );
  }

  ngOnInit(): void {
    this.subs.add(
      this.facturasApi.facturas$.subscribe((f) => {
        this.facturas = f;
      })
    );
    this.subs.add(
      this.facturasApi.cargando$.subscribe((c) => {
        this.cargando = c;
      })
    );
    this.subs.add(
      this.facturasApi.error$.subscribe((e) => {
        this.error = e;
      })
    );
    this.subs.add(
      this.clientesApi.clientes$.subscribe((c) => {
        this.clientes = c;
      })
    );
    this.subs.add(
      this.auth.sesion$.subscribe((sesion) => {
        const tokenActual = this.auth.token ?? null;
        if (this.sesionTokenAnterior !== undefined && this.sesionTokenAnterior !== tokenActual) {
          this.facturas = [];
          this.portalMostrarFinanzas = null;
          this.error = null;
          this.errorPortalFinanzas = null;
          this.errorVisibilidadFactura = null;
          if (sesion && tokenActual) {
            this.cargarDatos();
          }
        }
        this.sesionTokenAnterior = tokenActual;
      })
    );

    this.cargarDatos();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  async cargarDatos(): Promise<void> {
    try {
      this.cargando = true;
      this.error = null;
      this.cargandoPortalFinanzas = true;
      this.errorPortalFinanzas = null;

      const [org, facturas, clientes] = await Promise.all([
        this.facturasApi.obtenerOrganizacion().catch(() => null),
        this.facturasApi.listarFacturas(),
        this.clientesApi.listarClientes().catch(() => [])
      ]);

      if (org) {
        this.monedaOrg = org.moneda || 'PAB';
        this.nombreOrg = org.nombre || '';
        if (typeof org.portalMostrarFinanzas === 'boolean') {
          this.portalMostrarFinanzas = org.portalMostrarFinanzas;
        }
      }
      this.facturas = facturas;
      this.clientes = clientes;

      this.autoSeleccionarPeriodo();
    } catch (err: any) {
      this.error = err?.error?.error || 'No se pudieron cargar los datos de facturación';
    } finally {
      this.cargando = false;
      this.cargandoPortalFinanzas = false;
    }
  }

  async cargarConfiguracionPortalFinanzas(): Promise<void> {
    if (this.cargandoPortalFinanzas) return;
    try {
      this.cargandoPortalFinanzas = true;
      this.errorPortalFinanzas = null;
      const res = await this.facturasApi.consultarPortalFinanzas();
      this.portalMostrarFinanzas = res.portalMostrarFinanzas;
    } catch (err: any) {
      this.errorPortalFinanzas = err?.error?.error || 'No se pudo consultar la configuración del portal';
    } finally {
      this.cargandoPortalFinanzas = false;
    }
  }

  async cambiarPortalFinanzas(): Promise<void> {
    if (!this.puedeGestionarFacturas || this.portalMostrarFinanzas === null || this.cargandoPortalFinanzas) {
      return;
    }
    try {
      this.cargandoPortalFinanzas = true;
      this.errorPortalFinanzas = null;
      const res = await this.facturasApi.configurarPortalFinanzas(!this.portalMostrarFinanzas);
      this.portalMostrarFinanzas = res.portalMostrarFinanzas;
      this.mostrarToast(
        res.portalMostrarFinanzas
          ? 'Facturas habilitadas en el portal del cliente'
          : 'Facturas ocultadas en el portal del cliente'
      );
    } catch (err: any) {
      this.errorPortalFinanzas = err?.error?.error || 'No se pudo actualizar la configuración del portal';
    } finally {
      this.cargandoPortalFinanzas = false;
    }
  }

  async cambiarVisibilidadFactura(factura: FacturaApi, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.puedeGestionarFacturas || this.visibilidadFacturaEnCursoId || factura.estado === 'CANCELADA') {
      return;
    }

    const emitir = factura.estado === 'BORRADOR';
    const siguienteVisibilidad = emitir ? true : !factura.visibleEnPortal;

    try {
      this.visibilidadFacturaEnCursoId = factura.id;
      this.errorVisibilidadFactura = null;
      await this.facturasApi.actualizarFactura(factura.id, {
        ...(emitir ? { estado: 'ENVIADA' } : {}),
        visibleEnPortal: siguienteVisibilidad
      });
      this.mostrarToast(
        emitir
          ? `Factura ${factura.numero} emitida y compartida en portal`
          : siguienteVisibilidad
            ? `Factura ${factura.numero} compartida con el cliente`
            : `Factura ${factura.numero} retirada del portal`
      );
      if (this.modalDetalleAbierto && this.facturaDetalle?.id === factura.id) {
        this.facturaDetalle = this.facturas.find((f) => f.id === factura.id) || this.facturaDetalle;
      }
    } catch (err: any) {
      this.errorVisibilidadFactura = err?.error?.error || 'No se pudo actualizar la visibilidad en el portal';
    } finally {
      this.visibilidadFacturaEnCursoId = null;
    }
  }

  // --- Opciones de Periodos ---

  get periodosDisponibles(): PeriodoOpcion[] {
    const periodosMap = new Map<string, { anio: number; mes: number }>();

    const ahora = new Date();
    const claveActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    periodosMap.set(claveActual, { anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 });

    for (const f of this.facturas) {
      if (f.fechaEmision) {
        const fecha = new Date(f.fechaEmision);
        if (!isNaN(fecha.getTime())) {
          const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
          periodosMap.set(clave, { anio: fecha.getFullYear(), mes: fecha.getMonth() + 1 });
        }
      }
    }

    const lista: PeriodoOpcion[] = [{ clave: 'TODOS', etiqueta: 'Todo el historial' }];

    const sortedKeys = Array.from(periodosMap.entries()).sort((a, b) => {
      if (a[1].anio !== b[1].anio) return b[1].anio - a[1].anio;
      return b[1].mes - a[1].mes;
    });

    for (const [clave, { anio, mes }] of sortedKeys) {
      const fecha = new Date(anio, mes - 1, 1);
      const nombreMes = fecha.toLocaleString('es-PA', { month: 'long' });
      const etiqueta = `${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} ${anio}`;
      lista.push({ clave, etiqueta, anio, mes });
    }

    return lista;
  }

  get etiquetaPeriodoSeleccionado(): string {
    const encontrado = this.periodosDisponibles.find((p) => p.clave === this.periodoSeleccionado);
    return encontrado ? encontrado.etiqueta : 'Todo el historial';
  }

  seleccionarPeriodo(clave: string): void {
    this.periodoSeleccionado = clave;
    this.menuPeriodoAbierto = false;
  }

  toggleMenuPeriodo(): void {
    this.menuPeriodoAbierto = !this.menuPeriodoAbierto;
  }

  private autoSeleccionarPeriodo(): void {
    const ahora = new Date();
    const claveActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const tieneEnMesActual = this.facturas.some((f) => {
      const d = new Date(f.fechaEmision);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === claveActual;
    });

    if (tieneEnMesActual) {
      this.periodoSeleccionado = claveActual;
    } else if (this.facturas.length > 0) {
      const primera = this.facturas[0];
      const d = new Date(primera.fechaEmision);
      this.periodoSeleccionado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      this.periodoSeleccionado = claveActual;
    }
  }

  // --- Facturas filtradas por periodo y búsqueda ---

  get facturasPeriodo(): FacturaApi[] {
    if (this.periodoSeleccionado === 'TODOS') {
      return this.facturas;
    }
    return this.facturas.filter((f) => {
      if (!f.fechaEmision) return false;
      const d = new Date(f.fechaEmision);
      const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return clave === this.periodoSeleccionado;
    });
  }

  get facturasFiltradas(): FacturaApi[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.facturasPeriodo.filter((f) => {
      if (this.filtroEstado === 'PENDIENTES') {
        if (f.estado === 'PAGADA' || f.estado === 'CANCELADA') return false;
      } else if (this.filtroEstado === 'PAGADAS') {
        if (f.estado !== 'PAGADA') return false;
      }

      if (!q) return true;
      const numero = (f.numero || '').toLowerCase();
      const concepto = (f.concepto || '').toLowerCase();
      const clienteNombre = (f.cliente?.nombre || '').toLowerCase();
      const clienteEmpresa = (f.cliente?.empresa || '').toLowerCase();
      const proyectoNombre = (f.proyecto?.nombre || '').toLowerCase();

      return (
        numero.includes(q) ||
        concepto.includes(q) ||
        clienteNombre.includes(q) ||
        clienteEmpresa.includes(q) ||
        proyectoNombre.includes(q)
      );
    });
  }

  get conteoTodas(): number {
    return this.facturasPeriodo.length;
  }

  get conteoPendientes(): number {
    return this.facturasPeriodo.filter((f) => f.estado !== 'PAGADA' && f.estado !== 'CANCELADA').length;
  }

  get conteoPagadas(): number {
    return this.facturasPeriodo.filter((f) => f.estado === 'PAGADA').length;
  }

  // --- Cálculo de Totales con Precisión Monetaria (centavos) y Aislamiento de Monedas ---

  get resumenMonedas(): ResumenMonetario[] {
    const mapa = new Map<string, ResumenMonetario>();

    for (const f of this.facturasPeriodo) {
      const mon = (f.moneda || this.monedaOrg || 'PAB').toUpperCase();
      if (!mapa.has(mon)) {
        mapa.set(mon, {
          moneda: mon,
          simbolo: this.obtenerSimboloMoneda(mon),
          pendiente: 0,
          cobrado: 0,
          conteoPendientes: 0,
          conteoPagadas: 0
        });
      }
      const entry = mapa.get(mon)!;
      const montoCentavos = Math.round(Number(f.monto || 0) * 100);

      if (f.estado === 'PAGADA') {
        entry.cobrado += montoCentavos;
        entry.conteoPagadas++;
      } else if (f.estado !== 'CANCELADA') {
        const pendienteCentavos =
          f.montoPendiente !== undefined
            ? Math.round(Number(f.montoPendiente) * 100)
            : montoCentavos;
        const pagadoCentavos =
          f.totalPagado !== undefined
            ? Math.round(Number(f.totalPagado) * 100)
            : Math.max(0, montoCentavos - pendienteCentavos);
        entry.pendiente += pendienteCentavos;
        entry.cobrado += pagadoCentavos;
        entry.conteoPendientes++;
      }
    }

    if (mapa.size === 0) {
      const mon = (this.monedaOrg || 'PAB').toUpperCase();
      mapa.set(mon, {
        moneda: mon,
        simbolo: this.obtenerSimboloMoneda(mon),
        pendiente: 0,
        cobrado: 0,
        conteoPendientes: 0,
        conteoPagadas: 0
      });
    }

    return Array.from(mapa.values()).map((r) => ({
      ...r,
      pendiente: r.pendiente / 100,
      cobrado: r.cobrado / 100
    }));
  }

  get resumenPrincipal(): ResumenMonetario {
    const orgMon = (this.monedaOrg || 'PAB').toUpperCase();
    const encontrada = this.resumenMonedas.find((r) => r.moneda === orgMon);
    return encontrada || this.resumenMonedas[0];
  }

  get tieneMultiplesMonedas(): boolean {
    return this.resumenMonedas.length > 1;
  }

  // --- Formateo de Texto y Moneda ---

  obtenerSimboloMoneda(moneda: string): string {
    const m = (moneda || '').toUpperCase();
    if (m === 'PAB') return 'B/.';
    if (m === 'USD') return '$';
    if (m === 'EUR') return '€';
    return m;
  }

  formatearMonto(monto: number | string | undefined | null, moneda?: string): string {
    const num = Number(monto || 0);
    const m = (moneda || this.monedaOrg || 'PAB').toUpperCase();
    const simbolo = this.obtenerSimboloMoneda(m);
    const formateado = num.toLocaleString('es-PA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${simbolo} ${formateado}`;
  }

  formatearFechaCorta(fechaStr?: string | null): string {
    if (!fechaStr) return '—';
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return fechaStr;
    const dia = d.getDate().toString().padStart(2, '0');
    const mes = d.toLocaleString('es-PA', { month: 'short' }).replace('.', '');
    const anio = d.getFullYear();
    return `${dia} ${mes} ${anio}`;
  }

  formatearVencimiento(fechaStr?: string | null): string {
    if (!fechaStr) return 'Sin vencimiento';
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return fechaStr;
    const dia = d.getDate().toString().padStart(2, '0');
    const mes = d.toLocaleString('es-PA', { month: 'short' }).replace('.', '');
    return `${dia} ${mes}`;
  }

  obtenerTextoMonedaHeader(): string {
    const m = (this.monedaOrg || 'PAB').toUpperCase();
    if (m === 'PAB') return 'PAB / USD';
    return m;
  }

  obtenerSubtextoMonedaHeader(): string {
    const m = (this.monedaOrg || 'PAB').toUpperCase();
    if (m === 'PAB') return 'Panamá';
    return this.nombreOrg || 'Oficial';
  }

  obtenerSaldoPendiente(factura: FacturaApi | null): number {
    if (!factura) return 0;
    if (factura.montoPendiente !== undefined && factura.montoPendiente !== null) {
      return Number(factura.montoPendiente);
    }
    return Number(factura.monto || 0);
  }

  // --- Modal Nueva Factura ---

  abrirModalNuevaFactura(): void {
    this.formFactura = this.obtenerFormFacturaVacio();
    this.formFactura.moneda = this.monedaOrg || 'PAB';
    if (this.clientes.length > 0) {
      this.formFactura.clienteId = this.clientes[0].id;
      this.actualizarProyectosCliente(this.clientes[0].id);
    }
    this.errorModalFactura = null;
    this.modalNuevaFacturaAbierto = true;
  }

  cerrarModalNuevaFactura(): void {
    this.modalNuevaFacturaAbierto = false;
    this.errorModalFactura = null;
  }

  onClienteChange(clienteId: string): void {
    this.formFactura.proyectoId = '';
    this.actualizarProyectosCliente(clienteId);
  }

  private actualizarProyectosCliente(clienteId: string): void {
    const cliente = this.clientes.find((c) => c.id === clienteId);
    this.proyectosCliente = cliente?.proyectos || [];
  }

  establecerVencimientoDias(dias: number): void {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    this.formFactura.fechaVencimiento = fecha.toISOString().split('T')[0];
  }

  async guardarNuevaFactura(): Promise<void> {
    if (!this.formFactura.clienteId) {
      this.errorModalFactura = 'Debe seleccionar un cliente';
      return;
    }
    if (!this.formFactura.concepto.trim()) {
      this.errorModalFactura = 'El concepto de la factura es obligatorio';
      return;
    }
    if (!this.formFactura.monto || this.formFactura.monto <= 0) {
      this.errorModalFactura = 'El monto debe ser un número positivo';
      return;
    }

    try {
      this.guardandoFactura = true;
      this.errorModalFactura = null;

      const numeroLimpio = this.formFactura.numero.trim();
      const payload: CrearFacturaInput = {
        ...(numeroLimpio ? { numero: numeroLimpio } : {}),
        clienteId: this.formFactura.clienteId,
        proyectoId: this.formFactura.proyectoId || null,
        concepto: this.formFactura.concepto.trim(),
        monto: Number(this.formFactura.monto),
        moneda: this.formFactura.moneda || this.monedaOrg || 'PAB',
        estado: this.formFactura.estado || 'ENVIADA',
        visibleEnPortal: this.formFactura.visibleEnPortal,
        fechaEmision: this.formFactura.fechaEmision || this.obtenerFechaHoyIso(),
        fechaVencimiento: this.formFactura.fechaVencimiento || null,
        notas: this.formFactura.notas.trim() || null
      };

      const creada = await this.facturasApi.crearFactura(payload);
      this.mostrarToast(`Factura ${creada.numero} creada con éxito`);
      this.cerrarModalNuevaFactura();
    } catch (err: any) {
      this.errorModalFactura = err?.error?.error || 'No se pudo crear la factura';
    } finally {
      this.guardandoFactura = false;
    }
  }

  private obtenerFormFacturaVacio() {
    return {
      numero: '',
      clienteId: '',
      proyectoId: '',
      concepto: '',
      monto: null,
      moneda: 'PAB',
      fechaEmision: this.obtenerFechaHoyIso(),
      fechaVencimiento: this.obtenerFechaVencimientoPredeterminada(15),
      estado: 'ENVIADA' as EstadoFacturaApi,
      visibleEnPortal: false,
      notas: ''
    };
  }

  // --- Modal Registrar Pago ---

  abrirModalRegistrarPago(factura: FacturaApi, event?: Event): void {
    if (event) event.stopPropagation();
    const saldo = this.obtenerSaldoPendiente(factura);
    this.facturaSeleccionadaPago = factura;
    this.formPago = {
      monto: saldo > 0 ? saldo : Number(factura.monto || 0),
      moneda: (factura.moneda || this.monedaOrg || 'PAB').toUpperCase(),
      metodo: 'TRANSFERENCIA',
      referencia: '',
      notas: ''
    };
    this.errorModalPago = null;
    this.modalPagoAbierto = true;
  }

  cerrarModalRegistrarPago(): void {
    this.modalPagoAbierto = false;
    this.facturaSeleccionadaPago = null;
    this.errorModalPago = null;
  }

  async confirmarRegistroPago(): Promise<void> {
    if (!this.facturaSeleccionadaPago) return;

    const textoMonto = String(this.formPago.monto ?? '').trim();
    const montoAbono = Number(textoMonto);
    const saldoPendiente = this.obtenerSaldoPendiente(this.facturaSeleccionadaPago);
    if (!Number.isFinite(montoAbono) || montoAbono <= 0) {
      this.errorModalPago = 'El monto a abonar debe ser mayor a cero';
      return;
    }
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(textoMonto)) {
      this.errorModalPago = 'Introduce un monto positivo con máximo dos decimales.';
      return;
    }
    if (Math.round(montoAbono * 100) > Math.round(saldoPendiente * 100)) {
      this.errorModalPago = `El abono supera el saldo pendiente (${this.formatearMonto(saldoPendiente, this.formPago.moneda)})`;
      return;
    }

    const facturaId = this.facturaSeleccionadaPago.id;
    const facturaNumero = this.facturaSeleccionadaPago.numero;

    try {
      this.guardandoPago = true;
      this.errorModalPago = null;

      const resultado = await this.facturasApi.registrarPago(facturaId, {
        monto: montoAbono,
        moneda: this.formPago.moneda,
        metodo: this.formPago.metodo || 'TRANSFERENCIA',
        referencia: this.formPago.referencia.trim() || null,
        notas: this.formPago.notas.trim() || null
      });

      this.mostrarToast(
        resultado.saldoRestante <= 0
          ? `Factura ${facturaNumero} liquidada con éxito`
          : `Abono registrado en ${facturaNumero} · Saldo: ${this.formatearMonto(resultado.saldoRestante, this.formPago.moneda)}`
      );
      this.cerrarModalRegistrarPago();

      if (this.modalDetalleAbierto && this.facturaDetalle?.id === facturaId) {
        this.cargarDetalleFactura(facturaId);
      }
    } catch (err: any) {
      this.errorModalPago = err?.error?.error || 'No se pudo registrar el pago';
    } finally {
      this.guardandoPago = false;
    }
  }

  // --- Modal Detalle de Factura ---

  verDetalleFactura(factura: FacturaApi): void {
    this.facturaDetalle = factura;
    this.modalDetalleAbierto = true;
    this.cargarDetalleFactura(factura.id);
  }

  private async cargarDetalleFactura(id: string): Promise<void> {
    try {
      this.cargandoDetalle = true;
      const detalle = await this.facturasApi.consultarFactura(id);
      if (this.modalDetalleAbierto && this.facturaDetalle?.id === id) {
        this.facturaDetalle = detalle;
      }
    } catch {
      // Mantiene los datos de lista si falla el refresco de detalle
    } finally {
      this.cargandoDetalle = false;
    }
  }

  cerrarDetalleFactura(): void {
    this.modalDetalleAbierto = false;
    this.facturaDetalle = null;
    this.cargandoDetalle = false;
  }

  async eliminarFactura(factura: FacturaApi): Promise<void> {
    if (!confirm(`¿Estás seguro de eliminar la factura ${factura.numero}? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await this.facturasApi.eliminarFactura(factura.id);
      this.mostrarToast(`Factura ${factura.numero} eliminada`);
      this.cerrarDetalleFactura();
    } catch (err: any) {
      this.mostrarToast(err?.error?.error || 'Error al eliminar la factura');
    }
  }

  // --- Exportar a CSV ---

  exportarCSV(): void {
    const listado = this.facturasFiltradas;
    if (listado.length === 0) {
      this.mostrarToast('No hay facturas para exportar con los filtros actuales');
      return;
    }

    const encabezados = [
      'Factura',
      'Fecha Emisión',
      'Concepto',
      'Cliente',
      'Empresa',
      'Proyecto',
      'Vencimiento',
      'Monto',
      'Saldo Pendiente',
      'Moneda',
      'Estado',
      'Visible en Portal',
      'Fecha Pagada',
      'Notas'
    ];

    const filas = listado.map((f) => [
      `"${(f.numero || '').replace(/"/g, '""')}"`,
      `"${f.fechaEmision || ''}"`,
      `"${(f.concepto || '').replace(/"/g, '""')}"`,
      `"${(f.cliente?.nombre || '').replace(/"/g, '""')}"`,
      `"${(f.cliente?.empresa || '').replace(/"/g, '""')}"`,
      `"${(f.proyecto?.nombre || '').replace(/"/g, '""')}"`,
      `"${f.fechaVencimiento || ''}"`,
      Number(f.monto || 0).toFixed(2),
      this.obtenerSaldoPendiente(f).toFixed(2),
      `"${f.moneda || 'PAB'}"`,
      `"${f.estado || ''}"`,
      `"${f.visibleEnPortal ? 'Sí' : 'No'}"`,
      `"${f.pagadaEn || ''}"`,
      `"${(f.notas || '').replace(/"/g, '""')}"`
    ]);

    const contenidoCSV = '\uFEFF' + [encabezados.join(','), ...filas.map((row) => row.join(','))].join('\r\n');
    const blob = new Blob([contenidoCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fecha = new Date().toISOString().split('T')[0];
    a.download = `facturas-equinox-${this.periodoSeleccionado}-${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.mostrarToast(`Se exportaron ${listado.length} facturas a CSV`);
  }

  // --- Utilidades Internas ---

  obtenerFechaHoyIso(): string {
    return new Date().toISOString().split('T')[0];
  }

  obtenerFechaVencimientoPredeterminada(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().split('T')[0];
  }

  mostrarToast(mensaje: string): void {
    this.toastMensaje = mensaje;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMensaje = null;
    }, 3500);
  }
}
