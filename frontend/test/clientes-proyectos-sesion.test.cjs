const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { BehaviorSubject, Subject } = require('rxjs');
let Servicio;
global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };
before(async () => {
  await import('../node_modules/@angular/compiler/fesm2022/compiler.mjs');
  ({ ClientesProyectosApiService: Servicio } = await import('../src/services/clientes-proyectos-api.service.ts'));
});
const registro = (id) => ({ id, clienteId: 'c', nombre: id });
function escenario() {
  const sesion = new BehaviorSubject({ usuario: { id: 'a' } });
  const pendientes = [];
  const http = { get(url) { const respuesta = new Subject(); pendientes.push({ url, respuesta }); return respuesta; } };
  const api = new Servicio(http, { sesion$: sesion.asObservable() });
  return { api, sesion, pendientes };
}
test('descarta listas pendientes y limpia datos al cambiar o cerrar sesión', async () => {
  const { api, sesion, pendientes } = escenario();
  const cliente = api.listarClientes();
  const proyecto = api.listarProyectos();
  sesion.next({ usuario: { id: 'b' } });
  assert.deepEqual(api.clientes, []);
  pendientes[0].respuesta.next([registro('antiguo-c')]);
  pendientes[0].respuesta.complete();
  pendientes[1].respuesta.next([registro('antiguo-p')]);
  pendientes[1].respuesta.complete();
  await Promise.all([cliente, proyecto]);
  assert.deepEqual(api.clientes, []);
  assert.deepEqual(api.proyectos, []);
  const vigente = api.listarClientes();
  pendientes[2].respuesta.next([registro('nuevo')]);
  pendientes[2].respuesta.complete();
  await vigente;
  assert.equal(api.clientes[0].id, 'nuevo');
  sesion.next(null);
  assert.deepEqual(api.clientes, []);
  assert.deepEqual(api.proyectos, []);
});
test('descarta selección pendiente y limpia selección existente al cerrar sesión', async () => {
  const { api, sesion, pendientes } = escenario();
  const seleccion = api.seleccionarProyecto('p');
  sesion.next(null);
  pendientes[0].respuesta.next(registro('p'));
  pendientes[0].respuesta.complete();
  await seleccion;
  assert.equal(api.proyectoSeleccionado, null);
});
