const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { BehaviorSubject, Subject, of } = require('rxjs');
let TrabajoApiService, progresoTareas, TareasComponent, ProyectosComponent, UiStateService;
global.window = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };

before(async () => {
  await import('../node_modules/@angular/compiler/fesm2022/compiler.mjs');
  ({ TrabajoApiService, progresoTareas } = await import('../src/services/trabajo-api.service.ts'));
  ({ TareasComponent } = await import('../src/pages/tareas.component.ts'));
  ({ ProyectosComponent } = await import('../src/pages/proyectos.component.ts'));
  ({ UiStateService } = await import('../src/state/ui-state.service.ts'));
});

function diferida() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
}

test('el servicio usa las rutas reales y publica cambios solo tras guardar', async () => {
  const llamadas = [];
  const http = {
    get: (url) => { llamadas.push(['GET', url]); return of([]); },
    post: (url, body) => { llamadas.push(['POST', url, body]); return of({ id: 't-1' }); },
    patch: (url, body) => { llamadas.push(['PATCH', url, body]); return of({ id: 't-1' }); },
    delete: (url) => { llamadas.push(['DELETE', url]); return of(null); },
  };
  const sesion = new BehaviorSubject({ contexto: { tipoAcceso: 'ORGANIZACION' } });
  const api = new TrabajoApiService(http, { sesion$: sesion.asObservable() });
  let cambios = 0;
  api.cambios$.subscribe(() => cambios++);
  await api.listarTareas('proyecto-1');
  await api.crearTarea('proyecto-1', { titulo: 'Preparar entrega' });
  await api.editarTarea('proyecto-1', 't-1', { estado: 'COMPLETADA' });
  await api.eliminarTarea('proyecto-1', 't-1');
  await api.listarHitos('proyecto-1');
  await api.crearHito('proyecto-1', { titulo: 'Entrega', visibleEnPortal: false });
  await api.comentar('proyecto-1', 'Mensaje real');
  assert.equal(cambios, 3);
  assert.deepEqual(llamadas.map(([metodo, url]) => [metodo, new URL(url).pathname]), [
    ['GET', '/api/proyectos/proyecto-1/tareas'], ['POST', '/api/proyectos/proyecto-1/tareas'],
    ['PATCH', '/api/proyectos/proyecto-1/tareas/t-1'], ['DELETE', '/api/proyectos/proyecto-1/tareas/t-1'],
    ['GET', '/api/proyectos/proyecto-1/hitos'], ['POST', '/api/proyectos/proyecto-1/hitos'],
    ['POST', '/api/proyectos/proyecto-1/comentarios'],
  ]);
  assert.deepEqual(llamadas[5][2], { titulo: 'Entrega', visibleEnPortal: false });
  assert.deepEqual(llamadas[6][2], { contenido: 'Mensaje real' });
  api.registrarTareas([{ id: 't-1' }]);
  sesion.next(null);
  assert.deepEqual(api.tareasActuales, []);
});

test('el progreso excluye canceladas y queda indefinido sin tareas vigentes', () => {
  assert.equal(progresoTareas([]), null);
  assert.equal(progresoTareas([{ estado: 'CANCELADA' }]), null);
  assert.equal(progresoTareas([{ estado: 'COMPLETADA' }, { estado: 'PENDIENTE' }, { estado: 'CANCELADA' }]), 50);
});

test('la página de tareas descarta una carga vieja y muestra la respuesta vigente', async () => {
  const primera = diferida();
  const segunda = diferida();
  let consultas = 0;
  const trabajo = { cambios$: of(), registrarTareas: (tareas) => { trabajo.actuales = tareas; },
    listarTareas: () => (++consultas === 1 ? primera.promesa : segunda.promesa) };
  const proyectos = { listarProyectos: async () => [{ id: 'p', nombre: 'Proyecto' }] };
  const state = { query: '', taskFilter: 'TODAS', proyectos: [{ id: 'p' }] };
  const pagina = new TareasComponent(state, proyectos, trabajo, { token: 'fixture' });
  const vieja = pagina.cargar();
  await Promise.resolve();
  const nueva = pagina.cargar();
  await Promise.resolve();
  segunda.resolver([{ id: 'vigente', proyectoId: 'p', titulo: 'Vigente', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: null }]);
  await nueva;
  primera.resolver([{ id: 'obsoleta', proyectoId: 'p', titulo: 'Obsoleta', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: null }]);
  await vieja;
  assert.equal(pagina.tareas[0].id, 'vigente');
  assert.equal(trabajo.actuales[0].id, 'vigente');
  assert.equal(pagina.cargando, false);
});

test('completar una tarea refresca el progreso calculado desde la respuesta persistida', async () => {
  const cambios = new Subject();
  const sesion = new BehaviorSubject({ contexto: { tipoAcceso: 'ORGANIZACION' } });
  let registro = { id: 't', proyectoId: 'p', titulo: 'Entrega', estado: 'PENDIENTE', prioridad: 'MEDIA', fechaVencimiento: null };
  const trabajo = { cambios$: cambios.asObservable(), registrarTareas: () => {}, listarTareas: async () => [registro],
    editarTarea: async () => { registro = { ...registro, estado: 'COMPLETADA' }; cambios.next(); return registro; } };
  const pagina = new TareasComponent({ query: '', taskFilter: 'TODAS', proyectos: [{ id: 'p' }] },
    { listarProyectos: async () => [{ id: 'p', nombre: 'Proyecto' }] }, trabajo,
    { token: 'fixture', sesion$: sesion.asObservable() });
  pagina.ngOnInit();
  await new Promise(setImmediate);
  assert.equal(pagina.progreso('p'), 0);
  await pagina.alternar(pagina.tareas[0]);
  await new Promise(setImmediate);
  assert.equal(pagina.progreso('p'), 100);
  pagina.ngOnDestroy();
});

test('el formulario rápido crea la tarea en la API y conserva el error para reintentar', async () => {
  const estado = Object.create(UiStateService.prototype);
  estado.activeCreateType = 'Tarea'; estado.nuevaTarea = { proyectoId: 'p', titulo: 'Trabajo real', prioridad: 'ALTA', fechaVencimiento: '' };
  estado.proyectos = [{ id: 'p' }]; estado.createModalOpen = true; estado.crearLoading = false; estado.createError = '';
  let fallar = true;
  const llamadas = [];
  estado.trabajo = { crearTarea: async (...args) => { llamadas.push(args); if (fallar) throw new Error('falla'); return { id: 't' }; } };
  await estado.submitCreate();
  assert.equal(estado.createModalOpen, true);
  assert.match(estado.createError, /No se pudo crear/);
  assert.equal(estado.crearLoading, false);
  fallar = false;
  await estado.submitCreate();
  assert.equal(estado.createModalOpen, false);
  assert.equal(llamadas.length, 2);
  assert.deepEqual(llamadas[1], ['p', { titulo: 'Trabajo real', prioridad: 'ALTA', fechaVencimiento: null }]);
});

test('acciones inline conservan borrador y error para reintentar', async () => {
  const estado = Object.create(UiStateService.prototype);
  estado.clientesProyectosApi = { proyectoSeleccionado: { id: 'p' } };
  estado.inlineTaskTitle = ' Entrega '; estado.inlineCommentText = ' Revisión ';
  const tarea = diferida(); const comentario = diferida();
  let fallar = true;
  estado.trabajo = {
    crearTarea: () => fallar ? tarea.promesa : Promise.resolve({ id: 't' }),
    comentar: () => fallar ? comentario.promesa : Promise.resolve({ id: 'c' }),
  };
  const pendienteTarea = estado.addInlineTask();
  const pendienteComentario = estado.addInlineComment();
  assert.equal(estado.inlineTaskTitle, ' Entrega ');
  assert.equal(estado.inlineCommentText, ' Revisión ');
  tarea.resolver(Promise.reject(new Error('sin red')));
  comentario.resolver(Promise.reject(new Error('sin red')));
  await Promise.all([pendienteTarea, pendienteComentario]);
  assert.equal(estado.inlineTaskTitle, ' Entrega ');
  assert.equal(estado.inlineCommentText, ' Revisión ');
  assert.match(estado.inlineTaskError, /No se pudo/);
  assert.match(estado.inlineCommentError, /No se pudo/);
  fallar = false;
  await Promise.all([estado.addInlineTask(), estado.addInlineComment()]);
  assert.equal(estado.inlineTaskTitle, '');
  assert.equal(estado.inlineCommentText, '');
});

test('búsqueda incluye proyectos nuevos aunque otras tareas estén cargadas', async () => {
  const estado = Object.create(UiStateService.prototype);
  const consultados = [];
  estado.auth = { token: 'fixture', sesion: { contexto: { tipoAcceso: 'ORGANIZACION' } } };
  estado.searchLoading = false; estado.searchError = '';
  estado.clientesProyectosApi = { proyectos: [{ id: 'p1' }] };
  estado.trabajo = { tareasCargadas: true, tareasActuales: [],
    listarTareas: async (id) => { consultados.push(id); return [{ id: `t-${id}`, proyectoId: id }]; },
    registrarTareas(tareas) { this.tareasActuales = tareas; this.tareasCargadas = true; } };
  await estado.cargarTareasBusqueda();
  estado.clientesProyectosApi.proyectos.push({ id: 'p2' });
  await estado.cargarTareasBusqueda();
  assert.deepEqual(consultados, ['p1', 'p1', 'p2']);
  assert.deepEqual(estado.trabajo.tareasActuales.map((t) => t.proyectoId), ['p1', 'p2']);
});

test('el detalle conserva autor/fecha recibidos y crea hitos privados por defecto', async () => {
  const hito = { id: 'h', titulo: 'Hito', visibleEnPortal: false, estado: 'PENDIENTE' };
  const comentario = { id: 'c', contenido: 'Hola', autor: 'FREELANCER', creadoEn: '2026-11-01T12:00:00Z', usuario: { nombre: 'Ana', apellido: 'R' } };
  const llamadas = [];
  const trabajo = { listarTareas: async () => [], listarHitos: async () => [], listarComentarios: async () => [],
    crearHito: async (id, datos) => { llamadas.push(['hito', id, datos]); return hito; },
    comentar: async (id, contenido) => { llamadas.push(['comentario', id, contenido]); return comentario; } };
  const api = { consultarProyecto: async () => ({ id: 'p', nombre: 'Proyecto' }), proyectos: [] };
  const pagina = new ProyectosComponent(api, { snapshot: { queryParamMap: { get: () => null } } }, trabajo);
  await pagina.verDetalle({ id: 'p' });
  pagina.nuevoHito.titulo = 'Hito';
  await pagina.crearHito();
  pagina.comentarioNuevo = 'Hola';
  await pagina.enviarComentario();
  assert.equal(pagina.hitosDetalle[0].visibleEnPortal, false);
  assert.equal(pagina.autor(pagina.comentariosDetalle[0]), 'Ana R');
  assert.equal(pagina.comentariosDetalle[0].creadoEn, comentario.creadoEn);
  assert.equal(llamadas[0][2].visibleEnPortal, false);
});
