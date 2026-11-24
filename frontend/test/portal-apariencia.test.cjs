const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const FRONTEND_SRC = path.resolve(__dirname, '../src');

function loadTs(relPath, customMocks = {}) {
  const fullPath = path.resolve(FRONTEND_SRC, relPath);
  if (fullPath.endsWith('.json')) {
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return { __esModule: true, default: parsed, ...parsed };
  }
  const source = fs.readFileSync(fullPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
    fileName: fullPath,
  });

  const moduleObj = { exports: {} };
  const dir = path.dirname(fullPath);

  const localRequire = (spec) => {
    if (customMocks[spec]) return customMocks[spec];
    if (spec === '@angular/core') {
      const noop = () => () => {};
      return {
        Component: noop,
        Directive: noop,
        Injectable: noop,
        Pipe: noop,
        Input: noop,
        Optional: noop,
        ViewChild: noop,
        HostListener: noop,
        signal: (val) => {
          let v = val;
          const fn = () => v;
          fn.set = (next) => { v = next; };
          fn.asReadonly = () => fn;
          return fn;
        },
        computed: (fn) => fn,
        inject: (token) => {
          if (token && token.__mockInstance) return token.__mockInstance;
          return {};
        },
      };
    }
    if (spec === '@angular/common') return { CommonModule: {} };
    if (spec === '@angular/forms') return { FormsModule: {} };
    if (spec.startsWith('.')) {
      const resolved = path.resolve(dir, spec);
      if (resolved.endsWith('.json') && fs.existsSync(resolved)) {
        return loadTs(path.relative(FRONTEND_SRC, resolved), customMocks);
      }
      const tsFile = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
      if (fs.existsSync(tsFile)) {
        return loadTs(path.relative(FRONTEND_SRC, tsFile), customMocks);
      }
    }
    return {};
  };

  vm.runInNewContext(transpiled.outputText, {
    module: moduleObj,
    exports: moduleObj.exports,
    require: localRequire,
    console,
    setTimeout,
    clearTimeout,
    window: { location: { hostname: 'localhost', origin: 'http://localhost:4200' } },
  });

  return moduleObj.exports;
}

test('branding.util fija tipografía coherente del producto y calcula tokens de contraste accesible', () => {
  const branding = loadTs('utils/branding.util.ts');
  assert.equal(branding.obtenerFontStack('Inter'), branding.TIPOGRAFIA_PRODUCTO_STACK);
  assert.equal(branding.obtenerFontStack('DM Sans'), branding.TIPOGRAFIA_PRODUCTO_STACK);
  assert.equal(branding.obtenerFontStack('Manrope'), branding.TIPOGRAFIA_PRODUCTO_STACK);
  assert.equal(branding.obtenerFontStack('Comic Sans MS'), branding.TIPOGRAFIA_PRODUCTO_STACK);

  const paletaRoja = branding.evaluarContrastePaleta('#FF1117', '#0F172A');
  assert.ok(['#FFFFFF', '#0F172A'].includes(paletaRoja.textoSobrePrimario));
  assert.ok(branding.calcularRatioContraste('#FF1117', paletaRoja.textoSobrePrimario) >= 4.5);
  assert.equal(paletaRoja.textoSobreSecundario, '#FFFFFF');
  assert.ok(paletaRoja.fondoSuavePrimario.startsWith('rgba(255, 17, 23,'));
  assert.ok(paletaRoja.bordeSuavePrimario.startsWith('rgba(255, 17, 23,'));

  const paletaAzul = branding.evaluarContrastePaleta('#1D4ED8', '#0F172A');
  assert.equal(paletaAzul.textoSobrePrimario, '#FFFFFF');

  const paletaClara = branding.evaluarContrastePaleta('#FFDD63', '#F8FAFC');
  assert.equal(paletaClara.textoSobrePrimario, '#0F172A');
  assert.equal(paletaClara.textoSobreSecundario, '#0F172A');
  assert.ok(branding.calcularRatioContraste(paletaClara.textoPrimarioSobreClaro, '#FFFFFF') >= 4.5);
});

test('ClientHomeComponent ignora tipografía legada y expone tokens de color primario/secundario', () => {
  const { ClientHomeComponent } = loadTs('pages/client-home.component.ts');
  const branding = loadTs('utils/branding.util.ts');
  const comp = new ClientHomeComponent({}, { sesion: null });
  comp.identidad = {
    cliente: { id: 'c1', nombre: 'Dixon', empresa: null },
    estudio: {
      nombre: 'Mena Studios',
      logoUrl: null,
      colorPrimario: '#FF1117',
      colorSecundario: '#0F172A',
      tipografia: 'Manrope',
      portalMensajeBienvenida: null,
      tipoFreelance: 'DESARROLLO_SOFTWARE',
    },
  };
  assert.equal(comp.colorPrimarioPortal, '#FF1117');
  assert.equal(comp.colorSecundarioPortal, '#0F172A');
  assert.equal(comp.fontFamilyPortal, branding.TIPOGRAFIA_PRODUCTO_STACK);
  assert.ok(['#FFFFFF', '#0F172A'].includes(comp.contrastePortal.textoSobrePrimario));
});

test('PortalPreviewComponent refleja datos reales, estados vacíos honestos, fotografía/general y desktop/móvil', () => {
  const { PortalPreviewComponent } = loadTs('shared/portal-preview.component.ts');
  const preview = new PortalPreviewComponent();
  preview.nombreEstudio = 'Mena Studios';
  preview.colorPrimario = '#FF1117';
  preview.colorSecundario = '#0F172A';
  preview.esFotografia = false;
  preview.portalMostrarFinanzas = true;
  preview.vistaPrevia = {
    modalidad: 'DESARROLLO_SOFTWARE',
    clienteNombre: 'Dixon',
    sesion: null,
    proyecto: {
      id: 'p1',
      nombre: 'San Carlos',
      estado: 'ACTIVO',
      fechaEntrega: null,
      totalHitos: 0,
      hitosCompletados: 0,
    },
    facturas: [],
  };

  assert.equal(preview.clienteNombre, 'Dixon');
  assert.equal(preview.totalElementosColumnaPrincipal, 1);
  assert.equal(preview.porcentajeHitos, null);
  assert.equal(preview.facturasVisibles.length, 0);
  assert.equal(
    preview.mensajeContextual,
    'Aquí encontrarás los proyectos, documentos y facturas que Mena Studios comparta contigo.'
  );

  // Modo fotografía vacío honesto (sin inventar nombres ni porcentajes)
  preview.esFotografia = true;
  preview.portalMostrarFinanzas = false;
  preview.vistaPrevia = {
    modalidad: 'FOTOGRAFIA',
    clienteNombre: null,
    sesion: null,
    proyecto: null,
    facturas: [{ id: 'f1', numero: '001', concepto: 'X', monto: 100, moneda: 'PAB', estado: 'ENVIADA', fechaEmision: '' }],
  };
  assert.equal(preview.clienteNombre, null);
  assert.equal(preview.totalElementosColumnaPrincipal, 0);
  assert.equal(preview.facturasVisibles.length, 0);
});

test('ConfiguracionComponent elimina selector de tipografía y usa app-portal-preview compartido', () => {
  const html = fs.readFileSync(path.resolve(FRONTEND_SRC, 'pages/configuracion.component.html'), 'utf8');
  const tsSrc = fs.readFileSync(path.resolve(FRONTEND_SRC, 'pages/configuracion.component.ts'), 'utf8');
  const clientHtml = fs.readFileSync(path.resolve(FRONTEND_SRC, 'pages/client-home.component.html'), 'utf8');
  const clientCss = fs.readFileSync(path.resolve(FRONTEND_SRC, 'pages/client-home.component.css'), 'utf8');
  const sharedCss = fs.readFileSync(path.resolve(FRONTEND_SRC, 'shared/portal-editorial.css'), 'utf8');

  assert.doesNotMatch(html, /tipografiaSelect|Tipografía del portal/);
  assert.match(html, /<app-portal-preview/);
  assert.match(html, /mensajeBienvenidaTextarea/);
  assert.doesNotMatch(tsSrc, /tipografia:\s*this\.form\.tipografia/);
  assert.match(clientHtml, /<app-portal-hero/);
  assert.match(sharedCss, /--portal-primary-soft/);
  assert.match(clientCss, /--portal-primary/);
});
