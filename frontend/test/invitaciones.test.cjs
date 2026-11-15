const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { of, firstValueFrom, NEVER, BehaviorSubject } = require('rxjs');

global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };
const angular = { Component: () => (target) => target, Directive: () => (target) => target, Injectable: () => (target) => target, HostListener: () => () => {} };
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
const cache = new Map();
function load(relative) {
  const filename = path.resolve(sourceRoot, relative);
  if (cache.has(filename)) return cache.get(filename);
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} }; cache.set(filename, module.exports);
  const localRequire = (id) => {
    if (id === '@angular/core') return angular;
    if (id === '@angular/common') return { CommonModule: class {} };
    if (id === '@angular/forms') return { FormsModule: class {} };
    if (id === '@angular/router') return { RouterLink: class {}, ActivatedRoute: class {} };
    if (id === '@angular/common/http') return { HttpClient: class {}, HttpParams: class { set() { return this; } } };
    if (id === 'rxjs') return { ...require('rxjs'), firstValueFrom };
    if (id === './auth/auth.guards') return { guardCliente: () => true, guardOrganizacion: () => true, guardPublico: () => true };
    if (routeStubs.has(id)) return { [routeStubs.get(id)]: class {} };
    if (id.startsWith('.')) return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), `${id}.ts`)));
    throw new Error(`Import no previsto en prueba de invitaciones: ${id}`);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, window, URL, sessionStorage: global.sessionStorage, navigator: global.navigator, console }, { filename });
  cache.set(filename, module.exports); return module.exports;
}

const { InvitacionesApiService, limitarEsperaInvitacion } = load('services/invitaciones-api.service.ts');
const { InvitacionComponent } = load('pages/invitacion.component.ts');
const { ClientesComponent } = load('pages/clientes.component.ts');
const { ClientesProyectosApiService } = load('services/clientes-proyectos-api.service.ts');
const { routes } = load('app.routes.ts');

function httpFake(overrides = {}) {
  const calls = [];
  return {
    calls,
    client: {
      get(url) { calls.push({ method: 'GET', url }); return (overrides.get || (() => of([])))(url); },
      post(url, body) { calls.push({ method: 'POST', url, body }); return (overrides.post || (() => of({})))(url, body); }
    }
  };
}

function error(status, message = '') { return { status, error: { error: message } }; }
function deferred() { let resolve; let reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }

 test('las consultas de clientes y proyectos solicitan validación sin caché para evitar respuestas 304', async () => {
  const solicitudes = [];
  const api = new ClientesProyectosApiService({
    get(url, opciones) { solicitudes.push({ url, opciones }); return of([]); }
  });
  await api.listarClientes();
  await api.listarProyectos();
  assert.equal(solicitudes.length, 2);
  for (const solicitud of solicitudes) assert.equal(solicitud.opciones.headers['Cache-Control'], 'no-cache');
});

const info = {
  correoEnmascarado: 'm***@example.com', rol: 'COLABORADOR', expiraEn: '2026-12-01T00:00:00.000Z',
  cliente: { nombre: 'Cliente real', empresa: 'Empresa real' }, organizacion: { nombre: 'Estudio real', logoUrl: null }, esUsuarioExistente: false
};

test('la API usa contratos de invitación existentes y solo incluye los campos permitidos en los cuerpos', async () => {
  const fake = httpFake({ get: () => of([]), post: () => of({ invitacion: { id: 'i1' }, enlaceInvitacion: 'http://localhost:4200/invitacion/secret' }) });
  const api = new InvitacionesApiService(fake.client);
  await api.listar('cliente/1'); await api.crear('cliente/1', { correo: 'x@example.com', rol: 'TITULAR' });
  await api.reenviar('cliente/1', 'i1'); await api.revocar('cliente/1', 'i1');
  await api.consultarPublica('secret/token'); await api.aceptar('secret/token', { nombre: 'Ana', contrasena: '12345678' });
  assert.deepEqual(fake.calls.map(({ method, url }) => [method, url]), [
    ['GET', 'http://localhost:3000/api/clientes/cliente%2F1/invitaciones'],
    ['POST', 'http://localhost:3000/api/clientes/cliente%2F1/invitaciones'],
    ['POST', 'http://localhost:3000/api/clientes/cliente%2F1/invitaciones/i1/reenviar'],
    ['POST', 'http://localhost:3000/api/clientes/cliente%2F1/invitaciones/i1/revocar'],
    ['GET', 'http://localhost:3000/api/invitaciones/secret%2Ftoken'],
    ['POST', 'http://localhost:3000/api/invitaciones/secret%2Ftoken/aceptar']
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls[1].body)), { correo: 'x@example.com', rol: 'TITULAR' });
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls[2].body)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls[5].body)), { nombre: 'Ana', contrasena: '12345678' });
});

test('la espera HTTP de invitaciones vence con error recuperable en vez de quedar pendiente indefinidamente', async () => {
  await assert.rejects(firstValueFrom(limitarEsperaInvitacion(NEVER, 5)), (err) => err.name === 'TimeoutError');
});

test('la ruta de aceptación es pública y separada de los shells autenticados', () => {
  const route = routes.find((item) => item.path === 'invitacion/:token');
  assert.equal(route.component.name, InvitacionComponent.name);
  assert.equal(route.canActivate, undefined);
  assert.equal(routes.find((item) => item.path === '' && item.children?.some((child) => child.path === 'portal')).component.name, 'ClientShellComponent');
});

test('CRM crea y reenvía invitaciones con enlace efímero, lista estados y requiere confirmar revocación', async () => {
  const client = { id: 'cliente-1', nombre: 'Cliente uno', correo: 'cliente@example.com' };
  const lista = [{ id: 'invite-1', correo: 'cliente@example.com', rol: 'TITULAR', estado: 'PENDIENTE', expiraEn: '2026-12-01', aceptadaEn: null, creadoEn: '2026-10-30', actualizadoEn: '2026-10-30', invitadoPor: { id: 'u1', nombre: 'Freelancer', apellido: null, correo: 'f@example.com' }, aceptadaPor: null }];
  const calls = [];
  const inviteApi = {
    listar: async (id) => { calls.push(['listar', id]); return lista; },
    crear: async (id, datos) => { calls.push(['crear', id, datos]); return { invitacion: { id: 'invite-1' }, enlaceInvitacion: 'https://local.test/invitacion/secret-now' }; },
    reenviar: async (id, inviteId) => { calls.push(['reenviar', id, inviteId]); return { invitacion: { id: inviteId }, enlaceInvitacion: 'https://local.test/invitacion/new-secret' }; },
    revocar: async (id, inviteId) => { calls.push(['revocar', id, inviteId]); return { mensaje: 'Revocada', invitacion: { id: inviteId, estado: 'REVOCADA' } }; }
  };
  const page = new ClientesComponent({ proyectos: [], listarClientes: async () => [], listarProyectos: async () => [] }, inviteApi);
  page.abrirInvitaciones(client); await page.cargarInvitaciones();
  assert.equal(page.invitaciones[0].estado, 'PENDIENTE');
  page.formularioInvitacion.correo = '  nuevo@example.com ';
  await page.crearInvitacion({ invalid: false });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find((call) => call[0] === 'crear'))), ['crear', 'cliente-1', { correo: 'nuevo@example.com', rol: 'TITULAR' }]);
  assert.match(page.enlaceInvitacion, /secret-now/);
  assert.equal(page.exitoInvitacion.includes('No hay un proveedor de correo'), true);
  await page.reenviarInvitacion(lista[0]);
  assert.match(page.enlaceInvitacion, /new-secret/);
  assert.equal(page.invitaciones[0].enlaceInvitacion, undefined);
  await page.revocarInvitacion(lista[0]); assert.equal(calls.some((call) => call[0] === 'revocar'), false);
  await page.revocarInvitacion(lista[0]); assert.equal(calls.some((call) => call[0] === 'revocar'), true);
  page.cerrarInvitaciones(); assert.equal(page.enlaceInvitacion, null); assert.equal(page.clienteInvitaciones, null);
});

test('CRM muestra error recuperable de lista y de creación, bloquea formulario inválido y permite reintentar', async () => {
  let fallarLista = true;
  let llamadasCrear = 0;
  const page = new ClientesComponent({}, {
    listar: async () => { if (fallarLista) throw { status: 503 }; return []; },
    crear: async () => { llamadasCrear++; throw { status: 422 }; }
  });
  page.abrirInvitaciones({ id: 'c2', nombre: 'Cliente', correo: '' });
  await page.cargarInvitaciones(); assert.match(page.errorInvitaciones, /No se pudieron consultar/);
  fallarLista = false; await page.cargarInvitaciones(); assert.equal(page.errorInvitaciones, '');
  page.formularioInvitacion.correo = 'x@example.com';
  await page.crearInvitacion({ invalid: true }); assert.equal(llamadasCrear, 0);
  await page.crearInvitacion({ invalid: false }); assert.match(page.errorCrearInvitacion, /Revisa el correo/);
  assert.equal(page.enlaceInvitacion, null);
});

test('la carga de clientes no espera el contador de proyectos y guarda cliente sin repetir el GET de lista', async () => {
  let resolverClientes;
  let resolverProyectos;
  let lecturasLista = 0;
  const lista = [{ id: 'c3', nombre: 'Cliente cargado' }];
  const proyectos = new Promise((resolve) => { resolverProyectos = resolve; });
  const api = {
    clientes: lista,
    listarClientes: () => { lecturasLista++; return new Promise((resolve) => { resolverClientes = resolve; }); },
    listarProyectos: () => proyectos,
    crearCliente: async () => { api.clientes = lista; }
  };
  const page = new ClientesComponent(api, {});
  const carga = page.cargar();
  resolverClientes(lista); await carga;
  assert.equal(page.cargando, false);
  assert.equal(page.clientes[0].nombre, 'Cliente cargado');
  assert.equal(page.cargandoProyectosActivos, true);
  resolverProyectos([]); await Promise.resolve();
  page.modalFormulario = true;
  await page.guardar({ invalid: false });
  assert.equal(lecturasLista, 1);
  assert.equal(page.modalFormulario, false);
});

test('regresión login→/clientes: la instancia de ruta refresca la vista al concluir una respuesta válida', async () => {
  const storage = new Map();
  global.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const { AuthService } = load('auth/auth.service.ts');
  const { LoginComponent } = load('pages/login.component.ts');
  const usuario = { id: 'user-test', correo: 'test@example.invalid', nombre: 'Usuario de prueba' };
  const sesion = { tipoAcceso: 'ORGANIZACION', organizacionId: 'org-test', rolOrganizacion: 'PROPIETARIO' };
  const listaFicticia = [{ id: 'cliente-test', nombre: 'Cliente ficticio', estado: 'ACTIVO' }];
  const llamadas = [];
  const http = {
    post: (url) => { llamadas.push({ tipo: 'POST', url }); return of({ token: 'token-ficticio' }); },
    get: (url) => {
      llamadas.push({ tipo: 'GET', url });
      if (url.endsWith('/autenticacion/yo')) return of({ usuario, sesion });
      return of([]);
    }
  };
  const router = { url: '/inicio-sesion', navigateByUrl: async (url) => { router.url = url; return true; }, parseUrl: (url) => ({ redirect: url }) };
  const auth = new AuthService(http, router);
  const login = new LoginComponent(auth, router);
  login.correo = 'test@example.invalid'; login.contrasena = 'no-se-usa';
  await login.entrar({ invalid: false });
  assert.equal(router.url, '/dashboard');

  const rutaClientes = routes.find((route) => route.path === '' && route.children?.some((child) => child.path === 'clientes'));
  const componenteRuta = rutaClientes.children.find((child) => child.path === 'clientes').component;
  assert.equal(componenteRuta.name, ClientesComponent.name);
  router.url = '/clientes'; // navegación interna sin recargar; permanece el mismo AuthService.
  const api = { proyectos: [], listarClientes: async () => listaFicticia, listarProyectos: async () => [] };
  let avisosCambio = 0;
  const component = new ClientesComponent(api, {}, auth, { markForCheck: () => { avisosCambio++; } });
  component.ngOnInit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(llamadas.filter((call) => call.url.endsWith('/autenticacion/yo')).length, 1);
  assert.equal(llamadas.filter((call) => call.url.endsWith('/autenticacion/inicio-sesion')).length, 1);
  assert.equal(component.solicitudClientes, 1);
  assert.equal(Array.isArray(component.clientes), true);
  assert.equal(component.clientes.length, 1);
  assert.equal(component.cargando, false);
  assert.equal(component.error, '');
  assert.ok(avisosCambio > 0, 'la vista debe recibir notificación al asentarse la respuesta fuera del evento de navegación');
});

test('la lista de clientes se consulta automáticamente cuando la sesión de organización se restaura', async () => {
  const sesion = new BehaviorSubject(null);
  let llamadasClientes = 0;
  let terminarCarga;
  const page = new ClientesComponent({
    proyectos: [],
    listarClientes: () => { llamadasClientes++; return new Promise((resolve) => { terminarCarga = resolve; }); },
    listarProyectos: async () => []
  }, {}, { sesion$: sesion.asObservable() });

  page.ngOnInit();
  assert.equal(llamadasClientes, 0);
  sesion.next({ usuario: { id: 'u1' }, contexto: { tipoAcceso: 'ORGANIZACION' } });
  assert.equal(llamadasClientes, 1);
  terminarCarga([{ id: 'c1', nombre: 'Cliente tras inicio de sesión' }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.clientes[0].nombre, 'Cliente tras inicio de sesión');
  assert.equal(page.cargando, false);
});

test('el detalle de cliente y la lista de invitaciones ignoran respuestas de una selección anterior', async () => {
  const detalleViejo = deferred(); const detalleNuevo = deferred();
  const listaVieja = deferred(); const listaNueva = deferred(); const pendientesLista = [listaVieja, listaNueva];
  const page = new ClientesComponent({ consultarCliente: (id) => id === 'viejo' ? detalleViejo.promise : detalleNuevo.promise }, {
    listar: () => pendientesLista.shift().promise
  });
  const abrirViejo = page.verDetalle({ id: 'viejo' });
  const abrirNuevo = page.verDetalle({ id: 'nuevo' });
  detalleNuevo.resolve({ id: 'nuevo', nombre: 'Cliente nuevo' }); await abrirNuevo;
  detalleViejo.resolve({ id: 'viejo', nombre: 'Cliente anterior' }); await abrirViejo;
  assert.equal(page.clienteDetalle.nombre, 'Cliente nuevo');

  page.abrirInvitaciones({ id: 'c-viejo', nombre: 'Anterior' });
  page.abrirInvitaciones({ id: 'c-nuevo', nombre: 'Nuevo' });
  listaNueva.resolve([{ id: 'nueva', correo: 'nuevo@example.com' }]); await new Promise((resolve) => setImmediate(resolve));
  listaVieja.resolve([{ id: 'vieja', correo: 'viejo@example.com' }]); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.clienteInvitaciones.id, 'c-nuevo');
  assert.equal(page.invitaciones[0].id, 'nueva');
});

test('crear invitación libera el envío al recibir el POST sin esperar el refresco lento de la lista', async () => {
  let resolverRefresco;
  let listas = 0;
  const api = {
    listar: async () => { if (++listas === 1) return []; return new Promise((resolve) => { resolverRefresco = resolve; }); },
    crear: async () => ({ invitacion: { id: 'i2' }, enlaceInvitacion: 'https://local.test/invitacion/fake-token' })
  };
  const page = new ClientesComponent({}, api);
  page.clienteInvitaciones = { id: 'c4', nombre: 'Cliente cuatro' };
  await page.cargarInvitaciones();
  page.formularioInvitacion = { correo: 'invitado@example.com', rol: 'COLABORADOR' };
  await page.crearInvitacion({ invalid: false });
  assert.equal(page.enviandoInvitacion, false);
  assert.equal(page.cargandoInvitaciones, true);
  assert.match(page.enlaceInvitacion, /fake-token/);
  resolverRefresco([]); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.cargandoInvitaciones, false);
});

test('la invitación pública presenta los datos enmascarados del servidor y valida cuenta nueva', async () => {
  const fake = httpFake({ get: () => of(info), post: () => of({ mensaje: 'Acceso vinculado.', clienteId: 'c1', rol: 'COLABORADOR' }) });
  const page = new InvitacionComponent({ snapshot: { paramMap: { get: () => 'token-solo-ruta' } } }, new InvitacionesApiService(fake.client));
  page.token = 'token-solo-ruta'; await page.cargar();
  assert.equal(page.invitacion.correoEnmascarado, 'm***@example.com');
  assert.equal(page.invitacion.cliente.nombre, 'Cliente real');
  await page.aceptar({ invalid: true });
  assert.equal(page.enviada, true); assert.equal(fake.calls.length, 1);
  page.datos.nombre = 'Ana'; page.datos.contrasena = '12345678';
  await page.aceptar({ invalid: false });
  assert.equal(page.aceptada, true); assert.equal(page.token, ''); assert.equal(page.datos.contrasena, '');
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls[1].body)), { nombre: 'Ana', contrasena: '12345678' });
  assert.equal(page.mensajeExito, 'Acceso vinculado.');
});

test('la cuenta existente envía solo contraseña y presenta el error de credenciales', async () => {
  const existing = { ...info, esUsuarioExistente: true };
  const fake = httpFake({ get: () => of(existing), post: () => { throw error(401); } });
  const page = new InvitacionComponent({ snapshot: { paramMap: { get: () => 'token' } } }, new InvitacionesApiService(fake.client));
  page.token = 'token'; await page.cargar(); page.datos.contrasena = 'incorrecta';
  await page.aceptar({ invalid: false });
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls[1].body)), { contrasena: 'incorrecta' });
  assert.match(page.error, /contraseña actual no es correcta/);
  assert.equal(page.aceptada, false);
});

test('errores públicos inválidos, vencidos, revocados y reintento de consulta se presentan con estado recuperable', async () => {
  let calls = 0;
  const fake = httpFake({ get: () => { if (++calls === 1) throw error(410, 'Invitación revocada'); if (calls === 2) throw error(404); return of(info); } });
  const page = new InvitacionComponent({ snapshot: { paramMap: { get: () => 'token' } } }, new InvitacionesApiService(fake.client));
  page.token = 'token'; await page.cargar(); assert.match(page.error, /revocada/);
  assert.equal(page.cargando, false); assert.equal(page.puedeReintentarConsulta, false);
  await page.cargar(); assert.match(page.error, /no es válido/);
  assert.equal(page.puedeReintentarConsulta, false);
  await page.cargar(); assert.equal(page.invitacion.correoEnmascarado, info.correoEnmascarado); assert.equal(page.error, '');
});

test('una consulta pública que agota el tiempo deja de cargar y habilita reintento', async () => {
  const page = new InvitacionComponent({ snapshot: { paramMap: { get: () => 'token-ficticio' } } }, {
    consultarPublica: () => firstValueFrom(limitarEsperaInvitacion(NEVER, 5))
  });
  page.token = 'token-ficticio'; await page.cargar();
  assert.equal(page.cargando, false);
  assert.match(page.error, /No se pudo consultar/);
  assert.equal(page.puedeReintentarConsulta, true);
  assert.equal(page.invitacion, null);
});

test('error de aceptación distingue enlace vencido y esquema inválido sin declarar éxito', async () => {
  let failure = error(422);
  const fake = httpFake({ get: () => of(info), post: () => { throw failure; } });
  const page = new InvitacionComponent({ snapshot: { paramMap: { get: () => 'token' } } }, new InvitacionesApiService(fake.client));
  page.token = 'token'; await page.cargar(); page.datos.nombre = 'Ana'; page.datos.contrasena = '12345678';
  await page.aceptar({ invalid: false }); assert.match(page.error, /al menos 2 caracteres/); assert.equal(page.aceptada, false);
  failure = error(410, 'Invitación expirada'); await page.aceptar({ invalid: false });
  assert.match(page.error, /venció/); assert.equal(page.aceptada, false);
});
