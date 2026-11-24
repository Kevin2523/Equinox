const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };
const angular = {
  Component: () => (target) => target,
  Directive: () => (target) => target,
  Injectable: () => (target) => target,
  Optional: () => () => {},
  Pipe: () => (target) => target,
  inject: () => ({}),
  signal: (v) => Object.assign(() => v, { set() {}, update() {}, asReadonly: () => (() => v) }),
  computed: (fn) => fn,
  HostListener: () => () => {},
  Input: () => () => {},
  Output: () => () => {},
  ViewChild: () => () => {},
  EventEmitter: class {}
};
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
    if (id === 'rxjs') return require('rxjs');
    if (id.startsWith('.')) return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), `${id}.ts`)));
    throw new Error(`Import no previsto: ${id}`);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, window: global.window, URL, console }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const { ClientesComponent } = load('pages/clientes.component.ts');
const { UiStateService } = load('state/ui-state.service.ts');

function formComponent() {
  const saved = [];
  const api = {
    clientes: [],
    async crearCliente(data) { saved.push(data); return { id: 'c1', ...data }; },
    async consultarCliente(id) { return { id }; }
  };
  const c = new ClientesComponent(api, {}, {}, {}, {});
  c.formulario.nombre = 'Cliente Ficticio';
  return { c, saved };
}
test('sitio web opcional: blanco se guarda como null', async () => {
  const { c, saved } = formComponent();
  await c.guardar({ invalid: false });
  assert.equal(saved[0].sitioWeb, null);
});
test('sitio web sin protocolo: acepta dominio y guarda una URL válida', async () => {
  const { c, saved } = formComponent();
  c.formulario.sitioWeb = 'www.ejemplo.com';
  await c.guardar({ invalid: false });
  assert.equal(saved[0].sitioWeb, 'https://www.ejemplo.com/');
});
test('sitio web inválido: explica el error y conserva el formulario sin llamar a la API', async () => {
  const { c, saved } = formComponent();
  c.formulario.sitioWeb = 'no es una dirección';
  await c.guardar({ invalid: false });
  assert.equal(saved.length, 0);
  assert.match(c.errorGuardar, /sitio web válido/);
  assert.equal(c.formulario.sitioWeb, 'no es una dirección');
});

test('ClientesComponent: nuevo() abre el modal y guardar() valida nombre mínimo tras trim', async () => {
  const { c, saved } = formComponent();
  c.nuevo();
  assert.equal(c.modalFormulario, true);
  c.formulario.nombre = '  A  ';
  await c.guardar({ invalid: false });
  assert.equal(saved.length, 0);
  assert.match(c.errorGuardar, /al menos 2 caracteres/);
  assert.equal(c.modalFormulario, true);

  c.formulario.nombre = '  Ana Méndez  ';
  await c.guardar({ invalid: false });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].nombre, 'Ana Méndez');
  assert.equal(c.modalFormulario, false);
});

test('UiStateService: creación rápida de cliente muestra error si nombre vacío y crea cliente cuando es válido', async () => {
  const estado = Object.create(UiStateService.prototype);
  estado.createModalOpen = false;
  estado.activeCreateType = null;
  estado.crearLoading = false;
  estado.createError = '';
  estado.nuevoCliente = { nombre: '', empresa: '', correo: '', telefono: '', notas: '' };
  estado.nuevoProyecto = { nombre: '', clienteId: '', descripcion: '', estado: 'BORRADOR', presupuesto: 0, moneda: 'PAB', fechaInicio: '', fechaEntrega: '' };
  estado.clientes = [];
  const toasts = [];
  const creados = [];
  estado.equinox = { mostrarToast: (msg) => toasts.push(msg) };
  estado.clientesProyectosApi = {
    crearCliente: async (datos) => { creados.push(datos); return { id: 'c-nuevo', ...datos }; }
  };

  estado.openQuickCreate('Cliente');
  assert.equal(estado.createModalOpen, true);
  assert.equal(estado.activeCreateType, 'Cliente');

  estado.nuevoCliente.nombre = '   ';
  await estado.submitCreate();
  assert.equal(creados.length, 0);
  assert.match(estado.createError, /mínimo 2 caracteres/);
  assert.equal(estado.createModalOpen, true);

  estado.nuevoCliente.nombre = '  Café Unido  ';
  estado.nuevoCliente.correo = '  hola@cafe.pa  ';
  await estado.submitCreate();
  assert.equal(creados.length, 1);
  assert.equal(creados[0].nombre, 'Café Unido');
  assert.equal(creados[0].correo, 'hola@cafe.pa');
  assert.equal(estado.createModalOpen, false);
  assert.equal(estado.activeCreateType, null);
  assert.equal(toasts[0], 'Cliente creado con éxito');
});
