const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let ClientesComponent;
before(async () => {
  await import('../node_modules/@angular/compiler/fesm2022/compiler.mjs');
  ({ ClientesComponent } = await import('../src/pages/clientes.component.ts'));
});
function formComponent() {
  const saved = [];
  const api = { clientes: [], async crearCliente(data) { saved.push(data); } };
  const c = new ClientesComponent(api, {}, {});
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
