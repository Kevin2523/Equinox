const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { of, throwError } = require('rxjs');

global.window = {
  location: { hostname: 'localhost', origin: 'http://localhost:4200' },
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Mock de URL.createObjectURL y URL.revokeObjectURL
const urlsCreadas = new Set();
const urlsRevocadas = new Set();
let contadorUrls = 0;

global.URL.createObjectURL = (blob) => {
  const url = `blob:http://localhost:4200/mock-blob-${++contadorUrls}`;
  urlsCreadas.add(url);
  return url;
};
global.URL.revokeObjectURL = (url) => {
  urlsRevocadas.add(url);
};

const angular = { Component: () => (target) => target, Directive: () => (target) => target, Injectable: () => (target) => target, Input: () => () => {}, HostListener: () => () => {} };
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
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), `${id}.ts`);
      return load(path.relative(sourceRoot, target));
    }
    throw new Error(`Import no previsto en la prueba: ${id}`);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, window: global.window, URL: global.URL, console }, { filename });
  moduleCache.set(filename, module.exports);
  return module.exports;
}

const { PortalApiService } = load('services/portal-api.service.ts');
const { ClientHomeComponent } = load('pages/client-home.component.ts');

const identidadFotografo = {
  cliente: { id: 'cliente-foto-1', nombre: 'Ana Gómez', empresa: null },
  estudio: {
    nombre: 'Luz & Sombra Fotografía',
    logoUrl: null,
    colorPrimario: '#ff5500',
    colorSecundario: '#112233',
    tipografia: 'Inter',
    tipoFreelance: 'FOTOGRAFIA'
  }
};

const identidadGeneral = {
  cliente: { id: 'cliente-gen-1', nombre: 'Carlos Ruiz', empresa: 'DevCorp' },
  estudio: {
    nombre: 'Estudio General',
    logoUrl: null,
    colorPrimario: '#3568f6',
    colorSecundario: '#e0e0e0',
    tipografia: 'Roboto',
    tipoFreelance: 'DESARROLLO_SOFTWARE'
  }
};

const sesionPublicada1 = {
  id: 'sesion-1',
  nombre: 'Boda Ana y Pedro',
  descripcion: 'Ceremonia y recepción',
  fechaSesion: '2026-11-01',
  lugar: 'Hotel Central Casco Antiguo',
  estado: 'PUBLICADA',
  totalFotos: 2
};

const sesionPublicada2 = {
  id: 'sesion-2',
  nombre: 'Retratos Corporativos',
  descripcion: 'Sesión ejecutiva',
  fechaSesion: '2026-11-10',
  lugar: 'Costa del Este',
  estado: 'PUBLICADA',
  totalFotos: 0
};

const fotosSesion1 = [
  { id: 'foto-101', nombre: 'Entrada de la novia', tamanoBytes: 5400000 },
  { id: 'foto-102', nombre: 'Intercambio de votos', tamanoBytes: 4800000 }
];

function crearBlob(nombre = 'foto') {
  return { size: 1024, type: 'image/jpeg', name: nombre };
}

test('PortalApiService expone endpoints para sesiones, fotos y contenido blob autenticado', async () => {
  const llamadas = [];
  const http = {
    get(url, options) {
      llamadas.push({ metodo: 'GET', url, options });
      if (url.endsWith('/portal/sesiones-fotograficas')) return of([sesionPublicada1]);
      if (url.includes('/fotos?')) return of({ items: fotosSesion1, total: 2, pagina: 1, limite: 12 });
      if (url.includes('/contenido?')) return of(crearBlob());
      return of([]);
    }
  };

  const api = new PortalApiService(http);
  const sesiones = await api.sesionesFotograficas();
  assert.equal(sesiones.length, 1);
  assert.equal(sesiones[0].id, 'sesion-1');

  const fotos = await api.fotosSesion('sesion-1', 1, 12);
  assert.equal(fotos.items.length, 2);
  assert.equal(fotos.total, 2);

  const blobMiniatura = await api.obtenerContenidoFoto('sesion-1', 'foto-101', 'miniatura');
  assert.ok(blobMiniatura);
  const blobOriginal = await api.obtenerContenidoFoto('sesion-1', 'foto-101', 'original');
  assert.ok(blobOriginal);

  assert.equal(llamadas[0].url, 'http://localhost:3000/api/portal/sesiones-fotograficas');
  assert.equal(llamadas[1].url, 'http://localhost:3000/api/portal/sesiones-fotograficas/sesion-1/fotos?pagina=1&limite=12');
  assert.equal(llamadas[2].url, 'http://localhost:3000/api/portal/sesiones-fotograficas/sesion-1/fotos/foto-101/contenido?variante=miniatura');
  assert.equal(llamadas[2].options.responseType, 'blob');
  assert.equal(llamadas[3].url, 'http://localhost:3000/api/portal/sesiones-fotograficas/sesion-1/fotos/foto-101/contenido?variante=original');
  assert.equal(llamadas[3].options.responseType, 'blob');
});

test('ClientHomeComponent conmuta a vista de fotografía para tipoFreelance FOTOGRAFIA y preserva proyectos para otros', async () => {
  let llamadosSesiones = 0;
  let llamadosProyectos = 0;

  const api = {
    identidad: async () => identidadFotografo,
    sesionesFotograficas: async () => { llamadosSesiones++; return [sesionPublicada1]; },
    proyectos: async () => { llamadosProyectos++; return []; },
    facturas: async () => [],
    fotosSesion: async () => ({ items: [], total: 0, pagina: 1, limite: 12 }),
    obtenerContenidoFoto: async () => crearBlob()
  };

  const page = new ClientHomeComponent(api);
  await page.cargarIdentidad();
  assert.equal(page.esFotografia, true);

  await page.inicializar();
  assert.equal(llamadosSesiones, 1);
  assert.equal(llamadosProyectos, 0);

  // Probar con estudio tipo DESARROLLO_SOFTWARE
  const apiGeneral = {
    identidad: async () => identidadGeneral,
    sesionesFotograficas: async () => { llamadosSesiones++; return []; },
    proyectos: async () => { llamadosProyectos++; return []; },
    facturas: async () => []
  };

  const pageGeneral = new ClientHomeComponent(apiGeneral);
  await pageGeneral.cargarIdentidad();
  assert.equal(pageGeneral.esFotografia, false);

  await pageGeneral.inicializar();
  assert.equal(llamadosProyectos, 1);
});

test('cargarSesiones maneja carga, error con reintento, selección automática y estado vacío', async () => {
  let intentos = 0;
  const api = {
    sesionesFotograficas: async () => {
      if (++intentos === 1) throw new Error('fallo de red');
      return [sesionPublicada1, sesionPublicada2];
    },
    fotosSesion: async () => ({ items: [], total: 0, pagina: 1, limite: 12 }),
    obtenerContenidoFoto: async () => crearBlob()
  };

  const page = new ClientHomeComponent(api);
  const cargaFallida = page.cargarSesiones();
  assert.equal(page.cargandoSesiones, true);
  await cargaFallida;
  assert.equal(page.cargandoSesiones, false);
  assert.match(page.errorSesiones, /No se pudieron cargar tus sesiones fotográficas/);
  assert.equal(page.sesiones.length, 0);

  // Reintento exitoso
  await page.cargarSesiones();
  assert.equal(page.errorSesiones, '');
  assert.equal(page.sesiones.length, 2);
  // Debe seleccionar automáticamente la primera sesión
  assert.equal(page.sesionId, 'sesion-1');
  assert.equal(page.sesionSeleccionada.nombre, 'Boda Ana y Pedro');

  // Si no hay sesiones
  const apiVacia = { sesionesFotograficas: async () => [] };
  const pageVacia = new ClientHomeComponent(apiVacia);
  await pageVacia.cargarSesiones();
  assert.equal(pageVacia.sesiones.length, 0);
  assert.equal(pageVacia.sesionId, null);
  assert.equal(pageVacia.sesionSeleccionada, null);
});

test('cargarFotos genera URLs de blob temporales mediante HttpClient y las revoca al cambiar sesión o destruir', async () => {
  urlsCreadas.clear();
  urlsRevocadas.clear();

  const api = {
    fotosSesion: async () => ({ items: fotosSesion1, total: 2, pagina: 1, limite: 12 }),
    obtenerContenidoFoto: async () => crearBlob()
  };

  const page = new ClientHomeComponent(api);
  page.sesionId = 'sesion-1';
  await page.cargarFotos('sesion-1', 1);

  // Esperar resolución de promesas microtask para las miniaturas
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(page.fotos.length, 2);
  assert.equal(page.miniaturasUrls.size, 2);
  assert.ok(page.miniaturasUrls.has('foto-101'));
  assert.ok(page.miniaturasUrls.has('foto-102'));
  const url1 = page.miniaturasUrls.get('foto-101');
  const url2 = page.miniaturasUrls.get('foto-102');
  assert.ok(urlsCreadas.has(url1));
  assert.ok(urlsCreadas.has(url2));

  // Al cambiar a otra sesión o limpiar fotos, se deben revocar las URLs anteriores
  page.seleccionarSesion('sesion-2');
  assert.ok(urlsRevocadas.has(url1), 'La URL 1 debe haber sido revocada');
  assert.ok(urlsRevocadas.has(url2), 'La URL 2 debe haber sido revocada');

  // En ngOnDestroy se asegura la liberación de memoria
  page.ngOnDestroy();
  assert.equal(page.miniaturasUrls.size, 0);
});

test('Visor ampliado accesible permite abrir, navegar con teclado, cargar original y revocar URLs', async () => {
  urlsCreadas.clear();
  urlsRevocadas.clear();

  let varianteSolicitada = '';
  const api = {
    fotosSesion: async () => ({ items: fotosSesion1, total: 2, pagina: 1, limite: 12 }),
    obtenerContenidoFoto: async (_sesionId, _fotoId, variante) => {
      varianteSolicitada = variante;
      return crearBlob(variante);
    }
  };

  const page = new ClientHomeComponent(api);
  page.sesionId = 'sesion-1';
  page.fotos = fotosSesion1;

  // Abrir visor con la primera foto
  await page.abrirVisor(fotosSesion1[0], 0);
  assert.equal(page.fotoSeleccionada.id, 'foto-101');
  assert.equal(page.indiceFotoSeleccionada, 0);
  assert.equal(varianteSolicitada, 'original');
  const urlOriginal1 = page.fotoOriginalUrl;
  assert.ok(urlOriginal1);
  assert.ok(urlsCreadas.has(urlOriginal1));

  // Navegar a la siguiente foto usando teclado (ArrowRight)
  page.manejarTeclado({ key: 'ArrowRight', preventDefault: () => {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(page.indiceFotoSeleccionada, 1);
  assert.equal(page.fotoSeleccionada.id, 'foto-102');
  assert.ok(urlsRevocadas.has(urlOriginal1), 'La URL original anterior debe revocarse');

  // Navegar a la foto anterior usando teclado (ArrowLeft)
  page.manejarTeclado({ key: 'ArrowLeft', preventDefault: () => {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(page.indiceFotoSeleccionada, 0);

  // Cerrar visor con tecla Escape
  page.manejarTeclado({ key: 'Escape', preventDefault: () => {} });
  assert.equal(page.fotoSeleccionada, null);
  assert.equal(page.indiceFotoSeleccionada, -1);
  assert.equal(page.fotoOriginalUrl, null);
});

test('Paginación de la galería fotográfica calcula páginas y navega entre rangos', async () => {
  let paginaCargada = 0;
  const api = {
    fotosSesion: async (_sesionId, pagina) => {
      paginaCargada = pagina;
      return { items: [], total: 30, pagina, limite: 12 };
    },
    obtenerContenidoFoto: async () => crearBlob()
  };

  const page = new ClientHomeComponent(api);
  page.sesionId = 'sesion-1';
  await page.cargarFotos('sesion-1', 1);

  assert.equal(page.totalFotos, 30);
  assert.equal(page.totalPaginas, 3); // 30 / 12 = 2.5 -> 3 páginas
  assert.equal(page.paginaFotos, 1);

  await page.paginaSiguiente();
  assert.equal(page.paginaFotos, 2);
  assert.equal(paginaCargada, 2);

  await page.paginaSiguiente();
  assert.equal(page.paginaFotos, 3);

  // No debe pasar del límite
  await page.paginaSiguiente();
  assert.equal(page.paginaFotos, 3);

  await page.paginaAnterior();
  assert.equal(page.paginaFotos, 2);
});

test('La plantilla y estilos del portal fotográfico cumplen accesibilidad, sin descarga no autorizada y sin secciones de proyectos para FOTOGRAFIA', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../src/pages/client-home.component.html'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../src/pages/client-home.component.css'), 'utf8');

  // Separación por tipo: !esFotografia y esFotografia
  assert.match(template, /\*ngIf="!esFotografia"/);
  assert.match(template, /\*ngIf="esFotografia"/);

  // Vista fotográfica contiene sesiones y galería editorial
  assert.match(template, /TUS SESIONES/);
  assert.match(template, /SESIÓN FOTOGRÁFICA/);
  assert.match(template, /role="grid"/);
  assert.match(template, /role="gridcell"/);

  // Visor ampliado accesible (Lightbox modal)
  assert.match(template, /role="dialog"/);
  assert.match(template, /aria-modal="true"/);
  assert.match(template, /aria-labelledby="visor-titulo"/);
  assert.match(template, /aria-label="Cerrar visor ampliado"/);
  assert.match(template, /aria-label="Fotografía anterior"/);
  assert.match(template, /aria-label="Fotografía siguiente"/);

  // NO debe contener enlaces de descarga para fotos (requisito: no descarga implícita)
  assert.doesNotMatch(template, /<a[^>]*download[^>]*foto/i);

  // Estilos de cuadrícula y visor
  assert.match(styles, /\.photo-grid/);
  assert.match(styles, /\.editorial-lightbox-backdrop/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});
