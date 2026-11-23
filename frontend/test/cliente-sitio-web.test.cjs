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
