const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { of, throwError, firstValueFrom } = require('rxjs');

const memory = new Map();
const sessionStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key)
};
const window = { location: { hostname: 'localhost', port: '4200', origin: 'http://localhost:4200' } };
let services;
const cache = new Map();
const angularCore = { Injectable: () => (target) => target, Component: () => (target) => target, inject: (token) => services.get(token) };
class Router {}

function load(relativePath) {
  const filename = path.resolve(__dirname, '../src', relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const localRequire = (id) => {
    if (id === '@angular/core') return angularCore;
    if (id === '@angular/router') return { Router };
    if (id === '@angular/common') return {};
    if (id === '@angular/forms') return {};
    if (id === '@angular/common/http') return {};
    if (id === 'rxjs') return require('rxjs');
    if (id.startsWith('.')) return load(path.relative(path.resolve(__dirname, '../src'), path.resolve(path.dirname(filename), `${id}.ts`)));
    throw new Error(`Import no previsto: ${id}`);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, window, sessionStorage, URL, console }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const { AuthService } = load('auth/auth.service.ts');
const { guardOrganizacion, guardCliente } = load('auth/auth.guards.ts');
const { authInterceptor } = load('auth/auth.interceptor.ts');
const { LoginComponent } = load('pages/login.component.ts');
const { LogoutComponent } = load('pages/logout.component.ts');
const { ClientShellComponent } = load('shells/client-shell.component.ts');
const { resolverOrigenApi, esPeticionDelOrigenApi } = load('auth/api.config.ts');

function fixture(getResponse) {
  memory.clear();
  const calls = [];
  const router = { url: '/dashboard', parseUrl: (url) => ({ redirect: url }), navigateByUrl: async (url) => { router.url = url; return true; } };
  const http = {
    get: (url) => { calls.push({ method: 'GET', url }); return getResponse(); },
    post: (url, body) => { calls.push({ method: 'POST', url, body }); return of({ token: 'revocable' }); }
  };
  const auth = new AuthService(http, router);
  services = new Map([[AuthService, auth], [Router, router]]);
  return { auth, router, http, calls };
}

const organizacion = { tipoAcceso: 'ORGANIZACION', organizacionId: 'org', rolOrganizacion: 'PROPIETARIO' };
const cliente = { tipoAcceso: 'CLIENTE', organizacionId: 'org', clienteId: 'cli', rolCliente: 'TITULAR' };
const usuario = { id: 'user', correo: 'a@b.co', nombre: 'Ana' };

test('restaura mediante /yo y aplica los guards por tipo de acceso', async () => {
  const { auth, calls } = fixture(() => of({ usuario, sesion: organizacion }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  assert.equal(await auth.restaurar(), true);
  assert.equal(calls[0].url, 'http://localhost:3000/api/autenticacion/yo');
  assert.equal(await guardOrganizacion(), true);
  assert.equal((await guardCliente()).redirect, '/dashboard');
  assert.equal(auth.rutaInicial(), '/dashboard');
});

test('un cliente entra al portal y no al CRM', async () => {
  const { auth } = fixture(() => of({ usuario, sesion: cliente }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  assert.equal(await guardCliente(), true);
  assert.equal((await guardOrganizacion()).redirect, '/portal');
  assert.equal(auth.rutaInicial(), '/portal');
});

test('la restauración rechazada con 401 elimina el token', async () => {
  const { auth } = fixture(() => throwError(() => ({ status: 401 })));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  await assert.rejects(auth.restaurar());
  assert.equal(auth.token, null);
  assert.equal(auth.sesion, null);
});

test('401 revoca el estado local; 403 mantiene una sesión válida', async () => {
  const { auth } = fixture(() => of({ usuario, sesion: organizacion }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  await auth.restaurar();
  const req = { url: 'http://localhost:3000/api/autenticacion/yo', clone: ({ setHeaders }) => ({ ...req, headers: setHeaders }) };
  await assert.rejects(firstValueFrom(authInterceptor(req, () => throwError(() => ({ status: 403 })))));
  assert.equal(auth.token, 'revocable');
  assert.equal(auth.sesion.contexto.tipoAcceso, 'ORGANIZACION');
  await assert.rejects(firstValueFrom(authInterceptor(req, () => throwError(() => ({ status: 401 })))));
  assert.equal(auth.token, null);
  assert.equal(auth.sesion, null);
});

test('el interceptor no envía credenciales a otro origen', async () => {
  const { auth } = fixture(() => of({ usuario, sesion: organizacion }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  const externo = { url: 'https://otro.example/api/datos', clone: () => { throw new Error('No debe adjuntar token'); } };
  assert.equal(await firstValueFrom(authInterceptor(externo, (req) => of(req))), externo);
  assert.equal(auth.token, 'revocable');
});

test('el interceptor adjunta el token solamente al API propio', async () => {
  fixture(() => of({ usuario, sesion: organizacion }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  const req = { url: 'http://localhost:3000/api/clientes', clone: ({ setHeaders }) => ({ headers: setHeaders }) };
  const enviado = await firstValueFrom(authInterceptor(req, (peticion) => of(peticion)));
  assert.equal(enviado.headers.Authorization, 'Bearer revocable');
});

test('cerrar sesión usa el endpoint real y elimina el token local', async () => {
  const { auth, calls, router } = fixture(() => of({ usuario, sesion: organizacion }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  await auth.cerrar();
  assert.equal(calls[0].url, 'http://localhost:3000/api/autenticacion/cerrar-sesion');
  assert.equal(auth.token, null);
  assert.equal(router.url, '/inicio-sesion');
});

test('si falla la revocación remota se conserva la sesión y el cliente puede confirmar salida local', async () => {
  const { auth, http, router } = fixture(() => of({ usuario, sesion: cliente }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  http.post = () => throwError(() => ({ status: 503 }));
  const shell = new ClientShellComponent(auth);
  await shell.salir();
  assert.equal(shell.errorCierre, true);
  assert.equal(auth.token, 'revocable');
  assert.equal(router.url, '/dashboard');
  shell.confirmarSalidaLocal();
  await shell.salirSoloLocal();
  assert.equal(auth.token, null);
  assert.equal(router.url, '/inicio-sesion');
});

test('un 401 al cerrar no dispara la redirección automática del interceptor', async () => {
  const { auth, router } = fixture(() => of({ usuario, sesion: cliente }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  const req = { url: 'http://localhost:3000/api/autenticacion/cerrar-sesion', clone: ({ setHeaders }) => ({ headers: setHeaders }) };
  await assert.rejects(firstValueFrom(authInterceptor(req, () => throwError(() => ({ status: 401 })))));
  assert.equal(auth.token, 'revocable');
  assert.equal(router.url, '/dashboard');
});

test('el cierre del CRM ofrece la misma salida local confirmada si falla el servidor', async () => {
  const { auth, http, router } = fixture(() => of({ usuario, sesion: organizacion }));
  sessionStorage.setItem('equinox_sesion_token', 'revocable');
  http.post = () => throwError(() => ({ status: 503 }));
  const page = new LogoutComponent(auth);
  await page.intentar();
  assert.equal(page.error, true);
  assert.equal(auth.token, 'revocable');
  assert.equal(router.url, '/dashboard');
  page.confirmarSalidaLocal();
  await page.salirSoloLocal();
  assert.equal(auth.token, null);
  assert.equal(router.url, '/inicio-sesion');
});

test('el origen local y el origen explícito de API se resuelven de forma segura', () => {
  assert.equal(resolverOrigenApi('localhost'), 'http://localhost:3000');
  assert.equal(resolverOrigenApi('app.example.test'), null);
  assert.equal(resolverOrigenApi('app.example.test', 'https://api.example.test'), 'https://api.example.test');
  assert.equal(resolverOrigenApi('app.example.test', 'https://api.example.test/ruta'), null);
  assert.equal(esPeticionDelOrigenApi('https://api.example.test/api/yo', 'https://api.example.test', 'https://app.example.test'), true);
  assert.equal(esPeticionDelOrigenApi('https://evil.example/api/yo', 'https://api.example.test', 'https://app.example.test'), false);
  assert.equal(esPeticionDelOrigenApi('https://api.example.test/otro', 'https://api.example.test', 'https://app.example.test'), false);
});

test('409 muestra las opciones y reenvía credenciales con la selección exacta', async () => {
  const { auth, router, http } = fixture(() => of({ usuario, sesion: cliente }));
  const opcion = { tipoAcceso: 'CLIENTE', organizacionId: 'org', clienteId: 'cli', rol: 'TITULAR', organizacion: { id: 'org', nombre: 'Estudio', slug: 'estudio' }, cliente: { id: 'cli', nombre: 'Ana', empresa: 'Acme' } };
  const enviados = [];
  http.post = (_url, body) => {
    enviados.push(body);
    return enviados.length === 1
      ? throwError(() => ({ status: 409, error: { error: 'Se requiere seleccionar un contexto de acceso', contextos: { organizaciones: [], clientes: [opcion] } } }))
      : of({ token: 'revocable' });
  };
  const login = new LoginComponent(auth, router);
  login.correo = 'a@b.co'; login.contrasena = 'secreto';
  await login.entrar({ invalid: false });
  assert.equal(login.opciones.length, 1);
  assert.equal(auth.token, null);
  await login.seleccionar(opcion);
  assert.deepEqual(JSON.parse(JSON.stringify(enviados[1])), { correo: 'a@b.co', contrasena: 'secreto', seleccion: { tipoAcceso: 'CLIENTE', organizacionId: 'org', clienteId: 'cli' } });
  assert.equal(router.url, '/portal');
  assert.equal(login.contrasena, '');
});
