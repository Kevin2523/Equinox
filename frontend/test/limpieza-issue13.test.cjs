const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BehaviorSubject, Subject } = require('rxjs');

let UiStateService;
let EquinoxService;
let PortalComponent;
const diferida = () => {
  let resolve, reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
};
function estadoConTransiciones() {
  const sesion$ = new BehaviorSubject(null);
  let token = null;
  const equinox = new EquinoxService();
  const clientesApi = {
    clientes$: new BehaviorSubject([]), proyectos$: new BehaviorSubject([]),
    proyectoSeleccionado$: new BehaviorSubject(null)
  };
  const facturas = [];
  const portales = [];
  const organizaciones = [];
  const estado = new UiStateService(
    equinox, clientesApi, { events: new Subject() }, {},
    { sesion$, get token() { return token; }, get sesion() { return sesion$.value; } },
    { listarFacturas: () => { const d = diferida(); facturas.push(d); return d.promise; },
      consultarTotales: async () => ({ totalesPorMoneda: [] }),
      consultarPortalFinanzas: () => { const d = diferida(); portales.push(d); return d.promise; } },
    { consultar: () => { const d = diferida(); organizaciones.push(d); return d.promise; } }
  );
  return {
    estado, equinox, facturas, portales, organizaciones,
    cambiar(id) {
      token = id ? `token-${id}` : null;
      sesion$.next(id ? { contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: id, rolOrganizacion: 'PROPIETARIO' }, usuario: { id: 'u1', nombre: 'Usuario' } } : null);
    }
  };
}
const facturaPrueba = (numero) => ({ id: numero, numero, concepto: 'Prueba', monto: 10, moneda: 'PAB', estado: 'ENVIADA', clienteId: 'c1', visibleEnPortal: true });
async function cargarPrimeraOrganizacion(flujo) {
  flujo.cambiar('org-1');
  flujo.facturas[0].resolve([facturaPrueba('INV-ORG1')]);
  flujo.portales[0].resolve({ portalMostrarFinanzas: true });
  flujo.organizaciones[0].resolve({ id: 'org-1', nombre: 'Marca Org 1', colorPrimario: '#123456' });
  await Promise.resolve(); await Promise.resolve();
}

test('transición inmediata: cerrar sesión vacía facturas, totales, marca y visibilidad', async () => {
  const flujo = estadoConTransiciones();
  await cargarPrimeraOrganizacion(flujo);
  assert.equal(flujo.estado.configuracion.nombreEstudio, 'Marca Org 1');
  assert.equal(flujo.estado.facturasReales[0].numero, 'INV-ORG1');
  flujo.cambiar(null);
  assert.deepEqual(flujo.estado.facturasReales, []);
  assert.equal(flujo.estado.totalesFacturas, null);
  assert.equal(flujo.estado.configuracion.nombreEstudio, '');
  assert.equal(flujo.equinox.configuracion.nombreEstudio, '');
  assert.equal(flujo.estado.portalMostrarFinanzas, null);
  assert.equal(flujo.estado.cargandoConfiguracion, false);
});

test('transición inmediata: otra organización y fallo de carga nunca muestran datos previos', async () => {
  const flujo = estadoConTransiciones();
  await cargarPrimeraOrganizacion(flujo);
  flujo.cambiar('org-2');
  assert.deepEqual(flujo.estado.facturasReales, []);
  assert.equal(flujo.estado.totalesFacturas, null);
  assert.equal(flujo.estado.configuracion.nombreEstudio, '');
  assert.equal(flujo.estado.portalMostrarFinanzas, null);
  assert.equal(flujo.estado.cargandoFacturas, true);
  assert.equal(flujo.estado.cargandoConfiguracion, true);
  flujo.facturas[1].reject(new Error('red'));
  flujo.portales[1].reject(new Error('red'));
  flujo.organizaciones[1].reject(new Error('red'));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(flujo.estado.facturasReales, []);
  assert.equal(flujo.estado.configuracion.nombreEstudio, '');
  assert.equal(flujo.estado.portalMostrarFinanzas, null);
  assert.ok(flujo.estado.errorConfiguracion);
  flujo.facturas[0].resolve([facturaPrueba('INV-TARDIA')]);
  assert.deepEqual(flujo.estado.facturasReales, []);
});

test('una actualización antigua de marca o visibilidad no publica estado en la sesión nueva', async () => {
  const flujo = estadoConTransiciones();
  await cargarPrimeraOrganizacion(flujo);
  const guardar = diferida();
  const visibilidad = diferida();
  flujo.estado.organizacionApi.actualizar = () => guardar.promise;
  flujo.estado.facturasApi.configurarPortalFinanzas = () => visibilidad.promise;
  const guardadoAnterior = flujo.estado.saveConfig();
  const cambioAnterior = flujo.estado.cambiarPortalFinanzas();
  flujo.cambiar('org-2');
  guardar.resolve({ id: 'org-1' });
  visibilidad.resolve({ portalMostrarFinanzas: true });
  await Promise.all([guardadoAnterior, cambioAnterior]);
  assert.equal(flujo.estado.configuracion.nombreEstudio, '');
  assert.equal(flujo.estado.portalMostrarFinanzas, null);
  assert.equal(flujo.estado.exitoConfiguracion, '');
  assert.equal(flujo.estado.errorPortalFinanzas, '');
  assert.equal(flujo.estado.cargandoConfiguracion, true);
  assert.equal(flujo.estado.cargandoPortalFinanzas, true);
  flujo.facturas[1].resolve([]);
  flujo.portales[1].resolve({ portalMostrarFinanzas: false });
  flujo.organizaciones[1].resolve({ id: 'org-2', nombre: 'Marca Org 2' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(flujo.estado.configuracion.nombreEstudio, 'Marca Org 2');
  assert.equal(flujo.estado.portalMostrarFinanzas, false);
});
global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };

before(async () => {
  await import('../node_modules/@angular/compiler/fesm2022/compiler.mjs');
  ({ UiStateService } = await import('../src/state/ui-state.service.ts'));
  ({ EquinoxService } = await import('../src/services/equinox.service.ts'));
  ({ PortalComponent } = await import('../src/pages/portal.component.ts'));
});

test('criterio 5: no existe uso ni persistencia de datos de negocio en localStorage', () => {
  // Verificar en el código fuente de frontend/src que no se use localStorage
  const dirSrc = path.resolve(__dirname, '../src');
  function buscarLocalStorage(dir) {
    const archivos = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of archivos) {
      const fullPath = path.join(dir, f.name);
      if (f.isDirectory()) {
        buscarLocalStorage(fullPath);
      } else if (f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.html'))) {
        const contenido = fs.readFileSync(fullPath, 'utf8');
        assert.ok(
          !contenido.toLowerCase().includes('localstorage'),
          `Se encontró referencia a localStorage en ${fullPath}`
        );
      }
    }
  }
  buscarLocalStorage(dirSrc);

  // Instanciar EquinoxService y comprobar que no tiene datos maestros demo
  const eq = new EquinoxService();
  assert.deepEqual(eq.clientes, []);
  assert.deepEqual(eq.proyectos, []);
  assert.deepEqual(eq.notificaciones, []);
  assert.equal(eq.configuracion.nombreEstudio, '');
  assert.equal(eq.configuracion.nombreFreelancer, '');
});

test('criterio 4: el portal y configuracion no contienen identidades fijas como Ana Rodríguez o Café Unido', () => {
  const portalHtml = fs.readFileSync(path.resolve(__dirname, '../src/pages/portal.component.html'), 'utf8');
  const configHtml = fs.readFileSync(path.resolve(__dirname, '../src/pages/configuracion.component.html'), 'utf8');

  assert.ok(!portalHtml.includes('Ana Rodríguez'), 'portal.component.html no debe incluir Ana Rodríguez');
  assert.ok(!portalHtml.includes('Café Unido'), 'portal.component.html no debe incluir Café Unido');
  assert.ok(!configHtml.includes('Café Unido'), 'configuracion.component.html no debe incluir Café Unido');
});

test('criterio 3: saveConfig respeta permisos de PROPIETARIO y consume la API real', async () => {
  let patchLlamado = false;
  let datosEnviados = null;

  const orgApiMock = {
    actualizar: async (datos) => {
      patchLlamado = true;
      datosEnviados = datos;
      return { ...datos, id: 'org-1' };
    },
    consultar: async () => ({ id: 'org-1', nombre: 'Estudio Real', moneda: 'PAB' })
  };

  // 1. Caso COLABORADOR -> Debe bloquearse sin llamar a la API
  const sesionColab$ = new BehaviorSubject({
    contexto: { tipoAcceso: 'ORGANIZACION', rolOrganizacion: 'COLABORADOR' },
    usuario: { id: 'u1', nombre: 'Colab' }
  });

  const estadoColab = Object.create(UiStateService.prototype);
  estadoColab.auth = {
    sesion$: sesionColab$,
    get token() { return 'token-colab'; },
    get sesion() { return sesionColab$.value; }
  };
  estadoColab.organizacionApi = orgApiMock;
  estadoColab.configuracion = { nombreEstudio: 'Nuevo Nombre', moneda: 'PAB' };
  estadoColab.guardandoConfiguracion = false;
  estadoColab.errorConfiguracion = '';

  await estadoColab.saveConfig();
  assert.equal(patchLlamado, false, 'No debe invocar API si el rol es COLABORADOR');
  assert.ok(estadoColab.errorConfiguracion.includes('Solo los propietarios'));

  // 2. Caso PROPIETARIO -> Debe enviar datos reales y confirmar
  const sesionDueno$ = new BehaviorSubject({
    contexto: { tipoAcceso: 'ORGANIZACION', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u2', nombre: 'Dueño' }
  });

  const toastMensajes = [];
  const estadoDueno = Object.create(UiStateService.prototype);
  estadoDueno.auth = {
    sesion$: sesionDueno$,
    get token() { return 'token-dueno'; },
    get sesion() { return sesionDueno$.value; }
  };
  estadoDueno.organizacionApi = orgApiMock;
  estadoDueno.configuracion = {
    nombreEstudio: 'Estudio Creativo Panamá',
    mensajeBienvenida: 'Bienvenido a nuestro estudio.',
    moneda: 'USD',
    ruc: '123456-1',
    telefono: '6000-0000',
    correo: 'hola@estudio.test',
    colorPrimario: '#3568f6',
    colorSecundario: '#0f172a',
    tipografia: 'DM Sans'
  };
  estadoDueno.equinox = {
    actualizarConfiguracion: () => {},
    mostrarToast: (m) => toastMensajes.push(m)
  };
  estadoDueno.guardandoConfiguracion = false;
  estadoDueno.errorConfiguracion = '';
  estadoDueno.exitoConfiguracion = '';

  await estadoDueno.saveConfig();
  assert.equal(patchLlamado, true, 'Debe invocar API de organización');
  assert.equal(datosEnviados.nombre, 'Estudio Creativo Panamá');
  assert.equal(datosEnviados.moneda, 'USD');
  assert.equal(estadoDueno.exitoConfiguracion, 'Configuración guardada correctamente.');
  assert.ok(toastMensajes.includes('Configuración guardada con éxito'));
});

test('criterio 2 y 6: portal preview usa proyectos reales, descarga real y estados vacíos', async () => {
  let descargaInvocada = false;
  let proyectoDescargaId = null;

  const archivosApiMock = {
    guardarDescarga: async (pId, archivo) => {
      descargaInvocada = true;
      proyectoDescargaId = pId;
    }
  };

  const portal = Object.create(PortalComponent.prototype);
  portal.hitos = [];
  portal.archivos = [];
  portal.archivosApi = archivosApiMock;
  portal.descargandoArchivoId = null;
  portal.errorDescarga = '';

  // Proyecto actual null -> estado vacío
  portal.api = {
    proyectoSeleccionado: null,
    proyectos: []
  };
  assert.equal(portal.proyectoActual, null);
  assert.equal(portal.avanceProgreso, 0);

  // Con proyecto real
  portal.api.proyectos = [{ id: 'p-real', nombre: 'Sitio Web Real' }];
  assert.equal(portal.proyectoActual.id, 'p-real');

  // Descargar archivo real
  await portal.descargarArchivo({ id: 'a1', nombre: 'archivo.pdf', nombreOriginal: 'archivo.pdf' });
  assert.equal(descargaInvocada, true);
  assert.equal(proyectoDescargaId, 'p-real');
});

test('acciones no soportadas están deshabilitadas sin toasts falsos', () => {
  const estado = Object.create(UiStateService.prototype);
  estado.collaboratorModalOpen = true;
  estado.nuevoColaborador = { nombre: 'Laura', rol: 'Diseñadora' };
  estado.selectedProject = { id: 'p1', participantes: [] };
  estado.equinox = {
    mostrarToast: () => { throw new Error('No debe mostrar toast para colaboradores no soportados'); }
  };

  // addCollaborator debe cerrar el modal sin añadir falsamente ni mostrar toast
  estado.addCollaborator();
  assert.equal(estado.collaboratorModalOpen, false);
  assert.equal(estado.selectedProject.participantes.length, 0);
});

test('aislamiento de sesión: cerrar sesión durante la carga diferida de facturas no publica datos ni altera indicadores', async () => {
  let resolveFacturas;
  const promesaFacturas = new Promise((resolve) => { resolveFacturas = resolve; });

  const sesion$ = new BehaviorSubject({
    contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-1', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u1', nombre: 'Usuario Org 1' }
  });

  const estado = Object.create(UiStateService.prototype);
  estado.auth = {
    sesion$,
    get token() { return sesion$.value ? 'token-org-1' : null; },
    get sesion() { return sesion$.value; }
  };
  estado.facturasApi = {
    listarFacturas: () => promesaFacturas,
    consultarTotales: async () => ({ totalesPorMoneda: [{ moneda: 'USD', totalPorCobrar: 1000, totalCobrado: 0, facturasEmitidas: 1, facturasPendientes: 1, facturasPagadas: 0 }] })
  };
  estado.facturasReales = [];
  estado.totalesFacturas = null;
  estado.cargandoFacturas = false;
  estado.errorFacturas = '';
  estado.clientes = [];
  estado.proyectos = [];

  const emisiones = [];
  estado.facturasReales$.subscribe((f) => emisiones.push(f));

  // Iniciar carga en org-1
  const cargaPromise = estado.cargarFacturas();
  assert.equal(estado.cargandoFacturas, true);

  // Cerrar sesión mientras la petición está en vuelo
  sesion$.next(null);
  estado.facturasReales = [];
  estado.totalesFacturas = null;
  estado.cargandoFacturas = false;

  // Responder la petición de org-1 tras haber cerrado sesión
  resolveFacturas([
    { id: 'f-org1', numero: 'INV-ORG1', concepto: 'Factura Confidencial Org 1', monto: 1000, moneda: 'USD', estado: 'ENVIADA', clienteId: 'c1', visibleEnPortal: true }
  ]);
  await cargaPromise;

  assert.equal(estado.facturasReales.length, 0, 'No debe publicar facturas si la sesión fue cerrada');
  assert.equal(estado.totalesFacturas, null, 'No debe publicar totales si la sesión fue cerrada');
  assert.equal(estado.cargandoFacturas, false, 'No debe reactivar cargandoFacturas');
  const ultimaEmision = emisiones[emisiones.length - 1];
  assert.equal(ultimaEmision.length, 0, 'facturasReales$ no debe emitir facturas de sesión cerrada');
});

test('aislamiento de sesión: cambiar de organización antes de recibir la respuesta no sobrescribe la organización vigente', async () => {
  let resolveFacturasOrg1;
  const promesaOrg1 = new Promise((resolve) => { resolveFacturasOrg1 = resolve; });

  const sesion$ = new BehaviorSubject({
    contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-1', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u1', nombre: 'Freelancer' }
  });

  let tokenActual = 'token-org-1';
  const estado = Object.create(UiStateService.prototype);
  estado.auth = {
    sesion$,
    get token() { return tokenActual; },
    get sesion() { return sesion$.value; }
  };

  let llamada = 0;
  estado.facturasApi = {
    listarFacturas: async () => {
      llamada++;
      if (llamada === 1) return promesaOrg1;
      return [{ id: 'f-org2', numero: 'INV-ORG2', concepto: 'Factura Org 2', monto: 200, moneda: 'PAB', estado: 'ENVIADA', clienteId: 'c2', visibleEnPortal: true }];
    },
    consultarTotales: async () => {
      if (tokenActual === 'token-org-1') return { totalesPorMoneda: [{ moneda: 'USD', totalPorCobrar: 1000, totalCobrado: 0, facturasEmitidas: 1, facturasPendientes: 1, facturasPagadas: 0 }] };
      return { totalesPorMoneda: [{ moneda: 'PAB', totalPorCobrar: 200, totalCobrado: 0, facturasEmitidas: 1, facturasPendientes: 1, facturasPagadas: 0 }] };
    }
  };
  estado.facturasReales = [];
  estado.totalesFacturas = null;
  estado.cargandoFacturas = false;
  estado.errorFacturas = '';
  estado.clientes = [];
  estado.proyectos = [];

  // Iniciar carga para Org 1
  const cargaOrg1 = estado.cargarFacturas();

  // Cambiar a Org 2 antes de que responda Org 1
  tokenActual = 'token-org-2';
  sesion$.next({
    contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-2', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u1', nombre: 'Freelancer' }
  });

  // Iniciar carga para Org 2 y esperar que concluya
  await estado.cargarFacturas();
  assert.equal(estado.facturasReales[0]?.numero, 'INV-ORG2', 'Debe tener cargada la factura de Org 2');
  assert.equal(estado.totalesFacturas?.totalesPorMoneda[0]?.moneda, 'PAB');

  // Ahora responde tardíamente Org 1
  resolveFacturasOrg1([
    { id: 'f-org1', numero: 'INV-ORG1', concepto: 'Factura Org 1', monto: 1000, moneda: 'USD', estado: 'ENVIADA', clienteId: 'c1', visibleEnPortal: true }
  ]);
  await cargaOrg1;

  // Verificar que Org 1 NO sobrescribió a Org 2
  assert.equal(estado.facturasReales.length, 1);
  assert.equal(estado.facturasReales[0]?.numero, 'INV-ORG2', 'La respuesta tardía de Org 1 no debe sobrescribir Org 2');
  assert.equal(estado.totalesFacturas?.totalesPorMoneda[0]?.moneda, 'PAB', 'Los totales de Org 1 no deben sobrescribir Org 2');
});

test('aislamiento de sesión: un error tardío de la sesión anterior no sobrescribe datos ni estado de error de la sesión vigente', async () => {
  let rejectFacturasOrg1;
  const promesaOrg1 = new Promise((_, reject) => { rejectFacturasOrg1 = reject; });

  const sesion$ = new BehaviorSubject({
    contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-1', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u1', nombre: 'Freelancer' }
  });

  let tokenActual = 'token-org-1';
  const estado = Object.create(UiStateService.prototype);
  estado.auth = {
    sesion$,
    get token() { return tokenActual; },
    get sesion() { return sesion$.value; }
  };

  let llamada = 0;
  estado.facturasApi = {
    listarFacturas: async () => {
      llamada++;
      if (llamada === 1) return promesaOrg1;
      return [{ id: 'f-org2', numero: 'INV-ORG2', concepto: 'Factura Org 2', monto: 500, moneda: 'USD', estado: 'ENVIADA', clienteId: 'c2', visibleEnPortal: true }];
    },
    consultarTotales: async () => ({ totalesPorMoneda: [{ moneda: 'USD', totalPorCobrar: 500, totalCobrado: 0, facturasEmitidas: 1, facturasPendientes: 1, facturasPagadas: 0 }] })
  };
  estado.facturasReales = [];
  estado.totalesFacturas = null;
  estado.cargandoFacturas = false;
  estado.errorFacturas = '';
  estado.clientes = [];
  estado.proyectos = [];

  // Iniciar carga para Org 1
  const cargaOrg1 = estado.cargarFacturas();

  // Cambiar a Org 2
  tokenActual = 'token-org-2';
  sesion$.next({
    contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-2', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u1', nombre: 'Freelancer' }
  });

  // Cargar exitosamente Org 2
  await estado.cargarFacturas();
  assert.equal(estado.facturasReales.length, 1);
  assert.equal(estado.errorFacturas, '');

  // Ahora Org 1 falla con 500
  rejectFacturasOrg1(new Error('Fallo de red en Org 1'));
  await cargaOrg1;

  // Org 2 no debe haber sido limpiada ni tener error
  assert.equal(estado.facturasReales.length, 1, 'No debe vaciar las facturas de Org 2');
  assert.equal(estado.facturasReales[0]?.numero, 'INV-ORG2');
  assert.equal(estado.errorFacturas, '', 'El error tardío de Org 1 no debe presentarse en Org 2');
});

test('aislamiento de sesión: configuración y portal de finanzas no son sobrescritos por respuestas tardías de otra sesión', async () => {
  let resolveConfigOrg1;
  const promesaConfigOrg1 = new Promise((resolve) => { resolveConfigOrg1 = resolve; });

  const sesion$ = new BehaviorSubject({
    contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-1', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u1', nombre: 'Usuario Org 1' }
  });

  let tokenActual = 'token-org-1';
  const estado = Object.create(UiStateService.prototype);
  estado.auth = {
    sesion$,
    get token() { return tokenActual; },
    get sesion() { return sesion$.value; }
  };

  let llamadaOrg = 0;
  estado.organizacionApi = {
    consultar: async () => {
      llamadaOrg++;
      if (llamadaOrg === 1) return promesaConfigOrg1;
      return { id: 'org-2', nombre: 'Estudio Org 2', moneda: 'PAB' };
    }
  };
  estado.facturasApi = {
    consultarPortalFinanzas: async () => ({ portalMostrarFinanzas: false })
  };
  estado.equinox = { actualizarConfiguracion: () => {} };
  estado.configuracion = { nombreEstudio: '' };
  estado.cargandoConfiguracion = false;
  estado.errorConfiguracion = '';

  // Iniciar carga para Org 1
  const cargaConfigOrg1 = estado.cargarOrganizacion();
  assert.equal(estado.cargandoConfiguracion, true);

  // Cambiar a Org 2
  tokenActual = 'token-org-2';
  sesion$.next({
    contexto: { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-2', rolOrganizacion: 'PROPIETARIO' },
    usuario: { id: 'u2', nombre: 'Usuario Org 2' }
  });

  // Cargar Org 2
  await estado.cargarOrganizacion();
  assert.equal(estado.configuracion.nombreEstudio, 'Estudio Org 2');

  // Ahora responde tardíamente Org 1
  resolveConfigOrg1({ id: 'org-1', nombre: 'Estudio Antiguo Org 1', moneda: 'USD' });
  await cargaConfigOrg1;

  assert.equal(estado.configuracion.nombreEstudio, 'Estudio Org 2', 'La configuración de Org 1 no debe sobrescribir Org 2');
});

