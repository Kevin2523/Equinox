const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { of, throwError, firstValueFrom } = require('rxjs');

global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };
const angular = { Component: () => (target) => target, Injectable: () => (target) => target };
const authGuards = { guardCliente: () => true, guardOrganizacion: () => true, guardPublico: () => true };
const routeStubs = new Map([
  ['./pages/dashboard.component', 'DashboardComponent'], ['./pages/clientes.component', 'ClientesComponent'],
  ['./pages/proyectos.component', 'ProyectosComponent'], ['./pages/tareas.component', 'TareasComponent'],
  ['./pages/finanzas.component', 'FinanzasComponent'], ['./pages/configuracion.component', 'ConfiguracionComponent'],
  ['./pages/portal.component', 'PortalComponent'], ['./pages/not-found.component', 'NotFoundComponent'],
  ['./shells/freelancer-shell.component', 'FreelancerShellComponent'], ['./shells/client-shell.component', 'ClientShellComponent'],
  ['./pages/client-home.component', 'ClientHomeComponent'], ['./pages/login.component', 'LoginComponent'],
  ['./pages/registro.component', 'RegistroComponent'], ['./pages/recuperacion.component', 'RecuperacionComponent'],
  ['./pages/logout.component', 'LogoutComponent']
]);
const sourceRoot = path.resolve(__dirname, '../src');
const moduleCache = new Map();

function load(relativePath) {
  const filename = path.resolve(sourceRoot, relativePath);
  if (moduleCache.has(filename)) return moduleCache.get(filename);
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true
  } }).outputText;
  const module = { exports: {} };
  moduleCache.set(filename, module.exports);
  const localRequire = (id) => {
    if (id === '@angular/core') return angular;
    if (id === '@angular/common') return { CommonModule: class CommonModule {} };
    if (id === '@angular/forms') return { FormsModule: class FormsModule {} };
    if (id === '@angular/common/http') return { HttpClient: class HttpClient {} };
    if (id === '@angular/router') return { Router: class Router {}, ActivatedRoute: class ActivatedRoute {} };
    if (id === 'rxjs') return require('rxjs');
    if (id === './auth/auth.guards') return authGuards;
    if (routeStubs.has(id)) return { [routeStubs.get(id)]: class {} };
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), `${id}.ts`);
      return load(path.relative(sourceRoot, target));
    }
    throw new Error(`Import no previsto en la prueba del portal: ${id}`);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, window, URL, console }, { filename });
  moduleCache.set(filename, module.exports);
  return module.exports;
}

const { PortalApiService } = load('services/portal-api.service.ts');
const { ClientHomeComponent } = load('pages/client-home.component.ts');
const { PortalComponent } = load('pages/portal.component.ts');
const { routes } = load('app.routes.ts');

const identidad = {
  cliente: { id: 'cliente-a', nombre: 'Cuenta A', empresa: 'Empresa A' },
  estudio: { nombre: 'Estudio A', logoUrl: null, colorPrimario: '#224466', colorSecundario: '#f4f6f8', tipografia: 'DM Sans' }
};
const proyecto = { id: 'proyecto-a', nombre: 'Proyecto A', descripcion: null, estado: 'ACTIVO', fechaInicio: null, fechaEntrega: null };
const comentario = { id: 'comentario-a', autor: 'CLIENTE', contenido: 'Mensaje', creadoEn: '2026-10-30T12:00:00.000Z', usuario: { nombre: 'Cuenta A', apellido: null } };

function promesaDiferida() {
  let resolve;
  let reject;
  const promise = new Promise((resolver, rechazar) => { resolve = resolver; reject = rechazar; });
  return { promise, resolve, reject };
}

function crearHttp(overrides = {}) {
  const llamadas = [];
  const http = {
    get(url) { llamadas.push({ metodo: 'GET', url }); return (overrides.get || (() => of([])))(url); },
    post(url, body) { llamadas.push({ metodo: 'POST', url, body }); return (overrides.post || (() => of(comentario)))(url, body); }
  };
  return { http, llamadas };
}

test('la ruta directa /portal usa el shell autenticado cliente y la vista previa queda bajo el shell freelancer', () => {
  const shellCliente = routes.find((route) => route.path === '' && route.children?.some((child) => child.path === 'portal'));
  const rutaPortal = shellCliente.children.find((child) => child.path === 'portal');
  const shellFreelancer = routes.find((route) => route.path === '' && route.children?.some((child) => child.path === 'vista-previa-portal'));
  assert.equal(shellCliente.canActivate[0], authGuards.guardCliente);
  assert.equal(rutaPortal.component.name, ClientHomeComponent.name);
  assert.notEqual(shellCliente, shellFreelancer);
  assert.equal(shellFreelancer.canActivate[0], authGuards.guardOrganizacion);
  assert.equal(shellFreelancer.children.find((child) => child.path === 'vista-previa-portal').component.name, PortalComponent.name);
});

test('el servicio consume identidad, proyectos y recursos propios sin filtros de cliente u organización', async () => {
  const respuestas = new Map([
    ['http://localhost:3000/api/portal', identidad],
    ['http://localhost:3000/api/portal/proyectos', [proyecto]],
    ['http://localhost:3000/api/portal/proyectos/proyecto-a', proyecto],
    ['http://localhost:3000/api/portal/proyectos/proyecto-a/hitos', []],
    ['http://localhost:3000/api/portal/proyectos/proyecto-a/archivos', []],
    ['http://localhost:3000/api/portal/proyectos/proyecto-a/comentarios', []],
    ['http://localhost:3000/api/portal/facturas', []]
  ]);
  const { http, llamadas } = crearHttp({ get: (url) => of(respuestas.get(url)) });
  const api = new PortalApiService(http);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.identidad())), identidad);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.proyectos())), [proyecto]);
  await api.proyecto('proyecto-a'); await api.hitos('proyecto-a'); await api.archivos('proyecto-a');
  await api.comentarios('proyecto-a'); await api.facturas();
  assert.deepEqual(llamadas.map((call) => call.url), [...respuestas.keys()]);
  assert.ok(llamadas.every((call) => !call.url.includes('clienteId=') && !call.url.includes('organizacionId=')));
});

test('la carga muestra estado pendiente, contenido vacío y error con reintento para identidad, proyectos y facturas', async () => {
  let resolverProyectos;
  let intentosFacturas = 0;
  let intentosProyectos = 0;
  let intentosIdentidad = 0;
  const api = {
    identidad: async () => { if (++intentosIdentidad === 1) throw new Error('red'); return identidad; },
    proyectos: () => {
      if (++intentosProyectos === 1) throw new Error('red');
      return new Promise((resolve) => { resolverProyectos = resolve; });
    },
    facturas: async () => { if (++intentosFacturas === 1) throw new Error('red'); return []; }
  };
  const page = new ClientHomeComponent(api);
  await page.cargarIdentidad();
  assert.match(page.errorIdentidad, /identidad/);
  await page.cargarIdentidad();
  assert.equal(page.identidad.cliente.nombre, 'Cuenta A');
  await page.cargarProyectos();
  assert.match(page.errorProyectos, /proyectos/);
  const cargaProyectos = page.cargarProyectos();
  assert.equal(page.cargandoProyectos, true);
  resolverProyectos([]);
  await cargaProyectos;
  assert.equal(page.proyectos.length, 0);
  assert.equal(page.errorProyectos, '');
  await page.cargarFacturas();
  assert.match(page.errorFacturas, /facturas autorizadas/);
  await page.cargarFacturas();
  assert.deepEqual(page.facturas, []);
  assert.equal(page.errorFacturas, '');
  await page.cargarIdentidad();
  assert.equal(page.identidad.cliente.nombre, 'Cuenta A');
});

test('cargarProyectos ignora errores y respuestas obsoletas, mantiene la carga vigente y permite reintentar', async () => {
  const errorObsoleto = promesaDiferida();
  const proyectosVigentes = promesaDiferida();
  const respuestaObsoleta = promesaDiferida();
  const errorVigente = promesaDiferida();
  const listaReintento = [{ ...proyecto, nombre: 'Proyecto tras reintento' }];
  const pendientes = [errorObsoleto.promise, proyectosVigentes.promise, respuestaObsoleta.promise, errorVigente.promise, Promise.resolve(listaReintento)];
  const page = new ClientHomeComponent({ proyectos: () => pendientes.shift() });
  const inicial = { ...proyecto, nombre: 'Proyecto previo' };
  page.proyectos = [inicial];
  page.proyectoId = proyecto.id;

  const antigua = page.cargarProyectos();
  const vigente = page.cargarProyectos();
  assert.equal(page.cargandoProyectos, true);
  errorObsoleto.reject(new Error('fallo antiguo'));
  await antigua;
  assert.equal(page.cargandoProyectos, true);
  assert.equal(page.errorProyectos, '');
  assert.equal(page.proyectos[0].nombre, 'Proyecto previo');
  proyectosVigentes.resolve([{ ...proyecto, nombre: 'Proyecto vigente' }]);
  await vigente;
  assert.equal(page.proyectos[0].nombre, 'Proyecto vigente');
  assert.equal(page.cargandoProyectos, false);

  const antiguaRespuesta = page.cargarProyectos();
  const vigenteError = page.cargarProyectos();
  errorVigente.reject(new Error('fallo vigente'));
  await vigenteError;
  assert.match(page.errorProyectos, /No se pudieron cargar/);
  assert.equal(page.cargandoProyectos, false);
  respuestaObsoleta.resolve([{ ...proyecto, nombre: 'Proyecto obsoleto' }]);
  await antiguaRespuesta;
  assert.equal(page.proyectos[0].nombre, 'Proyecto vigente');
  assert.match(page.errorProyectos, /No se pudieron cargar/);

  await page.cargarProyectos();
  assert.equal(page.proyectos[0].nombre, 'Proyecto tras reintento');
  assert.equal(page.errorProyectos, '');
});

test('retirar un proyecto de la lista invalida su detalle pendiente', async () => {
  const detalle = promesaDiferida();
  const page = new ClientHomeComponent({
    proyectos: async () => [],
    proyecto: () => detalle.promise,
    hitos: async () => [{ id: 'hito-antiguo' }],
    archivos: async () => [{ id: 'archivo-antiguo' }],
    comentarios: async () => [{ id: 'comentario-antiguo' }]
  });
  page.proyectos = [proyecto];
  const cargaDetalle = page.seleccionarProyecto(proyecto.id);
  await page.cargarProyectos();
  detalle.resolve(proyecto);
  await cargaDetalle;
  assert.equal(page.proyectoId, null);
  assert.equal(page.proyecto, null);
  assert.equal(page.hitos.length, 0);
  assert.equal(page.archivos.length, 0);
  assert.equal(page.comentarios.length, 0);
  assert.equal(page.cargandoDetalle, false);
});

test('cargarFacturas ignora errores y resultados obsoletos, conserva la carga vigente y reintenta', async () => {
  const errorObsoleto = promesaDiferida();
  const facturasVigentes = promesaDiferida();
  const respuestaObsoleta = promesaDiferida();
  const errorVigente = promesaDiferida();
  const facturasReintento = [{ id: 'factura-reintento', numero: 'F-2' }];
  const pendientes = [errorObsoleto.promise, facturasVigentes.promise, respuestaObsoleta.promise, errorVigente.promise, Promise.resolve(facturasReintento)];
  const page = new ClientHomeComponent({ facturas: () => pendientes.shift() });
  page.facturas = [{ id: 'factura-previa', numero: 'F-0' }];

  const antigua = page.cargarFacturas();
  const vigente = page.cargarFacturas();
  assert.equal(page.cargandoFacturas, true);
  errorObsoleto.reject(new Error('fallo antiguo'));
  await antigua;
  assert.equal(page.cargandoFacturas, true);
  assert.equal(page.errorFacturas, '');
  assert.equal(page.facturas[0].numero, 'F-0');
  facturasVigentes.resolve([{ id: 'factura-vigente', numero: 'F-1' }]);
  await vigente;
  assert.equal(page.facturas[0].numero, 'F-1');
  assert.equal(page.cargandoFacturas, false);

  const antiguaRespuesta = page.cargarFacturas();
  const vigenteError = page.cargarFacturas();
  errorVigente.reject(new Error('fallo vigente'));
  await vigenteError;
  assert.match(page.errorFacturas, /facturas autorizadas/);
  assert.equal(page.cargandoFacturas, false);
  respuestaObsoleta.resolve([{ id: 'factura-obsoleta', numero: 'F-antigua' }]);
  await antiguaRespuesta;
  assert.equal(page.facturas[0].numero, 'F-1');
  assert.match(page.errorFacturas, /facturas autorizadas/);

  await page.cargarFacturas();
  assert.equal(page.facturas[0].numero, 'F-2');
  assert.equal(page.errorFacturas, '');
});

test('detalle e hitos muestran datos recibidos y avance derivado solo cuando hay hitos', async () => {
  const hitos = [
    { id: 'h1', titulo: 'Primero', descripcion: null, estado: 'COMPLETADO', orden: 1, fechaObjetivo: null, completadoEn: null },
    { id: 'h2', titulo: 'Segundo', descripcion: null, estado: 'EN_PROGRESO', orden: 2, fechaObjetivo: null, completadoEn: null }
  ];
  const api = { proyecto: async () => proyecto, hitos: async () => hitos, archivos: async () => [], comentarios: async () => [] };
  const page = new ClientHomeComponent(api);
  const carga = page.seleccionarProyecto(proyecto.id);
  assert.equal(page.cargandoDetalle, true);
  await carga;
  assert.equal(page.proyecto.nombre, proyecto.nombre);
  assert.equal(page.avanceHitos, 50);
  assert.equal(page.estadoHito('VENCIDO'), 'Vencido');
  page.hitos = [];
  assert.equal(page.avanceHitos, null);
});

test('solo representa archivos y facturas que entrega el servidor, incluidos resultados vacíos', async () => {
  const file = { id: 'f1', nombre: 'Entrega', descripcion: null, url: 'https://files.example.test/a', tipoMime: 'application/pdf', tamanoBytes: 1024, tipo: 'ENTREGABLE', publicadoEn: null };
  let archivosPermitidos = [file];
  const api = { proyecto: async () => proyecto, hitos: async () => [], archivos: async () => archivosPermitidos, comentarios: async () => [], facturas: async () => [] };
  const page = new ClientHomeComponent(api);
  await page.seleccionarProyecto(proyecto.id);
  assert.deepEqual(JSON.parse(JSON.stringify(page.archivos)), [file]);
  assert.equal(page.tamanoArchivo(file.tamanoBytes), '1.0 KB');
  archivosPermitidos = [];
  await page.seleccionarProyecto(proyecto.id);
  assert.deepEqual(page.archivos, []);
  await page.cargarFacturas();
  assert.deepEqual(page.facturas, []);
});

test('comentarios rechaza cuerpo inválido, envía el contenido validado y recupera un fallo', async () => {
  const sent = [];
  let falla = false;
  const api = { enviarComentario: async (id, body) => {
    sent.push({ id, body });
    if (falla) throw { status: 503 };
    return comentario;
  } };
  const page = new ClientHomeComponent(api);
  page.proyectoId = proyecto.id;
  page.comentario = '   ';
  await page.enviarComentario();
  assert.equal(sent.length, 0);
  assert.match(page.errorComentario, /entre 1 y 2000/);
  page.comentario = 'x'.repeat(2001);
  await page.enviarComentario();
  assert.equal(sent.length, 0);
  falla = true;
  page.comentario = '  mensaje válido  ';
  await page.enviarComentario();
  assert.deepEqual(sent[0], { id: proyecto.id, body: 'mensaje válido' });
  assert.match(page.errorComentario, /reintentarlo/);
  assert.equal(page.comentario, '  mensaje válido  ');
  falla = false;
  await page.enviarComentario();
  assert.equal(page.comentarios.length, 1);
  assert.equal(page.comentario, '');
});

test('el portal mantiene controles de teclado, foco visible y disposición móvil', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../src/pages/client-home.component.html'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/pages/client-home.component.css'), 'utf8');
  const shell = fs.readFileSync(path.resolve(__dirname, '../src/shells/client-shell.component.ts'), 'utf8');
  assert.match(template, /<button[\s\S]*aria-pressed/);
  assert.match(template, /<textarea[\s\S]*maxlength="2000"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(shell, /routerLink="\/(dashboard|clientes|proyectos|tareas|finanzas|configuracion)/);
});
