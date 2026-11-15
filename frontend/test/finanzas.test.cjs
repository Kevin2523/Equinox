const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { BehaviorSubject } = require('rxjs');

let UiStateService;
global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };

before(async () => {
  await import('../node_modules/@angular/compiler/fesm2022/compiler.mjs');
  ({ UiStateService } = await import('../src/state/ui-state.service.ts'));
});

function crearEstado(facturasApiMock, sesionInicial = { tipoAcceso: 'ORGANIZACION' }) {
  const estado = Object.create(UiStateService.prototype);
  estado.facturasReales = [];
  estado.totalesFacturas = null;
  estado.cargandoFacturas = false;
  estado.errorFacturas = '';
  estado.invoiceFilter = 'TODAS';
  estado.query = '';
  estado.createModalOpen = false;
  estado.activeCreateType = null;
  estado.crearLoading = false;
  estado.createError = '';
  estado.nuevaFactura = { clienteId: 'c1', proyectoId: 'p1', concepto: 'Diseño web', monto: 1200, fechaVencimiento: '' };
  estado.clientes = [{ id: 'c1', nombre: 'Cliente Uno' }];
  estado.proyectos = [{ id: 'p1', nombre: 'Proyecto Uno' }];
  estado.pagoModalOpen = false;
  estado.facturaSeleccionadaPago = null;
  estado.nuevoPago = { monto: 0, moneda: 'PAB', metodo: 'TRANSFERENCIA', referencia: '', notas: '' };
  estado.pagoLoading = false;
  estado.pagoError = '';

  const sesion$ = new BehaviorSubject(sesionInicial ? { contexto: sesionInicial, usuario: { id: 'u1' } } : null);
  estado.auth = {
    sesion$,
    get token() { return sesion$.value ? 'fake-token' : null; },
    get sesion() { return sesion$.value; },
  };
  estado.facturasApi = facturasApiMock;
  estado.equinox = {
    mostrarToast: () => {},
    todasLasFacturas: () => [{ id: 'mock-1', numero: 'INV-MOCK', concepto: 'Falso', monto: 999, estado: 'PENDIENTE' }],
    crearFactura: () => { throw new Error('No debe usarse fallback a equinox.crearFactura'); },
    marcarFacturaPagada: () => { throw new Error('No debe usarse fallback a equinox.marcarFacturaPagada'); },
  };
  return estado;
}

test('cuando la API falla al cargar facturas, no muestra facturas simuladas, expone error recuperable y permite reintentar', async () => {
  let intentos = 0;
  const api = {
    listarFacturas: async () => {
      intentos++;
      if (intentos === 1) throw new Error('Fallo de red');
      return [{ id: 'f-real-1', numero: 'INV-0001', concepto: 'Real', monto: 500, montoPendiente: 500, estado: 'ENVIADA', moneda: 'PAB', clienteId: 'c1', fechaEmision: '2026-11-01', fechaVencimiento: null, pagadaEn: null }];
    },
    consultarTotales: async () => ({ totalesPorMoneda: [{ moneda: 'PAB', totalPorCobrar: 500, totalCobrado: 0, facturasEmitidas: 1, facturasPendientes: 1, facturasPagadas: 0 }] })
  };

  const estado = crearEstado(api);
  await estado.cargarFacturas();

  assert.equal(estado.cargandoFacturas, false);
  assert.match(estado.errorFacturas, /No se pudieron cargar/);
  // No debe mostrar facturas simuladas del equinoxService
  assert.deepEqual(estado.allInvoices, []);

  // Reintento exitoso
  await estado.cargarFacturas();
  assert.equal(estado.errorFacturas, '');
  assert.equal(estado.allInvoices.length, 1);
  assert.equal(estado.allInvoices[0].numero, 'INV-0001');
});

test('el formulario rápido de factura conserva borrador y error al fallar la API, y no confirma en memoria', async () => {
  let intentosCrear = 0;
  const llamadas = [];
  const api = {
    crearFactura: async (datos) => {
      llamadas.push(datos);
      intentosCrear++;
      if (intentosCrear === 1) {
        const err = new Error('Error validacion');
        err.status = 422;
        throw err;
      }
      return { id: 'f-nueva', numero: 'INV-0002', ...datos };
    },
    listarFacturas: async () => [],
    consultarTotales: async () => ({ totalesPorMoneda: [] }),
  };

  const estado = crearEstado(api);
  estado.openQuickCreate('Factura');
  estado.nuevaFactura = { clienteId: 'c1', proyectoId: 'p1', concepto: 'Branding 2026', monto: 850, fechaVencimiento: '2026-12-01' };

  await estado.submitCreate();

  assert.equal(estado.createModalOpen, true, 'El modal debe seguir abierto tras error');
  assert.match(estado.createError, /Revisa los datos/);
  assert.equal(estado.nuevaFactura.concepto, 'Branding 2026', 'Conserva el borrador para reintentar');
  assert.equal(estado.nuevaFactura.monto, 850);

  // Segundo intento exitoso
  await estado.submitCreate();
  assert.equal(estado.createModalOpen, false);
  assert.equal(estado.createError, '');
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[1].concepto, 'Branding 2026');
});

test('crear factura sin proyecto no adjunta el proyecto previamente seleccionado', async () => {
  let enviado;
  const api = {
    crearFactura: async (datos) => { enviado = datos; return { id: 'nueva', ...datos }; },
    listarFacturas: async () => [],
    consultarTotales: async () => ({ totalesPorMoneda: [] }),
  };
  const estado = crearEstado(api);
  estado.selectedProject = { id: 'proyecto-de-otro-cliente', clienteId: 'otro-cliente' };
  estado.nuevaFactura = { clienteId: 'c1', proyectoId: '', concepto: 'Jose', monto: 1200, fechaVencimiento: '2026-11-18' };
  estado.activeCreateType = 'Factura';
  await estado.submitCreate();
  assert.equal(enviado.proyectoId, null);
});

test('abrir factura desde Finanzas descarta el proyecto seleccionado de demostración', async () => {
  let enviado;
  const estado = crearEstado({
    crearFactura: async (datos) => { enviado = datos; return { id: 'nueva', ...datos }; },
    listarFacturas: async () => [],
    consultarTotales: async () => ({ totalesPorMoneda: [] }),
  });
  estado.selectedProject = { id: 'proyecto-demo', clienteId: 'cliente-demo' };
  estado.proyectos = [];
  estado.nuevaFactura = { clienteId: '', proyectoId: '', concepto: 'Servicio', monto: 1200, fechaVencimiento: '' };
  estado.openQuickCreate('Factura');
  assert.equal(estado.nuevaFactura.clienteId, 'c1');
  assert.equal(estado.nuevaFactura.proyectoId, '');
  await estado.submitCreate();
  assert.equal(enviado.proyectoId, null);
});

test('un rechazo 422 muestra el detalle de validación en vez de un mensaje genérico', async () => {
  const api = { crearFactura: async () => { throw { status: 422, error: { detalles: [{ path: ['proyectoId'], message: 'Invalid uuid' }] } }; } };
  const estado = crearEstado(api);
  estado.activeCreateType = 'Factura';
  await estado.submitCreate();
  assert.match(estado.createError, /proyectoId/);
});

test('registrar pago permite abono parcial con moneda y método, no liquida en memoria ante fallo y confirma tras persistir', async () => {
  let intentosPago = 0;
  const llamadasPago = [];
  const api = {
    registrarPago: async (id, datos) => {
      llamadasPago.push({ id, datos });
      intentosPago++;
      if (intentosPago === 1) throw new Error('Fallo de red en pago');
      return {
        pago: { id: 'pago-1', facturaId: id, monto: datos.monto, moneda: datos.moneda, metodo: datos.metodo, creadoEn: new Date().toISOString() },
        factura: { id, estado: 'ENVIADA', monto: 1000, montoPendiente: 600 },
        saldoRestante: 600
      };
    },
    listarFacturas: async () => [{ id: 'f1', numero: 'INV-0001', concepto: 'Servicios', monto: 1000, montoPendiente: 600, estado: 'ENVIADA', moneda: 'PAB', clienteId: 'c1' }],
    consultarTotales: async () => ({ totalesPorMoneda: [{ moneda: 'PAB', totalPorCobrar: 600, totalCobrado: 400, facturasEmitidas: 1, facturasPendientes: 1, facturasPagadas: 0 }] })
  };

  const estado = crearEstado(api);
  const factura = {
    id: 'f1',
    numero: 'INV-0001',
    concepto: 'Servicios',
    clienteId: 'c1',
    clienteNombre: 'Cliente Uno',
    monto: 1000,
    montoPendiente: 1000,
    moneda: 'PAB',
    estado: 'ENVIADA',
    fechaEmision: '2026-11-01',
    fechaVencimiento: '2026-11-30'
  };

  // Abrir modal de pago para abono parcial
  estado.abrirModalPago(factura);
  assert.equal(estado.pagoModalOpen, true);
  assert.equal(estado.facturaSeleccionadaPago?.id, 'f1');
  assert.equal(estado.nuevoPago.monto, 1000);

  // Modificar a pago parcial de 400, método EFECTIVO
  estado.nuevoPago.monto = 400;
  estado.nuevoPago.metodo = 'EFECTIVO';
  estado.nuevoPago.notas = 'Anticipo en efectivo';

  // Intento 1: Falla la API
  await estado.confirmarPago();
  assert.equal(estado.pagoModalOpen, true, 'El modal de pago debe permanecer abierto');
  assert.match(estado.pagoError, /No se pudo registrar el pago/);
  assert.equal(estado.nuevoPago.monto, 400, 'Conserva el monto ingresado');
  assert.equal(estado.nuevoPago.metodo, 'EFECTIVO', 'Conserva el método seleccionado');

  // Intento 2: Éxito en la API
  await estado.confirmarPago();
  assert.equal(estado.pagoModalOpen, false, 'Modal cerrado tras confirmación');
  assert.equal(estado.pagoError, '');
  assert.equal(llamadasPago.length, 2);
  assert.deepEqual(llamadasPago[1].datos, {
    monto: 400,
    moneda: 'PAB',
    metodo: 'EFECTIVO',
    referencia: null,
    notas: 'Anticipo en efectivo'
  });
});

test('totales por moneda no suma divisas distintas en un único monto', async () => {
  const api = {
    listarFacturas: async () => [],
    consultarTotales: async () => ({
      totalesPorMoneda: [
        { moneda: 'PAB', totalPorCobrar: 1200, totalCobrado: 300, facturasEmitidas: 2, facturasPendientes: 1, facturasPagadas: 1 },
        { moneda: 'USD', totalPorCobrar: 800, totalCobrado: 400, facturasEmitidas: 2, facturasPendientes: 1, facturasPagadas: 1 }
      ]
    })
  };

  const estado = crearEstado(api);
  await estado.cargarFacturas();

  assert.equal(estado.totalesPorMoneda.length, 2);
  assert.equal('totalPorCobrar' in estado, false);
  assert.equal('totalCobrado' in estado, false);
  const pab = estado.totalesPorMoneda.find((t) => t.moneda === 'PAB');
  const usd = estado.totalesPorMoneda.find((t) => t.moneda === 'USD');

  assert.equal(pab.totalPorCobrar, 1200);
  assert.equal(pab.totalCobrado, 300);
  assert.equal(usd.totalPorCobrar, 800);
  assert.equal(usd.totalCobrado, 400);

  // Verificar que la presentación no mezcla ambas divisas en una sola suma
  assert.notEqual(pab.totalPorCobrar + usd.totalPorCobrar, 1200);
});

test('compartir una factura pagada usa el PATCH real y refresca la lista; un fallo conserva su privacidad', async () => {
  const cambios = [];
  let fallar = true;
  const estado = crearEstado({
    actualizarFactura: async (id, datos) => {
      cambios.push({ id, datos });
      if (fallar) throw { status: 503 };
      return { id, ...datos };
    },
    listarFacturas: async () => [{ id: 'f1', clienteId: 'c1', numero: 'INV-1', concepto: 'Servicio', monto: 100, moneda: 'PAB', estado: 'PAGADA', visibleEnPortal: !fallar }],
    consultarTotales: async () => ({ totalesPorMoneda: [] }),
  });
  estado.facturasReales = [{ id: 'f1', estado: 'PAGADA', visibleEnPortal: false }];
  await estado.cambiarVisibilidadFactura(estado.facturasReales[0]);
  assert.equal(estado.facturasReales[0].visibleEnPortal, false);
  assert.match(estado.errorVisibilidadFactura, /No se pudo/);
  fallar = false;
  await estado.cambiarVisibilidadFactura(estado.facturasReales[0]);
  assert.deepEqual(cambios[1], { id: 'f1', datos: { visibleEnPortal: true } });
  assert.equal(estado.facturasReales[0].visibleEnPortal, true);
});

test('una factura nueva solo se emite y comparte tras marcarlo explícitamente', async () => {
  let enviado;
  const estado = crearEstado({
    crearFactura: async (datos) => { enviado = datos; return { id: 'f2', ...datos }; },
    listarFacturas: async () => [],
    consultarTotales: async () => ({ totalesPorMoneda: [] }),
  });
  estado.activeCreateType = 'Factura';
  estado.compartirNuevaFactura = true;
  await estado.submitCreate();
  assert.equal(enviado.estado, 'ENVIADA');
  assert.equal(enviado.visibleEnPortal, true);
  assert.equal(estado.compartirNuevaFactura, false);
});
