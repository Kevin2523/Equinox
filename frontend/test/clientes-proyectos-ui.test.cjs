const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const rxjs = require('rxjs');

global.window = {
  location: { hostname: 'localhost', origin: 'http://localhost:4200' },
  __EQUINOX_API_ORIGIN__: undefined
};

let WorkMapComponent;
let ProyectosComponent;
let ClientesProyectosApiService;
before(async () => {
  await import('../node_modules/@angular/compiler/fesm2022/compiler.mjs');
  ({ WorkMapComponent } = await import('../src/shared/work-map.component.ts'));
  ({ ProyectosComponent } = await import('../src/pages/proyectos.component.ts'));
  ({ ClientesProyectosApiService } = await import('../src/services/clientes-proyectos-api.service.ts'));
});

const proyecto = (id, cambios = {}) => ({
  id, organizacionId: 'org-a', clienteId: 'cliente-a', creadoPorId: 'usuario-a',
  nombre: `Proyecto ${id}`, descripcion: null, estado: 'ACTIVO', presupuesto: 100,
  moneda: 'PAB', fechaInicio: null, fechaEntrega: null, creadoEn: '', actualizadoEn: '',
  cliente: { id: 'cliente-a', nombre: 'Cliente A', empresa: null }, ...cambios
});

function crearMapa(proyectos, seleccionado = null, falloConsulta = false) {
  const api = {
    proyectos,
    proyectoSeleccionado: seleccionado,
    limpiarProyectoSeleccionado() { this.proyectoSeleccionado = null; },
    async listarProyectos() { return this.proyectos; },
    async listarClientes() { return []; },
    async seleccionarProyecto(id) {
      if (falloConsulta) throw new Error('fallo de red');
      this.proyectoSeleccionado = this.proyectos.find((item) => item.id === id);
      return this.proyectoSeleccionado;
    }
  };
  return { component: new WorkMapComponent({ query: '' }, api), api };
}

test('el mapa consulta y selecciona el primer proyecto después de cargar', async () => {
  const { component, api } = crearMapa([proyecto('p-1'), proyecto('p-2')]);
  await component.cargar();
  assert.equal(api.proyectoSeleccionado.id, 'p-1');
  assert.equal(component.error, '');
});

test('el mapa conserva una selección vigente y limpia la selección cuando la lista está vacía', async () => {
  const { component, api } = crearMapa([proyecto('p-1')], proyecto('p-1', { nombre: 'Detalle vigente' }));
  await component.cargar();
  assert.equal(api.proyectoSeleccionado.nombre, 'Detalle vigente');

  const vacio = crearMapa([], proyecto('eliminado'));
  await vacio.component.cargar();
  assert.equal(vacio.api.proyectoSeleccionado, null);
  assert.equal(vacio.component.error, '');
  assert.deepEqual(vacio.component.proyectosMapa, []);
});

test('si falla la consulta del proyecto inicial, el mapa muestra un error recuperable sin selección falsa', async () => {
  const { component, api } = crearMapa([proyecto('p-1')], null, true);
  await component.cargar();
  assert.equal(api.proyectoSeleccionado, null);
  assert.match(component.error, /No se pudo cargar/);
});

test('la ruta editar espera a clientes, y deja seleccionado el cliente asociado', async () => {
  const cliente = { id: 'cliente-a', nombre: 'Cliente A', empresa: null };
  const registro = proyecto('p-1');
  let resolverClientes;
  let llamadasConsulta = 0;
  const api = {
    proyectos: [registro], clientes: [],
    async listarProyectos() { return this.proyectos; },
    listarClientes() {
      return new Promise((resolve) => {
        resolverClientes = () => { this.clientes = [cliente]; resolve(this.clientes); };
      });
    },
    async consultarProyecto() { llamadasConsulta++; return registro; }
  };
  const route = { snapshot: { queryParamMap: { get: (key) => key === 'editar' ? 'p-1' : null } } };
  const component = new ProyectosComponent(api, route);
  component.ngOnInit();
  await Promise.resolve();
  assert.equal(component.modalFormulario, false);
  assert.equal(llamadasConsulta, 0);

  resolverClientes();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(component.modalFormulario, true);
  assert.equal(component.formulario.clienteId, cliente.id);
  assert.ok(component.clientes.some((item) => item.id === component.formulario.clienteId));
});

test('editar actualiza el proyecto seleccionado del inspector con los valores de la API', async () => {
  const clienteA = { id: 'cliente-a', nombre: 'Cliente A', empresa: null };
  const clienteB = { id: 'cliente-b', nombre: 'Cliente B', empresa: 'B S.A.' };
  const actualizado = proyecto('p-1', {
    clienteId: clienteB.id, nombre: 'Nombre actualizado', estado: 'PAUSADO', presupuesto: 850,
    fechaInicio: '2026-04-01T00:00:00.000Z', fechaEntrega: '2026-05-01T00:00:00.000Z', cliente: clienteB
  });
  const http = {
    get(url) {
      if (url.endsWith('/clientes')) return rxjs.of([clienteA, clienteB]);
      if (url.endsWith('/proyectos/p-1')) return rxjs.of(proyecto('p-1'));
      return rxjs.of([actualizado]);
    },
    patch() { return rxjs.of(actualizado); }
  };
  const api = new ClientesProyectosApiService(http);
  await api.listarClientes();
  await api.seleccionarProyecto('p-1');
  await api.editarProyecto('p-1', { nombre: actualizado.nombre, clienteId: clienteB.id });

  assert.deepEqual(api.proyectoSeleccionado, { ...actualizado, cliente: clienteB });
});
