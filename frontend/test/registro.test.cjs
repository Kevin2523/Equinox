const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadRegistroComponent() {
  const filePath = path.resolve(__dirname, '../src/pages/registro.component.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true
    }
  }).outputText;

  const mockWindow = { location: { hostname: 'localhost', origin: 'http://localhost:4200' } };
  const mockExports = {};
  const mockModule = { exports: mockExports };

  const localRequire = (id) => {
    if (id === '@angular/core') return { Component: () => (t) => t };
    if (id === '@angular/common') return { CommonModule: {} };
    if (id === '@angular/forms') return { FormsModule: {} };
    if (id === '@angular/router') return { Router: class {}, RouterLink: {} };
    if (id === '../auth/auth.service') return { AuthService: class {} };
    if (id === '../auth/api.config') return { API_ORIGIN: 'http://localhost:3000' };
    throw new Error(`Import no simulado: ${id}`);
  };

  vm.runInNewContext(code, {
    module: mockModule,
    exports: mockExports,
    require: localRequire,
    window: mockWindow,
    console
  });

  return mockModule.exports.RegistroComponent;
}

test('RegistroComponent inicializa con valores predeterminados correctos', () => {
  const RegistroComponent = loadRegistroComponent();
  const mockAuth = {};
  const mockRouter = {};
  const comp = new RegistroComponent(mockAuth, mockRouter);

  assert.equal(comp.datos.tipoFreelance, 'GENERAL');
  assert.equal(comp.mostrarContrasena, false);
  assert.equal(comp.cargando, false);
  assert.equal(comp.enviado, false);
  assert.equal(comp.error, '');
  assert.equal(comp.slugManual, false);
});

test('alternarMostrarContrasena alterna el estado de visibilidad', () => {
  const RegistroComponent = loadRegistroComponent();
  const comp = new RegistroComponent({}, {});

  assert.equal(comp.mostrarContrasena, false);
  comp.alternarMostrarContrasena();
  assert.equal(comp.mostrarContrasena, true);
  comp.alternarMostrarContrasena();
  assert.equal(comp.mostrarContrasena, false);
});

test('sugerirSlug convierte nombres a slugs válidos con minúsculas y guiones', () => {
  const RegistroComponent = loadRegistroComponent();
  const comp = new RegistroComponent({}, {});

  assert.equal(comp.sugerirSlug('Mena Studios'), 'mena-studios');
  assert.equal(comp.sugerirSlug('Fotografía & Diseño Panamá!'), 'fotografia-diseno-panama');
  assert.equal(comp.sugerirSlug('  Estudio   Creativo  '), 'estudio-creativo');
  assert.equal(comp.sugerirSlug(''), '');
});

test('onEstudioInput auto-completa el slug si no fue modificado manualmente', () => {
  const RegistroComponent = loadRegistroComponent();
  const comp = new RegistroComponent({}, {});

  comp.datos.nombreEstudio = 'Luz & Sombra Fotografía';
  comp.onEstudioInput();
  assert.equal(comp.datos.slug, 'luz-sombra-fotografia');

  // Si el usuario escribe manualmente en slug, onSlugInput marca slugManual = true
  comp.onSlugInput();
  comp.datos.slug = 'mi-slug-personalizado';

  // Si cambia el nombre del estudio de nuevo, no debe sobrescribir el slug manual
  comp.datos.nombreEstudio = 'Otro Estudio';
  comp.onEstudioInput();
  assert.equal(comp.datos.slug, 'mi-slug-personalizado');
});

test('registrar no envía si el formulario es inválido', async () => {
  const RegistroComponent = loadRegistroComponent();
  let llamado = false;
  const mockAuth = { registrar: async () => { llamado = true; } };
  const comp = new RegistroComponent(mockAuth, {});

  const fakeForm = { invalid: true };
  await comp.registrar(fakeForm);

  assert.equal(comp.enviado, true);
  assert.equal(llamado, false);
  assert.equal(comp.cargando, false);
});

test('registrar envía payload saneado y navega a rutaInicial() (incluyendo FOTOGRAFIA)', async () => {
  const RegistroComponent = loadRegistroComponent();
  let payloadRecibido = null;
  let navegadoA = null;

  const mockAuth = {
    registrar: async (datos) => { payloadRecibido = datos; },
    rutaInicial: () => '/clientes'
  };
  const mockRouter = {
    navigateByUrl: async (url) => { navegadoA = url; return true; }
  };

  const comp = new RegistroComponent(mockAuth, mockRouter);
  comp.datos.nombre = ' Carlos ';
  comp.datos.apellido = ' Mena ';
  comp.datos.correo = ' Carlos@Mena.Com ';
  comp.datos.contrasena = 'SecretPass123';
  comp.datos.nombreEstudio = ' Mena Photo Studio ';
  comp.datos.slug = ' mena-photo ';
  comp.datos.tipoFreelance = 'FOTOGRAFIA';

  const fakeForm = { invalid: false };
  await comp.registrar(fakeForm);

  assert.equal(payloadRecibido.correo, 'carlos@mena.com');
  assert.equal(payloadRecibido.contrasena, 'SecretPass123');
  assert.equal(payloadRecibido.nombre, 'Carlos');
  assert.equal(payloadRecibido.apellido, 'Mena');
  assert.equal(payloadRecibido.nombreEstudio, 'Mena Photo Studio');
  assert.equal(payloadRecibido.slug, 'mena-photo');
  assert.equal(payloadRecibido.tipoFreelance, 'FOTOGRAFIA');
  assert.equal(navegadoA, '/clientes');
  assert.equal(comp.datos.contrasena, '');
  assert.equal(comp.cargando, false);
});

test('registrar captura y muestra errores de la API correctamente', async () => {
  const RegistroComponent = loadRegistroComponent();
  const mockAuth = {
    registrar: async () => {
      const err = new Error('Conflicto');
      err.status = 409;
      err.error = { error: 'Ya existe una organización con ese slug' };
      throw err;
    }
  };

  const comp = new RegistroComponent(mockAuth, {});
  comp.datos.nombre = 'Ana';
  comp.datos.correo = 'ana@test.com';
  comp.datos.contrasena = 'Pass12345';
  comp.datos.nombreEstudio = 'Studio';
  comp.datos.slug = 'studio';

  await comp.registrar({ invalid: false });
  assert.equal(comp.error, 'Ya existe una organización con ese slug');
  assert.equal(comp.cargando, false);
});

test('resolverMensajeError distingue validación 422, error de servidor 500 y desconexión de API (status 0)', () => {
  const RegistroComponent = loadRegistroComponent();
  const comp = new RegistroComponent({}, {});

  // 422 con detalles de Zod
  assert.equal(
    comp.resolverMensajeError({
      status: 422,
      error: { error: 'Datos inválidos', detalles: [{ path: ['slug'] }, { path: ['correo'] }] }
    }),
    'Datos inválidos: revisa identificador del estudio (minúsculas, números y guiones), correo electrónico.'
  );

  // 500 error de servidor
  assert.equal(
    comp.resolverMensajeError({ status: 500, error: { error: 'Ocurrió un error inesperado' } }),
    'Error interno del servidor al procesar el registro. Inténtalo de nuevo en unos momentos.'
  );

  // status 0 (API desconectada)
  assert.equal(
    comp.resolverMensajeError({ status: 0, name: 'HttpErrorResponse' }),
    'No se pudo conectar con el servidor de Equinox. Verifica que el servicio API esté activo e inténtalo de nuevo.'
  );
});
