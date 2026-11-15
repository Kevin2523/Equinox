const { before, test } = require('node:test');
const assert = require('node:assert/strict');
let ProyectosComponent;
global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };
before(async () => {
  await import('../node_modules/@angular/compiler/fesm2022/compiler.mjs');
  ({ ProyectosComponent } = await import('../src/pages/proyectos.component.ts'));
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function page(work = {}) {
  const api = { consultarProyecto: async (id) => ({ id }) };
  const trabajo = { listarTareas: async () => [], listarHitos: async () => [], listarComentarios: async () => [], ...work };
  return new ProyectosComponent(api, { snapshot: { queryParamMap: { get: () => null } } }, trabajo);
}
async function open(p, id) { await p.verDetalle({ id }); }

test('una creación antigua no altera el modal reabierto del mismo proyecto', async () => {
  const pending = deferred();
  const p = page({ crearHito: () => pending.promise });
  await open(p, 'a');
  p.nuevoHito.titulo = 'Anterior';
  const operation = p.crearHito();
  p.cerrarDetalle();
  await open(p, 'a');
  p.nuevoHito.titulo = 'Nuevo borrador';
  pending.resolve({ id: 'viejo' });
  await operation;
  assert.deepEqual(p.hitosDetalle, []);
  assert.equal(p.nuevoHito.titulo, 'Nuevo borrador');
  assert.equal(p.guardandoHito, false);
});

test('un fallo de edición anterior no contamina otro proyecto ni bloquea nuevas operaciones', async () => {
  const pending = deferred();
  const p = page({ editarHito: () => pending.promise });
  await open(p, 'a');
  p.hitoBorrador.titulo = 'Edición';
  const operation = p.guardarHito({ id: 'h' });
  await open(p, 'b');
  assert.equal(p.guardandoHito, false);
  pending.reject(new Error('fallo'));
  await operation;
  assert.equal(p.errorHitos, '');
  assert.equal(p.editandoHitoId, null);
});

test('cerrar y cambiar detalle limpian borradores, edición, confirmación y estados', async () => {
  const p = page();
  await open(p, 'a');
  p.nuevoHito.titulo = 'Anterior'; p.comentarioNuevo = 'Anterior';
  p.editandoHitoId = 'h'; p.confirmandoHitoId = 'h'; p.hitoBorrador.titulo = 'Anterior';
  p.errorHitos = 'error'; p.errorComentario = 'error';
  p.cerrarDetalle();
  await open(p, 'b');
  assert.equal(p.nuevoHito.titulo, '');
  assert.equal(p.comentarioNuevo, '');
  assert.equal(p.hitoBorrador.titulo, '');
  assert.equal(p.editandoHitoId, null);
  assert.equal(p.confirmandoHitoId, null);
  assert.equal(p.errorHitos, '');
  assert.equal(p.errorComentario, '');
});

test('un comentario antiguo fallido no muestra error ni desbloquea una operación nueva', async () => {
  const old = deferred(), current = deferred();
  let calls = 0;
  const p = page({ comentar: () => (++calls === 1 ? old.promise : current.promise) });
  await open(p, 'a'); p.comentarioNuevo = 'Anterior';
  const first = p.enviarComentario();
  await open(p, 'b'); p.comentarioNuevo = 'Actual';
  const second = p.enviarComentario();
  assert.equal(calls, 2);
  old.reject(new Error('viejo')); await first;
  assert.equal(p.errorComentario, '');
  assert.equal(p.enviandoComentario, true);
  current.resolve({ id: 'actual' }); await second;
  assert.deepEqual(p.comentariosDetalle.map(x => x.id), ['actual']);
});
